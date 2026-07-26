# Authored natural asset pipeline

The streamed world uses authored GLBs where recognisable silhouette and texture
detail matter, while retaining procedural geometry for dense coverage and long
view distances.

## Runtime coverage

| Layer | Authored prototypes | Runtime strategy |
|---|---:|---|
| Rocks | 12 | Four standalone rocks plus four ruined-fence stones and four forest-pack stones, each loaded from an individual GLB |
| Bushes | 5 | One grounded prototype per authored bush GLB; authored cutout textures in near and proxy bands |
| Trees | 14 total | Source-GLB conifers plus a decimated oak, four forest-pack conifers and the two distinct whole-scene crowns; near geometry, proxy geometry, then baked impostors |
| Ground detail | 17 | Tufts, blades, blossoms and sprouts under 350 triangles each, gated per biome over the procedural blade carpet |
| Aquatic plants | 6 | Two rooted wetland plants, two broadly scattered weed silhouettes and two low-poly lotus leaves restricted to deterministic shoreline colonies |
| Distant birds | Up to 10 | Generated three-triangle silhouettes in intermittent flocks; one instanced draw only while visible |
| Close wildlife | 2 optional | Flight-only animated crow and seagull GLBs behind `wildlife.authored.enabled: false` |

The procedural grass carpet remains the dense base. Replacing it with imported
grass meshes would multiply instance-build work and discard the measured shared
blade-buffer advantage described in [perf-qa.md](perf-qa.md).

The tree count fell from 16 while the trees improved. `ForestSpeciesGeometry`'s
lobe-and-cylinder archetypes are no longer pool members: they are generated only
for a species no authored variant covers, and the shipped configuration covers
all six, so none are built. Pooling them meant roughly one broadleaf in three
was procedural, standing beside an authored crown. One GLB may declare several
species — `treeVariants[].species` accepts a list — so the three authored
broadleaf crowns cover four broadleaf species without duplicating geometry into a
second pair of full-capacity `InstancedMesh`es.

Only three distinct tree geometries exist in the 42.8 MB scene, not 23.
Comparing rotation- and scale-invariant shape signatures (surface area ÷ height²
with vertex counts) shows `tree-02` repeated 14 times and `tree-03` repeated 8,
differing only by node transform, which the scatter already randomises.
`tree-01` is a third geometry but carries no leaf material.

`stylized-oak` is decimated at extraction time from 182 154 to 62 883 triangles
and restricted to savanna and grassland. Decimation belongs in the extractor
because the runtime optimizer asserts triangle parity between its input and
output, so gltfpack can never silently change a configured asset. Its crown is
thousands of disconnected leaf shells, which is why simplification plateaus near
61 000 whatever ratio and error are requested.

The final shoreline-lotus NVIDIA WebGPU `chunk-cross` runs averaged 147.14 and
144.40 FPS, with 5.8/5.7 ms median frame times, 22.07/23.18 ms p99, nine hitches
each and no dropped instances. This is inside the established run-to-run range
of the extracted-asset baseline. Streaming the high-topology clover and land
weeds as ambient cover was measured and rejected; keeping those renderers active
reduced the same scenario to roughly 87 FPS.

The default wildlife tier does not request either animal GLB. It schedules
deterministic distant flocks with long empty intervals and uploads at most ten
small instance matrices per frame. The authored skinned tier is dynamically
imported only when explicitly enabled, caps each species to one active bird, and
uses land habitat for crows and marine/wetland habitat for seagulls. Its source
and reconstruction paths are listed in `assets/README.md`.

The final NVIDIA WebGPU `chunk-cross` run with the default distant tier and the
rebaked optimized-tree impostors averaged 125.76 FPS, with a 6.2 ms median,
30.66 ms p99, 11 hitches, one four-bird flock and no dropped forest instances.
An exploratory 20-second authored-tier run loaded both skinned GLBs through the
KTX2/Meshopt loader, spawned an animated crow and averaged 112.13 FPS. That
measured cost is why authored birds remain opt-in.

## Offline extraction

Whole scenes and showroom packs are never runtime inputs. Run:

```bash
npm run extract:authored-assets
```

The manifest in `scripts/authored-asset-extraction.config.mjs` defines coherent
root groups, normalisation scale, offline output, and the curated subset copied
to `public/`. The extractor:

- bakes every selected root through its complete source world transform;
- groups sibling components such as trunks/crowns and stems/leaves;
- centres and grounds each output at `y=0`;
- copies only referenced geometry, materials, textures and extensions;
- caps embedded textures at 1024 px and converts them to quality-90 WebP;
- preserves author, licence, source URL and extraction provenance in the GLB;
- writes deterministic hashes, bounds and topology statistics to
  `assets/extracted/manifest.json`.

