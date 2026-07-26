# Biome vegetation variety plan

Goal: stop rendering the generated blob trees, put the authored library to work,
and make a savanna, a taiga and a rainforest floor read as different places
instead of the same green carpet with the same tree on it.

## 1. The tree in the screenshot is not an asset

It is a procedural archetype from
[ForestSpeciesGeometry.js](../../src/editor/stylized/forest/ForestSpeciesGeometry.js).
Each crown lobe is a `DodecahedronGeometry` scaled into an ellipsoid
([ForestSpeciesGeometry.js:90-97](../../src/editor/stylized/forest/ForestSpeciesGeometry.js#L90-L97)),
stacked into two tiers with a cylinder trunk and cylinder limbs. Four species are
built this way: `broadleaf_round`, `broadleaf_tall`, `tropical_tall`,
`wetland_sparse`.

They are not a fallback. `createSpeciesPrototypeIndex`
([ForestSpeciesGeometry.js:419-437](../../src/editor/stylized/forest/ForestSpeciesGeometry.js#L419-L437))
*concatenates* the generated index with the authored GLB indices for the same
species, so `broadleaf_round` currently rolls between the blob, `stylized-oak`
and `tree-02` with equal probability. Roughly one broadleaf in three is a blob,
and every `tropical_tall` and `wetland_sparse` tree is one, because no authored
GLB claims those species.

**Fix:** generated archetypes become fallback-only — built and pooled *only* for
species that no authored variant covers. Detail in §5.1.

## 2. Asset audit — what the library actually contains

I compared rotation- and scale-invariant shape signatures (surface area ÷ height²
plus triangle and vertex counts) across every extracted GLB. The result changes
what is worth publishing.

### The "23 trees" are three meshes

| Group | Files | Tris | Verdict |
|---|---|---:|---|
| `tree-02` family | tree-02, 04, 05, 06, 07, 08, 15, 16, 17, 18, 19, 21, 22, 23 | 4599 | **Identical geometry** — 5934 vtx, shape 14.262, mesh height 27.062 for all 14. Only the node transform differs. |
| `tree-03` family | tree-03, 09, 10, 11, 12, 13, 14, 20 | 1806 | **Identical geometry** — 3339 vtx, shape 15.6391 for all 8. |
| `tree-01` | tree-01 | 276 | Genuinely distinct. `Bark` material only — it is a **bare snag**, no foliage. |

The runtime already applies per-instance scale and a random Y rotation, so
publishing `tree-05` buys nothing `tree-02` does not already give. The original
`publishIndices: [1, 2]` decision in
[authored-asset-extraction.config.mjs:59](../../scripts/authored-asset-extraction.config.mjs#L59)
was correct.

### The unused wins are in the forest pack and the ground cover

| Asset | Tris | Bounds (m) | Status | Note |
|---|---:|---|---|---|
| `forest-pack/tree-wide-02` | 630 | 7.81 × 25.41 × 7.49 | **unpublished** | Distinct shape (12.57). Tall column conifer. |
| `forest-pack/tree-wide-03` | 624 | 10.06 × 18.46 × 10.07 | **unpublished** | Distinct shape (7.99). Broad-tall conifer. |
| `forest-pack/tree-wide-01` | 624 | 5.91 × 10.34 × 5.46 | published | shape 8.51 |
| `forest-pack/tree-narrow-01` | 285 | 6.62 × 11.87 × 7.66 | published | shape 4.99, spire |
| `stylized-oak` | **182 154** | 5.15 × 7.90 × 5.45 | published | See §5.6 |

Two free, genuinely distinct, sub-650-triangle conifers are sitting unpublished.

### Ground cover: sixteen cheap prototypes, three in use

Published today: `clump-01/02/03` only. Everything below is extracted, distinct
and unpublished.

| Asset | Tris | Bounds (m) | Material | Reads as |
|---|---:|---|---|---|
| `stylized-grass/source-01` | 32 | 0.06 × 0.54 | GrassGrass_MAT | single blade |
| `stylized-grass/source-02` | 96 | 0.22 × 0.54 | GrassGrass_MAT | sparse sprig |
| `tree-scene/grass-small` | 50 | 1.21 × 1.14 × 1.03 | Grass_C | small patch |
| `tree-scene/grass-dense` | 80 | 2.92 × 1.28 × 2.96 | Grass_C | **3 m broad patch for 80 tris** |
| `weeds/grass-blade-01` | 45 | 0.06 × 1.52 | Green_Grass | tall green blade |
| `weeds/grass-blade-03` | 75 | 0.17 × 1.52 | Green_Grass | tall green blade, splayed |
| `weeds/grass-blade-04` | 45 | 0.02 × 1.52 | Brown_Grass | tall **dry** blade |
| `weeds/grass-blade-05` | 85 | 0.10 × 1.52 | Brown_Grass | tall **dry** blade, splayed |
| `weeds/grass-blade-02` | 115 | 0.24 × 1.40 | Brown + Green | mixed dry/green clump |
| `weeds/flower-01` | 85 | 0.09 × 0.25 | — | small blossom |
| `weeds/flower-02` | 101 | 0.07 × 0.25 | — | small blossom |
| `grass-chunks/chunk-01` | 37 | 0.28 × 0.56 | rostlinka_07c | leafy weed sprig |
| `grass-chunks/chunk-05` | 12 | 0.06 × 0.08 | rostlinka12_2k | sprout (needs ~4× scale) |
| `grass-chunks/chunk-06` | 12 | 0.08 × 0.08 | rostlinka12_2k | sprout (needs ~4× scale) |

`grass-blade-01`/`04` are the same mesh in green and brown, as are `03`/`05`.
That green/dry pairing is the cheapest lever available for making a savanna
differ from a grassland.

**Stay excluded** (the ~87 FPS result recorded in
[authored-natural-assets.md](../authored-natural-assets.md) was right): `clover`
10 912, `chunk-02` 52 188, `chunk-08` 18 478, `chunk-04` 4 551, `chunk-03` 2 681.

**Already streaming and too heavy:** the aquatic layer runs
`grass-plant-green` (6 145 tris) and `grass-plant-brown` (4 975) at
`perChunk: 24`. Those two are heavier than every tree except the oak. Demote them
to wetland-only and let `weed-01/02` (116 tris) carry marine shallows.

## 3. Three axes of "area"

The engine already computes all three; none of them currently influences *which*
asset is chosen.

1. **Biome** — canonical Azgaar tile ID 0–12 plus Road 13, Farm 14.
2. **Regional character** —
   [RegionalCharacterField](../../src/editor/stylized/RegionalCharacterField.js)
   gives `meadow`, `forest`, `scrub` and `rocky` influences at ~420 m, sampled
   from world coordinates. The ground-detail and bush evaluators already read it,
   but only to accept or reject a candidate, never to pick its prototype.
3. **Forest habitat** — `patchCoverage` and `patchEdge` from
   [ForestHabitatField](../../src/editor/stylized/forest/ForestHabitatField.js)
   distinguish closed canopy, fringe and glade. `ForestFloor` already uses them
   for density; it should also drive selection.

Biome sets the palette; regional character varies it across ~420 m districts;
habitat varies it again inside a wood. Together they are what stops a biome
looking uniform.

## 4. The assignments

### 4.1 Trees

After removing the blobs and publishing `tree-wide-02`/`03`, the pool is **14
prototypes, down from 16** — better trees for less instance memory.

| Species | Geometry | Tris |
|---|---|---:|
| `conifer_narrow` | `tree-narrow-01`, grass-scene pines | 285 |
| `conifer_wide` | `tree-wide-01`, `tree-wide-02`, `tree-wide-03` | 624–630 |
| `broadleaf_round` | `tree-02` (dense crown), `stylized-oak` (see §5.6) | 4 599 |
| `broadleaf_tall` | `tree-03` (open crown) | 1 806 |
| `tropical_tall` | `tree-02`, taller `trunkScale`, flatter `crownAspect` | 4 599 |
| `wetland_sparse` | `tree-03`, low crown, olive tint | 1 806 |

Species palettes per biome stay as they are in `ForestSpeciesRegistry`
`DEFAULT_PALETTES`. What changes is colour — see §5.5. We have three broadleaf
silhouettes, not six, so hue and proportion have to carry the biome difference.
That is cheap: the per-instance `leafTint` attribute already exists.

Per-biome canopy targets, anchored on `leafTop` the same way the autumn table is:

| Biome | Tint target | Reads as |
|---|---|---|
| Savanna (3) | `#aeae5a` | dry olive-gold |
| Grassland (4) | `#86b04a` | fresh green |
| Tropical seasonal forest (5) | `#6fae3e` | bright green |
| Temperate deciduous forest (6) | `#6da03c` | mid green (reference look) |
| Tropical rainforest (7) | `#3f8f34` | deep saturated green |
| Temperate rainforest (8) | `#4c9142` | deep cool green |
| Taiga (9) | `#4a7a55` | blue-green |
| Tundra (10) | `#8a9a62` | grey-green, stunted |
| Wetland (12) | `#6f8f43` | olive |

Autumn tinting multiplies on top and stays grove-scoped, so a deciduous wood
still turns as one stand.

### 4.2 Ground cover

Biome gate first, then regional character weighting inside it.

| Biome | Prototypes | Character notes |
|---|---|---|
| Hot desert (1) *new* | `grass-blade-04`, `grass-blade-05`, `chunk-05`, `chunk-06` | `perChunk` 4. Dry blades only, no clumps, no flowers. |
| Cold desert (2) *new* | `grass-blade-04`, `chunk-05`, `chunk-06`, `source-01` | `perChunk` 4. |
| Savanna (3) | `grass-blade-04`, `grass-blade-05`, `grass-blade-02`, `grass-dense` (low weight) | `scrub` boosts the dry blades; no flowers anywhere. |
| Grassland (4) | `clump-01/02/03`, `source-02`, `grass-small`, `flower-01/02` | `meadow` boosts clumps + flowers; `scrub` swaps toward `grass-blade-02`. |
| Tropical seasonal forest (5) | `grass-dense`, `chunk-01`, `grass-blade-02`, `source-02` | `forest` boosts `chunk-01`. |
| Temperate deciduous forest (6) | `clump-02/03`, `chunk-01`, `source-02`, `flower-02` | Flowers only where `patchEdge > 0.55`. |
| Tropical rainforest (7) | `grass-dense`, `chunk-01`, `source-01/02` | No flowers. Dense floor under canopy. |
| Temperate rainforest (8) | `grass-dense`, `clump-03`, `chunk-01`, `source-01` | |
| Taiga (9) | `source-01`, `chunk-05`, `chunk-06`, `clump-01` (low weight) | Needle floor, not meadow — halve `perChunk`. |
| Tundra (10) *new* | `chunk-05`, `chunk-06`, `source-01` | `perChunk` 4. |
| Wetland (12) | `grass-blade-01`, `grass-blade-03`, `grass-blade-02`, `weed-01/02` | Tall green blades. |
| Farm (14) | `clump-01`, `source-02`, `grass-blade-02`, `flower-01` | Flowers at field edges only. |

Regional character modulation, applied as a weight multiplier on top of the
biome set:

| Channel | Boost | Suppress |
|---|---|---|
| `meadow` | clumps, flowers, `grass-small` | tall blades |
| `forest` | `chunk-01`, `source-01`, `grass-dense` | flowers |
| `scrub` | `grass-blade-02/04/05` | clumps, flowers |
| `rocky` | — | all ground detail (already gates density) |

Habitat modulation inside woodland: closed canopy (`patchCoverage > 0.75`)
selects only `chunk-01`/`source-01`; fringe (`patchEdge > 0.55`) unlocks clumps
and flowers. This is the same core/edge split `ForestFloor` already applies to
density.

### 4.3 Aquatic

Restrict `grass-plant-green`/`grass-plant-brown` (6 145 / 4 975 tris) to tile 12
only. Marine shallows (tile 0) keep `weed-01/02` and the lotus colonies. This is
a straight ~10 000-triangle saving per affected chunk at no visual cost in open
water.

## 5. Engine changes

### 5.1 Generated archetypes become fallback-only

- `buildFromScene`
  ([StylizedTreeView.js:210-284](../../src/editor/stylized/StylizedTreeView.js#L210-L284))
  currently appends generated prototypes *before* reading the authored variants,
  so it cannot know which species are covered. Reorder: load variants, collect
  `additionalPrototypeIndicesBySpecies`, then generate archetypes only for
  species absent from that map.
- `createSpeciesPrototypeIndex` stops concatenating generated with authored.
- With the assignments in §4.1 every species is covered, so **zero** archetypes
  are built at runtime. `ForestSpeciesGeometry.js` stays — it is the safety net
  for a custom preset whose palette names an uncovered species.

**Prototype order changes, which invalidates the checked-in impostor manifest.**
Rebake is mandatory:
`npm run bake:impostors -- --url http://127.0.0.1:5173/`, then
`npm run validate:impostors:required`.

### 5.2 Per-variant biome gating

`buildStableChunkManifest` already passes `tileId` to `prototypeIndexForRoll`
([StableScatterManifest.js:208-210](../../src/editor/stylized/StableScatterManifest.js#L208-L210)),
and `x`/`z` are computed two lines earlier — extending the callback to
`(roll, tileId, x, z)` is backward compatible.

- Add optional `tileIds` to `treeVariants`, `groundDetailVariants`,
  `aquaticVariants`, `bushVariants` and `rockVariants` in
  [validateEditorConfig.js](../../src/config/validateEditorConfig.js) (only
  `wildlifeVariants` accepts it today, at line 605).
- `BiomeAssetPalette.createLayerCatalog` already reads `definition.tileIds` for
  the Settings dropdown
  ([BiomeAssetPalette.js:74-85](../../src/editor/stylized/BiomeAssetPalette.js#L74-L85)),
  so the manual override UI needs no change — it starts filtering correctly the
  moment the schema allows the field.
- New shared `createBiomePrototypeSelector` replacing the three ad-hoc automatic
  selectors: the global weighted picker in
  [StylizedGroundDetailView.js:193-202](../../src/editor/stylized/StylizedGroundDetailView.js#L193-L202),
  the `Math.floor(roll * count)` in
  [StylizedBushView.js:247-255](../../src/editor/stylized/StylizedBushView.js#L247-L255),
  and the rock equivalent.

This is the change that fixes "all the biome is the same" — today automatic mode
has **no** biome awareness at all for ground details, bushes or rocks.

### 5.3 Regional character affinity

Add `character` (`meadow`/`forest`/`scrub`/`rocky`) and `characterWeight` per
variant; the selector multiplies each candidate's weight by
`sampleChannel(x, z, channel) ** characterWeight`. Sampling is already cached on
a 28 m grid, and the field's `signature` is already in every manifest cache key.

### 5.4 Canopy-aware ground detail

`StylizedGroundDetailView` has `regionalCharacterField` but no
`forestFieldProvider` — `StylizedBushView` shows the pattern
([StylizedBushView.js:225](../../src/editor/stylized/StylizedBushView.js#L225)).
Wire the same provider in and expose `patchCoverage`/`patchEdge` to the selector.

### 5.5 Per-biome leaf tint

Extend
[createForestLeafTintTable](../../src/editor/stylized/forest/forestLeafTint.js#L68)
with a biome tint table alongside `AUTUMN_TARGETS`, and multiply the two ratios.
The per-instance `instanceLeafTint` attribute already exists and already applies
to **every** leaf part of **every** prototype, authored included
(`tintLeaves: true` at
[StylizedTreeView.js:440](../../src/editor/stylized/StylizedTreeView.js#L440)).
Cost: zero extra prototypes, zero extra draw calls.

### 5.6 stylized-oak is 182 154 triangles

Confirmed against `assets/runtime-asset-manifest.json` — the optimizer quantizes
but does not decimate, so all 182 k reach the GPU. It is 40× the next-heaviest
tree and it currently sits in the `broadleaf_round` rotation, meaning it can
render across a 5×5 chunk window at up to 72 accepted trees per chunk. Options,
in order of preference:

1. Decimate offline to ≤ 6 000 triangles (`gltfpack -si` in the runtime profile),
   keeping it in the ambient pool.
2. Drop it from ambient scatter, keep it as a deliberate placed landmark.

Either is fine. Leaving it as-is is not.

**Resolved differently — option 1 does not reach its target.** Decimation cannot
be done in the runtime optimizer at all: that stage asserts triangle parity
between input and output by design, so `gltfpack -si` would fail its own
validation. Moving it to extraction time works, but the crown is thousands of
disconnected leaf shells and meshoptimizer will not collapse across components:
a sweep of `ratio` 0.05→0.02 against `error` 0.02→0.4 plateaus at 60 637–62 883
triangles regardless of settings.

So both halves apply. The oak is decimated at extraction (182 154 → 62 883, a 3×
win, bounds preserved to within 3%) **and** restricted with `tileIds: [3, 4]` to
savanna and grassland — the two biomes whose forest profiles place trees as
isolated specimens and copses (`density` 0.24 and 0.16). A hero oak alone in a
meadow is what the asset is for; closed forest draws the 4 599- and
1 806-triangle crowns instead. Tile restriction for trees is implemented in
`ForestSpeciesRegistry.prototypesFor`, since trees select through the species
registry rather than the scatter selector.

### 5.7 Optional: bare snags

`tree-01` (276 tris, `Bark` only) is a natural fit for the existing `dead` age
class, but `findPrototypeRoots`
([StylizedTreePrototypes.js:28-33](../../src/editor/stylized/StylizedTreePrototypes.js#L28-L33))
requires both a leaf and a trunk material. Allowing leaf-less prototypes would
give real snags instead of a shrunken crown. Low priority, high character.

## 6. Pipeline

1. Extend [authored-asset-extraction.config.mjs](../../scripts/authored-asset-extraction.config.mjs):
   - `low-poly-forest-pack`: add `publishDir` to `tree-wide-02` and `tree-wide-03`.
   - `low-poly-tree-scene`: add `publishDir` to `grass-small` and `grass-dense`.
   - `stylized-grass`: add `publishDir` to the `source` prefix group.
   - `weeds-and-grass`: add `publishDir` to the five blades and two flowers.
   - `simple-grass-chunks`: add `publishDir` + `publishIndices: [0, 4, 5]`
     (chunk-01, chunk-05, chunk-06) and a scale bump for the two sprouts.
2. `npm run extract:authored-assets` (chains the Meshopt/KTX2 optimizer).
3. Add the new variants to `editor.config.yaml` with `tileIds`, `character`,
   `weight` and `scale`; add tiles 1, 2 and 10 to `groundDetails.tileIds`.
4. `npm run validate:assets` — hashes, provenance, grounding, glTF validation.
5. `npm test` — extend the unit suite for biome gating and character weighting.
6. `npm run bake:impostors -- --url http://127.0.0.1:5173/` then
   `npm run validate:impostors:required`.

## 7. Budget and validation

Every prototype gets a full-capacity `InstancedMesh` **per LOD band**
([StylizedLodRuntime.js:48-60](../../src/editor/stylized/lod/StylizedLodRuntime.js#L48-L60)),
so prototype count — not triangle count alone — drives instance memory and draw
calls.

| Layer | Prototypes now | After | Slots per prototype |
|---|---:|---:|---|
| Trees | 16 | **14** | 1 800 near + 5 832 proxy |
| Ground details | 3 | ~16 | 216 (`residentRadius` 1 × `perChunk` 24) |
| Aquatic | 6 | 6 | 216 |

The tree pool shrinks. Ground detail grows thirteen prototypes at 216 slots each
— about 2 800 extra instance slots total, against a triangle budget that stays
under 350 per prototype. That is the reason for the exclusion list in §2: the
rejected assets are 8–150× heavier than the ones being added.

Validate per [perf-qa.md](../perf-qa.md): A/B `npm run qa:perf` against unmodified
code on this machine, same `--warmup`, `chunk-cross` scenario, two runs each.
Watch `grassScatterMs`, `detailRebuilds` and hitch count — the ground-detail layer
is capped at one rebuild per frame and must not start starving the tree manifest
backlog.

## 8. Order of work

1. §5.1 blobs → fallback-only, plus publish `tree-wide-02`/`03`. This alone
   removes what the screenshot shows.
2. §5.6 the oak.
3. §5.2 biome gating + §6 ground cover publication. This is the biome-variety
   payload.
4. §5.3 regional character, §5.4 canopy awareness, §5.5 per-biome tint — the
   intra-biome variation.

## 9. Outcome

All of §5 is implemented. Deviations from the plan as written:

- **§5.6** resolved as described in that section: decimation plus a biome
  restriction, because decimation alone cannot reach the target.
- **Species coverage** needed one addition the plan did not anticipate. Retiring
  the archetypes requires every species to be authored-covered, and there are
  only three broadleaf crowns for four broadleaf species. Rather than configure
  the same GLB twice — which would cost a second pair of full-capacity
  `InstancedMesh`es for identical geometry — `treeVariants[].species` now accepts
  a list, so `tree-02` serves `broadleaf_round` and `tropical_tall` and `tree-03`
  serves `broadleaf_tall` and `wetland_sparse`. They are told apart by the
  registry's crown aspect, spacing and age curve plus the §5.5 biome hue.
- **Density, not just selection.** `tileIds` decides what grows in a biome but
  not how much, and adding deserts and tundra to the ground-detail layer made
  that gap obvious — they would have received a grassland's worth of cover.
  `groundDetails.densityByTile` scales the per-chunk candidate budget per biome
  (desert 0.12, cold desert 0.16, savanna 0.55, taiga 0.45, tundra 0.2).
- **Saved-preset compatibility.** Variant `tileIds` can narrow between releases,
  so `BiomeAssetPalette` now drops a pinned selection that has become ineligible
  instead of rejecting the whole settings document.

Two published assets went further than planned: `grass-plant-green` and
`grass-plant-brown` (6 145 and 4 975 triangles) are now wetland-only rather than
scattering across open marine water at 24 candidates per chunk.

Two problems surfaced in the asset pipeline that the plan had no way to
anticipate, both now fixed and guarded:

- **The extractor intermittently corrupts embedded images.** Publishing 16 new
  assets meant re-running extraction, which produced three `image/webp` images
  out of 267 whose bytes were geometry data — a different three on the next run,
  and none when the same pack was extracted alone. It is silent: the file writes,
  hashes and loads, and the failure surfaces only when the runtime optimizer
  tries to decode the texture, where it *hangs* rather than reporting an error.
  Extraction now verifies every embedded image against its declared format, in
  memory and again after serialisation, and retries a failed asset up to four
  times. `validate-extracted-assets` repeats the check over the whole library.
- **Ground cover inherited 1024 px textures.** KTX2 has a per-texture floor cost,
  so a 37-triangle weed published at 1.19 MiB. The new `textureSize` extraction
  option caps them at 256 px; those five assets now publish at 37-59 KiB. The
  runtime set is smaller with 50 assets (37.84 MiB) than it was with 34 (34.70
  MiB plus the oak's uncompressed 2.37 MiB). `validate:runtime-assets` caught
  this by rejecting a published set larger than its inputs.

Still outstanding: the impostor rebake (§5.1 changes prototype order, and the
checked-in manifest still describes the old 16-prototype set) and the A/B
`qa:perf` run, both of which need a dev server.
