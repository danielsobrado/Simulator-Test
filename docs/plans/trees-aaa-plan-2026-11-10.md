# Trees plan — 2026-11-10

This is a work order for an implementing agent. Every phase names the files, the
change, the values, the test and the numbers that decide pass or fail. Do the
phases in order, one commit per phase, on `main`. Do not add anything this
document does not ask for.

Read `CLAUDE.md`, [perf-qa.md](../perf-qa.md),
[authored-natural-assets.md](../authored-natural-assets.md) and
[lod-impostor-plan.md](../lod-impostor-plan.md) first. Their rules apply to
every phase: no `viewport*Texture` nodes, no scene lights, no new terrain
samplers. Trees are the one layer allowed to block the first frame, so every
tree added here is paid for at boot; the gates count that.

Companion plans: [understory](understory-aaa-plan-2026-11-10.md) (saplings,
stumps and roots live there) and
[environment coherence](environment-coherence-plan-2026-11-10.md) (autumn
confinement, taiga canopy snow and the forest height limit live there). This
plan does not repeat them.

## 1. Where the trees stand

Found by reading the code, the config and the 2026-11-09 captures.

**Already strong — leave alone.**

- The nine meadow trees (`assets/trees/meadow/tree1–9`): curved trunks, flared
  roots, 5 600–14 200 triangles of leaf cards. `forest-off-12` is on the
  "reads well" list because of them.
- The swamp giants and savanna acacias, built in Blender with
  `tools/blender/tree_kit.py`.
- The shading stack: triplanar bark with parallax and weathering
  (`TreeBarkMaterial.js`, `barkWeathering.js`), runtime root flares
  (`forest/treeRoots.js`), per-prototype canopy occlusion, leaf transmission,
  the canopy grade, per-biome hue, canopy snow, wind sway, near mesh → proxy →
  impostor → canopy cluster.

**Weak — this plan.**

1. **The boreal conifers are low-poly placeholders.** Taiga draws
   `forest-pack/tree-narrow-01` (285 triangles) and `tree-wide-01` (624) plus
   the primary scene's pines. The config comments record the workarounds:
   their small tiled leaf texture reads as its average colour and needs
   `leafGain: 2–3`; the primary pines needed their alpha cutoff lowered because
   it "ate the needles". In `taiga-off-12` they are stacked cones.
2. **The rainforest has no tree of its own.** `tropical_tall` is served by
   `tree-scene/tree-02` (one 4 599-triangle crown) and the meadow's green
   trees. Nothing is tall, buttressed or layered, so a rainforest is a meadow
   wood with a darker tint.
3. **Temperate rainforest** leans on `tree-scene/tree-03` (1 806 triangles)
   and two more forest-pack crowns the config itself calls "broadleaf-shaped
   crowns on a 1.8 m low-poly stem".
4. **Bark is a 128 px procedural texture.** `ProceduralBarkTextures.js`
   synthesises every `barkProfile` at `BARK_RESOLUTION = 128`. At eye height a
   trunk fills a third of the screen; the parallax has only 128 texels of
   relief to work with.
5. **A storm does not move the crowns** (look-round item 14). `treeSway.js`
   clamps the bend to ±0.1 whatever the wind does.

### 1.1 The constraints that shape every decision

- **Draws, not triangles.** The frame is CPU-bound on draw count
  ([performance-plan-2026-11-10.md](performance-plan-2026-11-10.md) §1): the
  forest pose has 34 near-tree draws for 3.5 M triangles and 13 tree shadow
  draws. Each tree prototype is a bark part and a leaf part per LOD band. So
  this plan **replaces** prototypes one for one in each biome and spends
  triangles on them.
- **Crowns are graded, bark is synthesised.** The canopy grade recolours leaf
  cards by luminance onto one green ramp, and a kit-built trunk carries a flat
  colour that the runtime's bark profile textures. So a scan gives the leaf
  and needle **cutouts** and the bark **relief**; hue stays the scene's.
- **Changing the tree pool invalidates the impostor manifest.** A rebake is
  mandatory and is its own gate.

## 2. Decisions