Published files are no longer byte-identical copies of these offline WebP
outputs. `npm run extract:authored-assets` chains the runtime optimizer, which
uses pinned native `gltfpack` 1.2 to apply GPU-oriented quantization and
meshoptimizer compression, then encodes colour/data textures as ETC1S KTX2 and
normal maps as UASTC KTX2. Runtime node names, material names, provenance,
rendered triangle counts, animation names, and skin counts are validation
contracts.

The current offline library contains 86 individual assets from nine source
packs. 38 curated outputs are published for runtime. The 42.8 MB tree scene
becomes 23 individual trees and two reusable grass shapes; its 2,665 repeated
grass placements, ground and water are not duplicated.

`simplifyRatio` on an extraction entry decimates through meshoptimizer before
publication. Decimation belongs here and not in the runtime optimizer, which
asserts triangle parity between input and output so that gltfpack can never
change what a configured asset looks like without an authoring decision.

### Embedded image integrity

Every extracted GLB is checked, in memory and again after serialisation, for
embedded images whose bytes do not match the format they declare. The texture
encoder intermittently returns another buffer's contents under sustained load:
one full run produced three corrupt `image/webp` images out of 267, the next run
produced a different three, and the same packs extract cleanly in isolation. The
result is silent — the file writes, hashes and loads, and only fails when
something downstream tries to decode the texture, which is where it cost most to
diagnose. The runtime optimizer's `prepareSource` stage does exactly that, and it
hangs rather than reporting an error.

Detection is deterministic even though reproduction is not, so a failed asset is
re-extracted up to four times rather than published or allowed to abort the run.
`npm run validate:extracted-assets` repeats the check over the whole library, so
a corrupt image cannot survive into a commit.

Texture-aware extraction reduced the complete individual library from 230.92 MB
to 79.86 MB. Across the complete 50-GLB runtime set, including standalone
natural assets and two flight-only wildlife assets, Meshopt/KTX2 publishing
reduces 39.78 MiB of prepared inputs to 37.84 MiB, 37.30 MiB over Brotli. Opaque
assets use compact ETC1S colour/data textures with UASTC normals; assets with
transparency use UASTC colour/alpha and normal textures to protect foliage and
wildlife cutout edges.

`textureSize` on an extraction entry caps that asset's texture resolution; it
defaults to 1024. Ground cover needs it. KTX2 has a per-texture floor cost, so
inheriting a tree scene's 1024 px atlas published a 37-triangle weed at 1.19 MiB
and a knee-high grass tuft at 0.91 MiB — between them more download than every
tree in the world. At 256 px the same five assets publish at 37-59 KiB, and the
runtime set is smaller with 50 assets than it was with 34. A published set that
grows larger than its inputs fails `validate:runtime-assets`, which is how this
was caught.

`editor.config.yaml` references only published individual GLBs. `rootNames` and
`prototypeGroups` remain supported for future assets, but runtime no longer
loads the forest showroom, ruined-fence pack, stylized-grass pack, weed
collection, or whole tree scene.

## Placement and residency

All new placements use `buildStableChunkManifest`, so prototype choice, position,
rotation and scale are independent of traversal order and chunk approach
direction. Canonical Azgaar biome IDs remain unchanged:

- land accents: savanna, grassland, forest biomes, wetland and farm;
- aquatic accents: marine (`0`) and wetland (`12`).

`RegionalCharacterField` adds a shared, coarse world-space influence over the
individual layer rules. It deterministically coordinates broad meadow,
woodland, scrub and rocky districts at roughly 420 m scale. Forest suitability,
bush clusters, scree clusters and authored meadow accents sample the same field,
so their negative space composes into recognisable areas instead of unrelated
noise. Sampling is cached on a 28 m grid and depends only on canonical world
coordinates, seed and settings; it therefore works identically on procedural
terrain and large imported Azgaar maps without storing masks per chunk.

## Choosing which prototype a biome grows

`BiomePrototypeSelector` replaces the per-layer global weighted roll that rocks,
bushes and ground details used to share. That roll was identical in every biome,
so a savanna, a taiga and a farm grew the same three grass clumps and only an
explicit Settings override could vary them. Three optional filters compose on
each variant, matching the three scales at which the world already varies:

- `tileIds` gates the variant to the biomes it belongs in — dry `Brown_Grass`
  blades in a savanna, the same shapes in `Green_Grass` as wetland reeds.