| Question | Decision |
| --- | --- |
| How are new trees made? | Procedurally in headless Blender with the existing `tree_kit.py` skeleton, as the swamp and savanna trees are. Not by decimating scanned trees: Poly Haven's fir and pine are 7.8 M and 17 M triangles with 467 MB and 927 MB of geometry, and collapsing a crown of needle cards destroys it. |
| What comes from scans? | Textures only, all Poly Haven CC0: needle and leaf branch atlases (`twig_*`, `leaves_*`) from four tree scans, and four tileable bark sets. No scan geometry is downloaded. |
| How many trees? | Eight new, six retired. Listed in §5.2 and §6.1. |
| Which biomes change? | Taiga (9), temperate rainforest (8), tropical rainforest (7), tropical seasonal forest (5). Grassland, deciduous forest, savanna, tundra and wetland keep their trees. |
| Primary-scene pines | Stay loaded (the shared scene is on the boot path). The new conifers take `preferredTileIds`, which already makes the registry prefer a biome's specialists, so taiga and temperate rainforest stop drawing them. They still serve the bog's spruce stands. |
| Bark | Scanned bark replaces the procedural texture for four profiles, in the same two-texture packing, at 512 px. Birch, karst and snag stay procedural (no CC0 scan fits). |
| New bark profile for the tropics? | No. Emergents use `beech` (smooth) with the scanned set; adding a profile means a new procedural fallback. |
| Leaf normal maps | Not used. The crown's light comes from baked canopy occlusion, transmission and the shape normal; adding a normal sample to every leaf fragment is the most expensive place to add one. |
| Palms, vines, hanging moss on new trees | Not in this plan (§10). |
| Blender MCP | Not used by the pipeline; the add-on was unreachable on 2026-11-10. Headless `F:\Blender 5.2\blender.exe` only. |

## 3. Phase 0 — baseline

1. Captures. If `npm run qa:look` exists, run it and keep the folder as
   `docs/qa/trees/baseline/`. Otherwise capture by hand through
   `window.__worldVisualQa` at 1600×900, hour 12, weather off: the four core
   poses of the understory plan §3 at eye level, and each again in fly mode at
   45 m, pitch −0.45, fov 60.
2. Census and timing at the forest pose and at the taiga pose
   (`--x -6951 --z 10379`):

   ```bash
   node scripts/probe-render-census.mjs chunk-cross "&x=-6951&z=10379" tmp/trees/census-taiga-before.json
   ```

   Note `stylized-pine-near` draws and triangles, impostor draws and the
   shadow pass's tree draws.
3. `npm run qa:assets:startup -- --runs 2 --headed`. Note GLBs at boot, KTX2
   transcodes at boot and cumulative transcode time.

No commit.

## 4. Phase 1 — fetch the textures

### 4.1 Files

If `scripts/fetch-understory-sources.mjs` exists (understory plan phase 1),
rename it to `scripts/fetch-polyhaven-sources.mjs`, keep its npm script
pointing at it, and add the map mode below. If it does not exist, create
`scripts/fetch-polyhaven-sources.mjs` with the map mode only. Either way:

| File | Action |
| --- | --- |
| `scripts/tree-sources.config.mjs` | New. The two tables of §4.2 as data. |
| `scripts/fetch-polyhaven-sources.mjs` | Map mode: download named maps of an asset, not its model. |
| `assets/source-cache/` | Git-ignored download cache (add to `.gitignore` if absent). |
| `assets/source-library/polyhaven-trees.lock.json` | New, committed: id, map, path, URL, md5, size, authors. |
| `assets/README.md` | New section "Poly Haven tree textures": ids, authors from the lock file, "CC0 1.0", the commands of this plan. |
| `package.json` | Add `"fetch:tree-sources": "node scripts/fetch-polyhaven-sources.mjs --config scripts/tree-sources.config.mjs"`. |

### 4.2 What to fetch

All ids and map names were read from `https://api.polyhaven.com/files/<id>` on
2026-11-10. Resolution `2k` throughout; take the `png` format for alpha and
mask maps and `jpg` for the rest.

Branch atlases:

| Id | Maps | Used for |
| --- | --- | --- |
| `fir_tree_01` | `twig_diff`, `twig_alpha` | spruce and fir needle sprays |
| `pine_tree_01` | `twig_diff`, `twig_alpha` | pine needle clusters |
| `island_tree_02` | `leaves_diff`, `leaves_alpha` | rainforest emergent crowns |
| `tree_small_02` | `leaves_diff`, `leaves_alpha` | rainforest mid-storey crown |

Bark sets (texture assets, tileable):

| Id | Maps | Bark profile it replaces |
| --- | --- | --- |
| `japanese_cedar_bark` | `Diffuse`, `nor_gl`, `Rough`, `Displacement` | `spruce` |
| `pine_bark` | same four | `pine` |
| `japanese_zelkova_bark` | same four | `beech` |
| `bark_willow_02` | same four | `swamp` |

The bark picks are made from the assets' names and categories, not from
looking at them. The phase 3 contact sheet is where the user confirms or
swaps them; a swap is a one-line change in `tree-sources.config.mjs`.

### 4.3 The map mode

For each `{ id, maps }`: `GET https://api.polyhaven.com/files/<id>` and
`GET https://api.polyhaven.com/info/<id>` with the header
`User-Agent: world-builder-asset-fetch/1.0` and nothing else. For each map
name take `response[map]['2k'][format]`, download `url` to
`assets/source-cache/polyhaven/<id>/<id>_<map>_2k.<format>`, verify the md5,
skip files already present and correct, and write the lock file sorted by id
then map. Never read the `gltf`, `fbx`, `usd` or `blend` keys in this mode.
`--check` verifies the cache against the lock and downloads nothing.

**Gate.** `npm run fetch:tree-sources` exits 0; a second run downloads nothing;
the cache holds 24 files and under 80 MiB. If a map name is missing from a
response, stop and report it; do not substitute.

**Commit.** `Tree sources: scanned needle, leaf and bark maps fetched by a locked, checksummed script`

## 5. Phase 2 — build eight trees in Blender

### 5.1 Files

| File | Action |
| --- | --- |
| `tools/blender/tree_kit.py` | Add `atlas_regions` and `whorled_conifer` (below). Nothing existing changes. |
| `tools/blender/boreal_trees/build_boreal_trees.py` | New, modelled on `savanna_trees/build_savanna_trees.py`. |
| `tools/blender/rainforest_trees/build_rainforest_trees.py` | New, modelled on `swamp_trees/build_swamp_trees.py` (it already builds a fluted bole on buttress roots). |
| `assets/runtime-sources/trees/boreal/*.glb` | Five outputs. |
| `assets/runtime-sources/trees/rainforest/*.glb` | Three outputs. |

Run each like the existing builders:

```bash
"F:\Blender 5.2\blender.exe" -b --factory-startup --python tools/blender/boreal_trees/build_boreal_trees.py
```

```bash
"F:\Blender 5.2\blender.exe" -b --factory-startup --python tools/blender/rainforest_trees/build_rainforest_trees.py
```

Both accept `--no-render` and `--only <name>` as the existing ones do. Every
random draw comes from a seeded RNG, so a rerun is byte-stable.

### 5.2 The trees

| Name | Species | Seed | Height (m) | Crown radius (m) | Base radius (m) | Atlas | Triangles (trunk + cards) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `spruce-01` | `conifer_narrow` | 311 | 16 | 2.2 | 0.26 | `fir_tree_01` | ≤ 1 800 + ≤ 5 200 |
| `spruce-02` | `conifer_narrow` | 331 | 21 | 2.7 | 0.34 | `fir_tree_01` | ≤ 2 000 + ≤ 6 000 |
| `fir-01` | `conifer_wide` | 347 | 18 | 3.6 | 0.38 | `fir_tree_01` | ≤ 2 000 + ≤ 6 400 |
| `pine-01` | `conifer_wide` | 367 | 15 | 3.8 | 0.32 | `pine_tree_01` | ≤ 2 200 + ≤ 4 800 |
| `pine-02` | `conifer_narrow` | 389 | 19 | 3.0 | 0.36 | `pine_tree_01` | ≤ 2 200 + ≤ 5 200 |
| `emergent-01` | `tropical_tall` | 401 | 26 | 6.5 | 0.75 | `island_tree_02` | ≤ 3 200 + ≤ 7 600 |
| `emergent-02` | `tropical_tall` | 421 | 22 | 5.5 | 0.6 | `island_tree_02` | ≤ 2 800 + ≤ 6 800 |
| `midstorey-01` | `broadleaf_tall` | 443 | 12 | 3.4 | 0.24 | `tree_small_02` | ≤ 1 600 + ≤ 5 200 |