- `character` weights it by one `RegionalCharacterField` channel (`meadow`,
  `forest`, `scrub`, `rocky`), so the meadow districts of a grassland carry
  clumps and blossoms while its scrub districts carry dry blades.
- `canopy` (`core`, `edge`, `open`) weights it by forest habitat coverage, so a
  wood's shaded interior grows leafy weeds and its sunlit fringe grows flowers.

Every filter is optional, and a variant declaring none behaves exactly as before.
A biome no variant claims falls back to the whole set rather than resolving to
nothing, and each dynamic factor keeps a floor so a district or a canopy can
disfavour a prototype without making it unreachable. Selection allocates nothing:
eligible index lists are built once per biome and weights go into a reused
scratch buffer, because this runs once per scatter candidate.

Trees select through `ForestSpeciesRegistry` rather than this selector, so only
the biome gate applies to them; regional character and canopy are already
expressed by the habitat field that placed the tree.

`groundDetails.densityByTile` scales the per-chunk candidate budget per biome.
`tileIds` decides what grows somewhere; this decides how much. Deserts (0.12,
0.16), savanna (0.55), taiga (0.45) and tundra (0.2) joined the layer so they
stop being bare ground, not so they receive a grassland's worth of cover.

Canopy hue is per biome. `createForestLeafTintTable` carries a target colour for
each wooded tile, expressed the same way autumn is — a ratio against the species'
own lit crown colour, so the crown's height gradient and fbm variation survive
and only its hue moves. This is what lets three broadleaf silhouettes read as a
savanna, a rainforest and a taiga. It rides the existing per-instance
`instanceLeafTint` attribute, so it costs no extra prototypes and no extra draw
calls. A grove that has turned keeps its autumn colour outright: both are
absolute targets expressed as ratios, and multiplying them would land on neither.

## World-look settings

The Settings panel exposes authored asset dropdowns per biome. “Automatic mix”
retains deterministic weighted variation; an explicit choice pins that layer to
one authored asset while retaining stable placement, grounding and LOD.

Named scene settings use `simcity-dnd-scene-settings` version 1 and capture:

- a URL map reference or an embedded local map document;
- every god-ray/height-fog control;
- explicit biome asset choices;
- custom local or URL GLB definitions;
- regional placement parameters.

Bundled presets and maps are discovered through `settings/manifest.json` and
`maps/manifest.json`. Local files and CORS-enabled URLs are supported for all
three inputs: settings, maps and GLBs. Browser-saved presets use an IndexedDB
key range independent of streamed chunk storage, and complete settings can be
exported as portable JSON. Normal world save/export also embeds the active
scene-settings document under `visualConfig.sceneSettings`.

Lotus variants additionally use a configuration-driven `shoreline-colonies`
placement rule. Stable 72 m supercells select occasional 16 m gardens, and
marine candidates must remain within six terrain cells of a non-marine bank.
Wetlands qualify directly. In a deterministic 1,089-chunk runtime scan, only
seven chunks held multi-lotus gardens while 550 chunks held rooted aquatic
plants and no lotus. The selected garden rendered three lotus instances with no
capacity drops.

Both detail layers stay at `residentRadius: 1`. Their build queue is capped to
one layer rebuild per frame and kept independent of the longer tree-manifest
backlog so details cannot remain empty while a forest window settles.

## Validation

```bash
npm run validate:assets
npm test
npm run build
npm run qa:perf
npm run qa:assets:startup -- --runs 2 --headed
```

`validate:assets` checks every configured runtime GLB and all 86 offline
extractions, including source/output hashes, single-scene structure, grounding,
provenance, meshopt/KTX2 requirements, names, animation/skin contracts, and
runtime manifest hashes. It also checks world-space bounds, draw/material
assignments, logical geometry bytes, gzip/Brotli metrics, selected texture
profiles, cache keys, and official Khronos glTF Validator results. The unit
suite covers grouped extraction,
material-part retention, grounding, selection, sibling trunk/crown assembly,
deterministic colony sparsity and shoreline gating.

Changing the tree prototype pool invalidates the checked-in impostor manifest.
With an existing dev server, rebake through:

```bash
npm run bake:impostors -- --url http://127.0.0.1:5173/
```

The generated manifest must pass `validate:impostors:required` before delivery.

## Source-library policy

Original multi-object GLBs remain under `assets/` as extraction sources and are
not copied to `public/`. The 10.9k-triangle clover and heavier lotus/grass chunks
are saved individually offline for deliberate placed scenery, not streamed
ambient cover. Models carrying the Sketchfab Standard licence are not extracted
for publication or configured for redistribution.