Every tree is at least as tall as it is wide: `StylizedTreePrototypes`
rejects one that is not (`isUprightSize`).

### 5.3 `atlas_regions(diff_path, alpha_path, count)` in `tree_kit.py`

The scans' branch atlases hold several sprays on one sheet, laid out
differently per asset. Find them instead of hard-coding rectangles:

1. Load both images, resize to 1024×1024, threshold alpha at 0.5.
2. Label 4-connected components (an iterative flood fill over the numpy mask;
   Blender's Python has no scipy). Discard components under 0.5 % of the
   image.
3. Keep the `count` largest. For each: the bounding box padded by 4 px and
   clamped; the principal axis by PCA over its pixel coordinates; the **base**
   is the end of that axis whose outer 10 % slice holds fewer opaque pixels
   (the bare stem is thinner than the foliage).
4. Return, largest first, `{ uv_min, uv_max, base_uv, tip_uv, aspect }`. Fail
   with a clear message if fewer than `count` components survive.
5. Write the leaf atlas the GLB will carry: RGB from the diffuse, A from the
   alpha, 1024×1024 PNG under `tmp/<kit>/textures/`. Normalise RGB by one gamma
   so the mean sRGB luma over opaque pixels is **0.36**: the canopy grade's
   dark-texel guard left the forest-pack crowns ungraded at about 0.05 linear,
   which is why they needed `leafGain`.

Use `count = 6` for the two conifer atlases and `count = 4` for the two leaf
atlases. A card's quad maps its base edge to `base_uv` and its tip to
`tip_uv`, so a spray always grows outward along its branch.

### 5.4 `whorled_conifer(rng, spec)` in `tree_kit.py`

Returns the same `(branches, cards)` the swamp and savanna builders pass to
`tube_mesh` and `card`. `spec` fields and the values per tree:

| Field | Meaning | spruce-01 / 02 | fir-01 | pine-01 / 02 |
| --- | --- | --- | --- | --- |
| `clear_bole` | share of height with no live branches | 0.18 / 0.22 | 0.2 | 0.5 / 0.58 |
| `whorl_spacing` | metres between whorls | 0.7 / 0.8 | 0.85 | 1.3 / 1.4 |
| `per_whorl` | branches per whorl | 5 | 5 | 3 |
| `profile_power` | crown outline, `r(t) = R (1 − t)^p`, `t` up the crown | 0.85 | 0.7 | 0.45 |
| `droop` | radians a branch falls below level at its tip | 0.5 / 0.6 | 0.3 | −0.25 (rises) |
| `stations` | card stations along a branch | 4 | 5 | 2, at the outer 40 % |
| `card_width` | metres, at the widest whorl | 1.1 / 1.25 | 1.5 | 1.3 |
| `lean` | trunk lean, radians | 0.02 | 0.02 | 0.08 / 0.05 |

Rules common to all five:

- Trunk: one `Branch` from the ground to the tip, straight but for `lean` and
  a seeded wobble of at most 0.15 m, radius from the base radius to 0.03 m,
  tapering linearly above the clear bole.
- Whorls start at `clear_bole × height`, each rotated by the golden angle plus
  a seeded ±0.2 rad. Branch length is `r(t)` with ±12 % seeded variation; the
  top 6 % of the crown is one upright leader card pair.
- Each branch is a 3-sided tube (`tube_mesh` picks 3 sides under 0.08 m
  radius). Below the live crown add three to five bare, broken stubs 0.3–0.9 m
  long (spruce and pine only).
- At each station place two cards crossed at 90° about the branch axis, width
  scaling with `r(t)/R`, each choosing an atlas region by seeded roll.
- If the card triangles exceed the §5.2 limit, drop whole cards, lowest whorls
  first, alternating branches. Never shrink or simplify a card.

### 5.5 The rainforest builder

Copy the structure of `build_swamp_trees.py` and change only what follows.

- **Emergents.** A straight bole to 55 % of the height with no branches, on
  five (`emergent-01`) or four (`emergent-02`) plank buttresses reaching
  2.2 m and 1.8 m up the trunk and 2.4 m and 1.9 m out; reuse the swamp
  giant's fluting `radius_scale`. At the top of the bole, four or five limbs
  rise at 35–50° and fork twice into a wide, shallow dome
  (`grow` with `phototropism` low and `max_depth` 3). No hanging moss, no bare
  twig lattice.
- **Mid-storey.** A slender, slightly leaning trunk (0.1 rad) forking at 40 %
  of its height into three limbs and a rounded crown.
- **Crown cards.** Leaf sprays from the atlas regions at every branch tip of
  depth 2 and 3: three cards per tip, fanned 60° apart and tilted 20–40° below
  the branch so the crown reads from below. Card length 2.2–3.0 m on the
  emergents and 1.4–1.9 m on the mid-storey.
- Over the card limit: drop whole cards from the crown's interior first (the
  tips farthest from the crown's surface along the limb).

### 5.6 Materials, names and export

Use `tree_kit.material`, `assemble` and `export` unchanged, so each GLB is one
bark mesh and one leaf mesh under one empty.

| Kit | Bark material | Bark colour (linear RGB) | Leaf material |
| --- | --- | --- | --- |
| boreal, spruce and fir | `Boreal bark` | (0.13, 0.10, 0.08) | `Boreal needles` |
| boreal, pines | `Boreal bark` | (0.20, 0.12, 0.07) | `Boreal needles` |
| rainforest | `Rainforest bark` | (0.24, 0.22, 0.19) | `Rainforest leaves` |

Bark carries a colour and no texture, as the swamp trees do: the runtime's
bark profile textures it. Previews: `render_preview` per tree and one contact
sheet per kit under `tmp/boreal/blender/` and `tmp/rainforest/blender/`.

### 5.7 Gate

- Eight GLBs exist; each has exactly two meshes and two materials with the
  names above; triangle counts are within §5.2.
- Each builder run twice produces identical file hashes.
- Send both contact sheets to the user. A spruce must read as a spruce and a
  pine as a pine at thumbnail size; the emergents must show buttresses and a
  crown clear of the bole. This is the user's call. If the user rejects a
  tree, change only its row in §5.2 or its column in §5.4 and rebuild.

**Commit.** `Boreal conifers and rainforest trees built headless with scanned needle and leaf sprays`

## 6. Phase 3 — scanned bark

### 6.1 Offline packing

**Files.** New `scripts/build-bark-scans.mjs`; npm script
`"build:bark-scans"`; outputs under `public/assets/textures/bark/scans/`.

Read `createProceduralBarkPixels` in
`src/editor/stylized/forest/ProceduralBarkTextures.js` first. The script must
write the **same two textures with the same channel layout** that function
returns (`albedoHeight` and `normalRoughness`); copy the layout from its code,
not from this document. For each bark set, with `sharp`:

1. Resize all four maps to 512×512.
2. `albedoHeight`: RGB from `Diffuse`, A from `Displacement` remapped so its
   5th–95th percentile spans 0–1.
3. `normalRoughness`: the normal's X and Y from `nor_gl`, roughness from
   `Rough`, in the channels the procedural texture uses.
4. Match the profile's tone: scale RGB so the mean linear albedo equals the
   mean of that profile's `deep` and `high` colours in `BARK_PROFILES`
   (per-channel), so `barkGrade` and the weathering keep their balance.
5. Seam check: for each of the four edges, the mean absolute difference
   across the wrap must be at most 1.5× the mean difference between adjacent
   interior rows or columns. Fail the build if not.
6. Write `<profile>-albedo-height.png` and `<profile>-normal-roughness.png`,
   and a contact sheet `tmp/trees/bark-scans.png` showing each profile's
   procedural tile beside its scan at the same size.

### 6.2 Runtime

**Files.** `src/editor/stylized/forest/ProceduralBarkTextures.js`,
`src/editor/stylized/StylizedTreeView.js`, `editor.config.yaml`,
`src/config/validateEditorConfig.js`.

1. Config, under `stylizedSurface.assets`:

   ```yaml
       # Scanned bark per profile (scripts/build-bark-scans.mjs); a profile not
       # listed keeps its procedural texture.
       barkScans:
         spruce: /assets/textures/bark/scans/spruce
         pine: /assets/textures/bark/scans/pine
         beech: /assets/textures/bark/scans/beech
         swamp: /assets/textures/bark/scans/swamp
   ```

   Validate: an object whose keys are known bark profiles and whose values are
   strings starting with `/assets/`.
2. In `ProceduralBarkTextures.js` export
   `createScannedBarkTextures({ profile, albedoHeight, normalRoughness })`. It
   takes two loaded `THREE.Texture`s, gives them exactly the wrap, filter,
   colour-space and mipmap settings `createTexture` in the same file gives the
   procedural ones, and returns the same frozen shape
   (`{ profile, albedoHeight, normalRoughness }`).
3. In `StylizedTreeView`, load every configured scan pair once, in the same
   awaited step that loads the tree variants (trees may block the first
   frame; nothing else may). Where it now calls
   `createProceduralBarkTextures({ profile, seed })`, use the scan for that
   profile when one is loaded, else the procedural texture. A failed scan load
   logs once and falls back; it must not fail the tree bootstrap.
4. Trees that share a profile now share one texture pair. Push each pair to
   `this.textures` once, not per variant, so disposal does not double-free.

**Do not** change `TreeBarkMaterial.js`, the parallax settings or
`barkGrade`.

**Test.** `createScannedBarkTextures` returns textures whose wrap and filter
settings equal the procedural ones'; the tree view falls back to procedural
when a profile has no scan; config validation rejects an unknown profile key.

### 6.3 Gate

- `npm run build:bark-scans` exits 0 (seam check included).
- Send `tmp/trees/bark-scans.png` to the user. This is where the four bark
  picks of §4.2 are confirmed. To swap one, change its id in
  `tree-sources.config.mjs`, re-fetch, rebuild.
- `npm test` passes.
- Eye-level capture at `core-taiga` and `core-deciduous` with a trunk within
  3 m: plates and fissures are visible as relief, with no tiling seam and no
  stretching on the root flare.
- Performance A/B per
  [performance-plan-2026-11-10.md](performance-plan-2026-11-10.md) §2, forest
  pose: `gpuRender.total.avgMs` within +0.15 ms and
  `summary.phases.render.avgMs` within +0.05 ms of the baseline mean. If the
  GPU gate fails, rebuild the scans at 256 px and re-run once; if it still
  fails, remove the `barkScans` block (the code path stays).

**Commit.** `Scanned bark at 512 px replaces the procedural texture for spruce, pine, beech and swamp`

## 7. Phase 4 — place the trees and rebake

### 7.1 Config: `editor.config.yaml`, `treeVariants`

Add, in the block style of the swamp giants (one key per line):

| scene | trunkMaterial | leafMaterial | species | barkProfile | barkScale | barkSeed | tileIds | preferredTileIds |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/assets/trees/boreal/spruce-01.glb` | Boreal bark | Boreal needles | conifer_narrow | spruce | 0.8 | 311 | `[8, 9]` | `[8, 9]` |
| `/assets/trees/boreal/spruce-02.glb` | Boreal bark | Boreal needles | conifer_narrow | spruce | 0.8 | 331 | `[9]` | `[9]` |
| `/assets/trees/boreal/fir-01.glb` | Boreal bark | Boreal needles | conifer_wide | spruce | 0.75 | 347 | `[8, 9]` | `[8, 9]` |
| `/assets/trees/boreal/pine-01.glb` | Boreal bark | Boreal needles | conifer_wide | pine | 0.8 | 367 | `[9]` | `[9]` |
| `/assets/trees/boreal/pine-02.glb` | Boreal bark | Boreal needles | conifer_narrow | pine | 0.8 | 389 | `[8, 9]` | `[8, 9]` |
| `/assets/trees/rainforest/emergent-01.glb` | Rainforest bark | Rainforest leaves | tropical_tall | beech | 0.6 | 401 | `[7]` | `[7]` |
| `/assets/trees/rainforest/emergent-02.glb` | Rainforest bark | Rainforest leaves | tropical_tall | beech | 0.6 | 421 | `[5, 7]` | `[7]` |
| `/assets/trees/rainforest/midstorey-01.glb` | Rainforest bark | Rainforest leaves | `[broadleaf_tall, broadleaf_round]` | beech | 0.7 | 443 | `[7, 8]` | `[7]` |

All with `scale: 1`. No `leafGain`, no `canopyGrade: false`: the atlases were
normalised for the grade in §5.3.

**Remove** these six `treeVariants` entries. Leave their GLBs under
`assets/`; delete only the config entries and their published copies.

| Entry | Why it can go |
| --- | --- |
| `forest-pack/tree-wide-01.glb` | `conifer_wide` is covered by `fir-01`, `pine-01` and, outside 8 and 9, the primary pines |
| `forest-pack/tree-wide-02.glb`, `tree-wide-03.glb` | tile 8 only; replaced by `fir-01` |
| `forest-pack/tree-narrow-01.glb` | tiles 9 and 10; taiga takes the spruces, tundra prefers `tree10`/`tree11` |
| `tree-scene/tree-02.glb` | tile 7 only; replaced by the emergents |
| `tree-scene/tree-03.glb` | tile 8 only; `broadleaf_tall` there is covered by the pale meadow trees and `midstorey-01` |

After the edit every species in every biome's palette
(`ForestSpeciesRegistry` `DEFAULT_PALETTES`) must still resolve to at least
one prototype. Add one unit test that builds the registry from the shipped
config and asserts that for tiles 3–10 and 12.

### 7.2 Publish, rebake, validate

```bash
npm run optimize:runtime-assets
```

```bash
npm run bake:impostors -- --url http://localhost:5174/
```

```bash
npm run validate:impostors:required
```

```bash
npm run validate:assets
```

```bash
npm run qa:vegetation:lod -- --headed
```

Wait for the perf-run lock before the bake and the QA run, as every browser
script here does. Commit the regenerated impostor manifest and atlases with
this phase.

### 7.3 Gate

- All five commands pass. `npm test` passes, including the coverage test.
- Startup (`qa:assets:startup`, two runs): GLBs at boot at most baseline + 2;
  cumulative KTX2 transcode time at most baseline + 0.8 s.
- Census at the taiga pose and the forest pose: `stylized-pine-near` draws at
  most baseline + 4; near-tree triangles at most baseline + 2.5 M; shadow-pass
  tree draws at most baseline + 2.
- Performance A/B per the performance plan §2, at the forest pose and at the
  taiga pose (`--x -6951 --z 10379`), baseline = the commit before this phase:
  `summary.phases.render.avgMs` within +0.25 ms and `gpuRender.total.avgMs`
  within +0.8 ms. If the GPU gate fails, rebuild the five conifers with the
  card limits of §5.2 lowered by 25 %, republish, rebake, re-run once. Record
  what shipped.
- Captures at `core-taiga`, `core-temperate-rainforest` and `core-rainforest`,
  eye level and from 45 m: no forest-pack cone in frame; the taiga skyline is
  spires of two heights with open-crowned pines among them; the rainforest
  shows emergents standing above the meadow-tree canopy. Watch one impostor
  transition per new tree while flying out: no pop in silhouette or colour.
  Send the six before and after pairs to the user.

**Commit.** `Taiga and rainforest wear their own trees: five conifers and three rainforest trees, impostors rebaked`

## 8. Phase 5 — crowns that answer a storm

**Why.** Look-round item 14: grass sways in a storm, crowns do not.
`treeSway.js` compresses the gust (`field.envelope.clamp(0.35, 3).sqrt()`)
and then clamps the bend to ±0.1.

**File.** `src/editor/stylized/forest/treeSway.js`.

**Change.** Replace the fixed bend clamp with one the storm opens:

```js
/** Bend limit in calm air, and how far a full storm opens it. */
const CALM_BEND = 0.1;
const STORM_BEND = 0.07;
```

and where `angle` is clamped with `.clamp(-0.1, 0.1)`, clamp to ±`limit`:

```js
  const limit = float(CALM_BEND).add(stormLevelUniform.mul(STORM_BEND));
  // … .mul(strength).mul(gust).mul(compliance).clamp(limit.negate(), limit);
```

`stormLevelUniform` does not exist yet.
`src/editor/weather/storm/stormGroundUniforms.js` exports only
`stormSnowCoverUniform` and `stormRainUniform`. Add a third there:

```js
/** 0..1 eased storm level (StormState frame `storm`), for what the wind may bend. */
export const stormLevelUniform = uniform(0);
```

and write it in `src/main.js` on the line after `stormRainUniform` is
written, from the same storm frame's `storm` field (the 0..1 value
`stormAirLook` receives). Do not read the weather controller from the shader
module. The storm already drives the world wind, so the gust term rises on its
own; only the clamp was holding the crowns still.

Bark and leaves share this function (`treeBendPosition` and `foliageWind.js`
both go through `treeSwayField`), so trunk and crown stay joined. Impostors do
not sway and are unchanged.

**Test.** No sway test exists; add `test/tree-sway.test.js`. Export the two
constants and a pure `treeBendLimit(storm)` returning
`CALM_BEND + STORM_BEND × storm`, and assert 0.1 at storm 0 (calm captures are
unchanged) and 0.17 at storm 1.

**Gate.** `npm test`; `npm run qa:weather:browser`; in `forest-storm-12` and a
five-second watch of the forest pose at storm 1, crowns lean with the gusts
and no trunk separates from its roots or its crown. No performance run:
one uniform read.

**Commit.** `Tree crowns lean further in a storm`

## 9. Phase 6 — record

1. [authored-natural-assets.md](../authored-natural-assets.md): the tree row
   of "Runtime coverage", a paragraph on kit-built trees with scanned sprays,
   and the bark scan pipeline.
2. `assets/README.md`: the fetch and build commands.
3. `docs/perf-qa.md`: the census, startup and A/B tables in its existing
   style.
4. `docs/biome-looks.md`: one line under the taiga notes that its conifers are
   now `trees/boreal`.

**Commit.** `Trees recorded: kit-built conifers and rainforest trees, scanned bark, measured cost`

## 10. Not in this plan

- **Palms and tree ferns.** No CC0 palm frond atlas was found on Poly Haven;
  a painted one would repeat the problem this plan removes.
- **Lianas, hanging moss and epiphytes on the new trees.** Each is another
  card set per prototype; judge the rainforest after phase 4 first.
- **Leaf normal maps and per-leaf flutter.** See §2.
- **Replacing the meadow, swamp, savanna or alpine trees.** They are the good
  ones.
- **Dead snags as prototypes.** `findPrototypeRoots` requires a leaf and a
  trunk material; allowing leafless prototypes touches the impostor baker.
- **Merging bark and leaf into one draw, or batching prototypes.** It is the
  real fix for tree draw count and it is a renderer project, not an art pass.
- **New bark profiles** (a tropical one, an oak). Each needs a procedural
  fallback and a validated config key.
- **Seasonal bare crowns.** There is no season state.

## 11. Expected result

| Before | After |
| --- | --- |
| Taiga of 285–630 triangle cones | Spruces, a fir and two pines at 7–8 k triangles with scanned needle sprays |
| Rainforest drawn with meadow trees | Buttressed emergents to 26 m over a mid-storey |
| 128 px procedural bark | 512 px scanned relief on spruce, pine, beech and swamp trunks |
| Crowns still in a storm | Crowns lean up to 70 % further at full storm |
| 24 tree variants in config | 26, with six placeholders retired |

What decides whether it reads as AAA is the two contact sheets of phase 2, the
bark sheet of phase 3 and the six capture pairs of phase 4. All go to the
user.
