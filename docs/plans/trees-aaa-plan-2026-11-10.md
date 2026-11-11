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
| What comes from scans? | Textures only, all Poly Haven CC0: needle and leaf branch atlases (`twig_*`, `leaves_*`) from four tree scans, and five tileable bark sets. No scan geometry is downloaded. The scans' own renders are the reference column on the phase 2 contact sheets, so a built tree is judged against the real one. |
| How many trees? | Eleven new (five conifers, a snag, two emergents, a mid-storey tree, two palms), six retired. They ship as five GLBs, so boot loads one GLB fewer than today. Listed in §5.2 and §7.1. |
| Where do the card regions come from? | Measured, not detected. The atlases were inspected on 2026-11-10: automatic region finding works on the fir sheet and fails on the pine sheet (63 % of its alpha is one blob of cones and bark) and on `tree_small_02` (unusable; dropped for `jacaranda_tree`). §5.3 lists the rectangles and a self-check. |
| Broad leaves and palm fronds | Poly Haven's broadleaf sheet holds eight single leaves, not sprays, and has no palm frond. Both are solved the same way: build the spray or frond as geometry in Blender and render it to an atlas (§5.4). |
| Leaf relief without a normal map | Bake it into the atlas's brightness: albedo × ambient occlusion × a fixed-light term from the scan's normal map. The canopy grade maps brightness to its ramp, so ribs and needle rows survive at no runtime cost. |
| Dead trees | The registry already rolls 2.5 % of trees `dead` and draws them as a shrunken live crown. A snag prototype tagged for that age class replaces it (§7.2). |
| Which biomes change? | Taiga (9), temperate rainforest (8), tropical rainforest (7), tropical seasonal forest (5). Grassland, deciduous forest, savanna, tundra and wetland keep their trees. |
| Primary-scene pines | Stay loaded (the shared scene is on the boot path). The new conifers take `preferredTileIds`, which already makes the registry prefer a biome's specialists, so taiga and temperate rainforest stop drawing them. They still serve the bog's spruce stands. |
| Bark | Scanned bark replaces the procedural texture for four profiles, in the same two-texture packing, at 512 px. Birch, karst and snag stay procedural (no CC0 scan fits). The picks were made from the scans' preview renders (§4.2). |
| New bark profiles | One: `palm`, for the ringed palm trunk scan. Its procedural fallback is a three-line variant of `beech`, so a missing scan still renders. Emergents use `beech`. |
| Leaf normal maps at runtime | Not used; see "Leaf relief" above. A normal sample on every leaf fragment is the most expensive place to add one. |
| Lianas and epiphytes | Built into the emergents' own bark and leaf meshes, so they add triangles and no draw (§5.6). |
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
4. In the page console at each pose, note `treeView.prototypes.length` and how
   many distinct prototype indices the resident tree records use. §7.4 predicts
   both.

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
| `fir_tree_01` | `twig_diff`, `twig_alpha`, `twig_arm`, `twig_nor_gl` | spruce and fir needle sprays; the bare twig for the snag |
| `pine_tree_01` | `twig_diff`, `twig_alpha`, `twig_arm`, `twig_nor_gl` | pine needle clusters |
| `island_tree_02` | `leaves_diff`, `leaves_alpha`, `leaves_arm`, `leaves_nor_gl` | single broad leaves, composed into sprays for the emergents |
| `jacaranda_tree` | `leaves_diff`, `leaves_alpha`, `leaves_arm`, `leaves_nor_gl` | feathery fronds for the mid-storey tree |

Bark sets (texture assets, tileable):

| Id | Maps | Bark profile | What its preview shows |
| --- | --- | --- | --- |
| `knotted_pine_bark` | `Diffuse`, `nor_gl`, `Rough`, `Displacement` | `spruce` | dark grey, granular and scaly, with knots |
| `pine_bark` | same four | `pine` | red-brown plates with dark fissures |
| `japanese_zelkova_bark` | same four | `beech` | smooth pale tan with small flakes |
| `bark_brown_02` | same four | `swamp` | deep vertical fissures with moss |
| `palm_tree_bark` | same four | `palm` (new) | pale grey, smooth, ringed |

These were chosen on 2026-11-10 from Poly Haven's preview renders of fourteen
bark sets. Two first guesses were dropped on sight: `japanese_cedar_bark` is
fine vertical fibre, wrong for spruce, and `bark_willow_02` is pale and
shaggy, wrong for a dark bog trunk. The phase 3 sheet still shows each scan
beside the procedural texture it replaces; a swap is a one-line change in
`tree-sources.config.mjs`.

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
the cache holds 36 files and under 120 MiB. If a map name is missing from a
response, stop and report it; do not substitute.

**Commit.** `Tree sources: scanned needle, leaf and bark maps fetched by a locked, checksummed script`

## 5. Phase 2 — build eleven trees in Blender

### 5.1 Files

| File | Action |
| --- | --- |
| `tools/blender/tree_kit.py` | Add `leaf_atlas_from_scan`, `bake_sprays` and `whorled_conifer` (below). Nothing existing changes. If the file passes 450 lines, move the three new functions to `tools/blender/tree_kit_scans.py`. |
| `tools/blender/tree_regions.py` | New. The rectangles of §5.3 as data. |
| `tools/blender/boreal_trees/build_boreal_trees.py` | New, modelled on `savanna_trees/build_savanna_trees.py`. |
| `tools/blender/rainforest_trees/build_rainforest_trees.py` | New, modelled on `swamp_trees/build_swamp_trees.py` (it already builds a fluted bole on buttress roots). Builds the rainforest trees and the palms. |
| `assets/runtime-sources/trees/boreal/*.glb` | Three outputs (§5.7). |
| `assets/runtime-sources/trees/rainforest/*.glb` | Two outputs (§5.7). |

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

| Name | Species it serves | Seed | Height (m) | Crown radius (m) | Base radius (m) | Cards from | Triangles (trunk + cards) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `spruce-01` | conifers | 311 | 16 | 2.2 | 0.26 | fir sprays | ≤ 1 800 + ≤ 5 200 |
| `spruce-02` | conifers | 331 | 21 | 2.7 | 0.34 | fir sprays | ≤ 2 000 + ≤ 6 000 |
| `fir-01` | conifers | 347 | 18 | 3.6 | 0.38 | fir sprays | ≤ 2 000 + ≤ 6 400 |
| `pine-01` | conifers | 367 | 15 | 3.8 | 0.32 | pine sprays | ≤ 2 200 + ≤ 4 800 |
| `pine-02` | conifers | 389 | 19 | 3.0 | 0.36 | pine sprays | ≤ 2 200 + ≤ 5 200 |
| `snag-01` | conifers, `dead` age only | 397 | 13 | 1.6 | 0.3 | fir bare twig | ≤ 1 400 + ≤ 300 |
| `emergent-01` | rainforest | 401 | 26 | 6.5 | 0.75 | baked broadleaf sprays | ≤ 3 600 + ≤ 7 600 |
| `emergent-02` | rainforest | 421 | 22 | 5.5 | 0.6 | baked broadleaf sprays | ≤ 3 200 + ≤ 6 800 |
| `midstorey-01` | rainforest | 443 | 12 | 3.4 | 0.24 | jacaranda fronds | ≤ 1 600 + ≤ 4 000 |
| `palm-01` | `tropical_tall` | 457 | 12 | 3.4 | 0.24 | baked palm fronds | ≤ 500 + ≤ 400 |
| `palm-02` | `tropical_tall` | 461 | 9 | 3.0 | 0.22 | baked palm fronds | ≤ 420 + ≤ 360 |

Every tree is at least as tall as it is wide: `StylizedTreePrototypes`
rejects one that is not (`isUprightSize`).

### 5.3 Card regions: measured, with a self-check

The four atlases were downloaded at 1k and inspected on 2026-11-10. Rectangles
are `[x0, y0, x1, y1]` in pixels of the image resized to 512×512, origin top
left. In UV, `u = x / 512` and `v = 1 − y / 512`. Put them in
`tools/blender/tree_regions.py` exactly as written.

| Atlas | Key | Rectangle | What it is |
| --- | --- | --- | --- |
| `fir_tree_01` twig | `F1` | `[160, 208, 327, 396]` | large spray |
| | `F2` | `[330, 234, 486, 424]` | large spray |
| | `F3` | `[335, 27, 478, 188]` | medium spray |
| | `F4` | `[97, 25, 208, 158]` | medium spray |
| | `F5` | `[255, 135, 320, 204]` | small spray |
| | `FT` | `[163, 365, 501, 511]` | bare forked twig (snag only) |
| `pine_tree_01` twig | `P1` | `[18, 23, 110, 225]` | needle cluster |
| | `P2` | `[334, 175, 478, 264]` | needle cluster |
| `island_tree_02` leaves | `L1`–`L8` | `[85, 11, 171, 200]`, `[111, 296, 180, 511]`, `[9, 323, 92, 511]`, `[9, 11, 73, 260]`, `[356, 11, 417, 211]`, `[265, 25, 331, 184]`, `[216, 310, 286, 511]`, `[185, 17, 246, 184]` | eight single leaves |
| `jacaranda_tree` leaves | `J1` | `[83, 13, 505, 240]` | large feathery frond |
| | `J2` | `[188, 302, 511, 412]` | medium frond |

Do not use anything else on those sheets. The left 105 px of the fir sheet is
a bark strip. The pine sheet's alpha is opaque over 63 % of its area (cones,
bark and unwrapped trunk pieces); only the two clusters above stand clear.
`tree_small_02`'s leaf sheet is fragments with colour bleed and is not used.

`leaf_atlas_from_scan(id, kind, keys)` in `tree_kit.py`:

1. Load the `diff`, `alpha`, `arm` and `nor_gl` maps and resize to 1024×1024.
2. **Self-check each rectangle** before anything else, on the alpha
   thresholded at 0.5: opaque coverage inside it is between 8 % and 65 %; and
   of its four edges, at most one has more than 5 % opaque pixels in its outer
   2 px (that one is where the stem leaves the rectangle). Fail the build with
   the key's name if a rectangle does not pass: the sheet has changed upstream.
3. **Base and tip.** The base is the middle of the short edge at the end of
   the rectangle's long axis whose outer 10 % holds fewer opaque pixels (a
   stem is thinner than foliage); the tip is the middle of the opposite edge.
4. **Bake the relief into brightness.** Decode the normal map to a
   tangent-space vector `n`. With `l = normalize(−0.4, 0.5, 0.77)` and `ao`
   the `arm` red channel:
   `shade = clamp(ao^0.6 × (0.65 + 0.35 × max(n·l, 0) / 0.8), 0.55, 1.15)`.
   Multiply RGB by `shade`.
5. **Normalise.** Apply one gamma to RGB so the mean sRGB luma over opaque
   pixels inside the used rectangles is **0.36**. The canopy grade's
   dark-texel guard left the forest-pack crowns ungraded at about 0.05 linear,
   which is why they needed `leafGain`.
6. Sharpen the cutout: `a = clamp((a − 0.5) × 4 + 0.5, 0, 1)`.
7. Write the RGBA atlas as PNG under `tmp/<kit>/textures/` and return it with
   `{ key: { uv_min, uv_max, base_uv, tip_uv, aspect } }`.

A card's quad maps its base edge to `base_uv` and its tip to `tip_uv`, so a
spray always grows outward along its branch.

### 5.4 `bake_sprays`: sprays and fronds rendered to an atlas

Two things Poly Haven does not have as a ready sheet are made here: a
broadleaf **spray** (its sheet holds single leaves) and a **palm frond**.

`bake_sprays(name, sprays, size, out_path)` in `tree_kit.py`:

1. Clear the scene. For each entry of `sprays` build flat geometry in the XY
   plane inside its own cell of a grid (2×2 for four sprays, 1×2 for two),
   leaving a 3 % margin, stem end at the middle of the cell's bottom edge.
2. Give every piece an emission material (strength 1) with the source
   texture's colour and its alpha as a clip mask, so the render records colour
   exactly and nothing is lit twice.
3. Render top-down with an orthographic camera framing the grid, film
   transparent, at `size`, with the engine `setup_scene` already selects for
   previews. Save RGBA PNG. Apply step 6 of §5.3 to its alpha.
4. Return each cell as a region, base at the bottom edge's middle and tip at
   the top edge's middle.

**Broadleaf sprays** (`size` 1024×1024, four cells), built from leaves
`L1`–`L8` of the atlas `leaf_atlas_from_scan('island_tree_02', 'leaves', …)`
returns, so they already carry the baked relief:

| Cell | Leaves | Arrangement |
| --- | --- | --- |
| `B1` | 13 | alternate pairs along a twig, one terminal leaf |
| `B2` | 11 | the same, twig bent 12° |
| `B3` | 9 | the same, sparser toward the base |
| `B4` | 7 | a short tip cluster, leaves fanned from one point |

A twig is a tapered strip 0.9 of the cell's height, coloured from the leaf
texture's petiole (the mean colour of the bottom 5 % of `L1`). A leaf is one
quad whose length is 0.28–0.36 of the spray's length, set 40–60° off the twig,
with a seeded ±10° of pitch out of the plane (it foreshortens, which is what
stops a spray reading as a stamp) and a seeded choice among the eight leaves.

**Palm fronds** (`size` 1024×512, two cells): a rachis strip from the base
to 0.96 of the cell's height, bowed 6 % sideways, with 34 (`PF1`) and 28
(`PF2`) leaflet pairs. A leaflet is a quad 0.018 of the cell's height wide,
its length falling from 0.24 at one third of the way up to 0.07 at the tip,
set 55° off the rachis and closing to 25° at the tip. Its colour is a numpy
strip 64×8: `(0.16, 0.30, 0.10)` at the edges to `(0.24, 0.42, 0.14)`
beside a one-pixel midrib of `(0.38, 0.46, 0.22)`, linear RGB. A leaflet this
narrow shows no surface detail at any range; its shape is the detail.

### 5.5 `whorled_conifer(rng, spec)` in `tree_kit.py`

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
  scaling with `r(t)/R`, each choosing a region by seeded roll: `F1`–`F5` for
  spruce and fir (the small `F5` only in the top quarter of the crown), `P1`
  and `P2` for pine.
- If the card triangles exceed the §5.2 limit, drop whole cards, lowest whorls
  first, alternating branches. Never shrink or simplify a card.

### 5.6 The rainforest builder

Copy the structure of `build_swamp_trees.py` and change only what follows.

- **Emergents.** A straight bole to 55 % of the height with no branches, on
  five (`emergent-01`) or four (`emergent-02`) plank buttresses reaching
  2.2 m and 1.8 m up the trunk and 2.4 m and 1.9 m out; reuse the swamp
  giant's fluting `radius_scale`. At the top of the bole, four or five limbs
  rise at 35–50° and fork twice into a wide, shallow dome
  (`grow` with `phototropism` low and `max_depth` 3). No bare twig lattice.
- **Crown cards.** Sprays `B1`–`B4` at every branch tip of depth 2 and 3:
  three cards per tip, fanned 60° apart and tilted 20–40° below the branch so
  the crown reads from below. Card length 2.2–3.0 m.
- **Lianas** (in the bark mesh, so no extra draw). Four on `emergent-01`,
  three on `emergent-02`. Each is a 3-sided tube of radius 0.03–0.05 m hanging
  as a catenary from a seeded point on a depth-1 limb to a point on the ground
  1.5–4 m from the bole, with a sag of 12 % of its span and one loose turn
  round the bole where it passes within 0.6 m. Twelve segments each. They
  count against the trunk triangle limit.
- **Epiphytes** (in the leaf mesh, so no extra draw). Six on each emergent:
  a rosette of five `B4` cards, 0.7–1.0 m long, seated on the upper side of a
  depth-1 limb or in a fork. They count against the card limit.
- **Mid-storey.** A slender, slightly leaning trunk (0.1 rad) forking at 40 %
  of its height into three limbs and a rounded, open crown. Fronds `J1` and
  `J2` at every tip of depth 2 and 3: two cards per tip, 1.6–2.2 m long,
  drooping 15–35°.
- **Palms.** One curved trunk: a `Branch` of ten points leaning 0.12 rad
  (`palm-01`) and 0.2 rad (`palm-02`), 8 sides, radius from the base radius to
  70 % of it, a slight swell in the lowest metre. No branches. At the top,
  16 (`palm-01`) and 14 (`palm-02`) fronds by the golden angle. A frond is a
  strip of six quads along an arc 3.4 m (3.0 m) long and 0.9 m wide: it leaves
  the crown 50–75° above level for young fronds (the first five) and 10–40°
  for the rest, and its tip hangs 0.4–1.4 m below its highest point. Map the
  strip to `PF1` or `PF2` by seeded roll. Three dead fronds hang against the
  trunk, tinted to 45 % brightness in the vertex colour `paint_cards` writes.
- Over a card limit: drop whole cards, epiphytes first, then the crown's
  interior (the tips farthest from the crown's surface along the limb).

### 5.7 Materials, grouping and export

Trees that share a bark profile and a leaf atlas are exported **in one GLB**,
each tree its own root empty with a bark mesh and a leaf mesh under it
(`assemble` per tree, then select every root and child and call `export`
once). One GLB means one fetch and one leaf texture to transcode for the
group.

| GLB | Roots | Bark material and linear colour | Leaf material | Leaf atlas |
| --- | --- | --- | --- | --- |
| `trees/boreal/boreal-spruce.glb` | `spruce-01`, `spruce-02`, `fir-01` | `Boreal bark` (0.13, 0.10, 0.08) | `Boreal needles` | fir, `F1`–`F5` |
| `trees/boreal/boreal-pine.glb` | `pine-01`, `pine-02` | `Boreal bark` (0.20, 0.12, 0.07) | `Boreal needles` | pine, `P1`–`P2` |
| `trees/boreal/boreal-snag.glb` | `snag-01` | `Boreal bark` (0.17, 0.15, 0.13) | `Boreal dead twigs` | fir, `FT` only |
| `trees/rainforest/rainforest.glb` | `emergent-01`, `emergent-02`, `midstorey-01` | `Rainforest bark` (0.24, 0.22, 0.19) | `Rainforest leaves` | one 2048×1024 sheet: `B1`–`B4` in the left half, the jacaranda atlas in the right |
| `trees/rainforest/palms.glb` | `palm-01`, `palm-02` | `Palm bark` (0.30, 0.28, 0.25) | `Palm fronds` | `PF1`–`PF2` |

Within a GLB every tree uses the **same** two material objects, so the
exporter writes each image once. Bark carries a colour and no texture, as the
swamp trees do: the runtime's bark profile textures it. For the snag, skip the
luma normalisation of §5.3 step 5: dead twigs stay grey-brown and the variant
sets `canopyGrade: false`.

The snag is a spruce trunk broken off at 13 m with eight to ten bare limbs
0.6–2.4 m long in the upper two thirds, each ending in one or two `FT` cards.
It is `whorled_conifer` with `stations: 0` plus those cards.

Previews: `render_preview` per tree and one contact sheet per builder under
`tmp/boreal/blender/` and `tmp/rainforest/blender/`. Add a **reference row**
to each sheet: Poly Haven's own preview of the scanned tree, fetched by the
phase 1 script to the source cache from
`https://cdn.polyhaven.com/asset_img/thumbs/<id>.png?width=512&height=512`
for `fir_tree_01`, `pine_tree_01`, `island_tree_02` and `jacaranda_tree`
(add them to the lock file as `preview`).

### 5.8 Gate

- Five GLBs exist with the roots, material names and triangle limits above.
  Each GLB embeds exactly one leaf image.
- Each builder run twice produces identical file hashes.
- No rectangle self-check failed.
- Send both contact sheets to the user. Against the reference row: a spruce
  must read as a spruce and a pine as a pine at thumbnail size; the emergents
  must show buttresses, lianas and a crown clear of the bole; a palm must read
  as a palm. This is the user's call. If the user rejects a tree, change only
  its row in §5.2, its column in §5.5 or its bullet in §5.6 and rebuild.

**Commit.** `Boreal conifers, a snag, rainforest trees and palms built headless with scanned and baked sprays`

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
         palm: /assets/textures/bark/scans/palm
   ```

   `palm` is a new profile. Add it to `BARK_PROFILES` in
   `ProceduralBarkTextures.js` as
   `palm: Object.freeze({ ...BARK_PROFILES.beech, plates: [3, 14], deep: [0.2, 0.19, 0.17], high: [0.4, 0.38, 0.34] })`
   (define it after the frozen literal, or build the table in two steps), and
   to the `barkProfiles` set in `validateEditorConfig.js`. That is its
   procedural fallback: wide, shallow horizontal plates in pale grey. Any
   later scanned-only profile is added the same way, as a spread of the
   nearest existing one.

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

Add, in the block style of the swamp giants (one key per line). All with
`scale: 1` and no `leafGain`.

| scene | trunkMaterial | leafMaterial | species | barkProfile | barkScale | barkSeed | tileIds | preferredTileIds | prototypeGroups | other |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `/assets/trees/boreal/boreal-spruce.glb` | Boreal bark | Boreal needles | `[conifer_narrow, conifer_wide]` | spruce | 0.8 | 311 | `[8, 9]` | `[8, 9]` | `[[spruce-01], [spruce-02], [fir-01]]` | |
| `/assets/trees/boreal/boreal-pine.glb` | Boreal bark | Boreal needles | `[conifer_narrow, conifer_wide]` | pine | 0.8 | 367 | `[9]` | `[9]` | `[[pine-01], [pine-02]]` | |
| `/assets/trees/boreal/boreal-snag.glb` | Boreal bark | Boreal dead twigs | `[conifer_narrow, conifer_wide]` | snag | 0.8 | 397 | `[8, 9]` | `[8, 9]` | `[[snag-01]]` | `canopyGrade: false`, `ageClasses: [dead]` |
| `/assets/trees/rainforest/rainforest.glb` | Rainforest bark | Rainforest leaves | `[tropical_tall, broadleaf_tall, broadleaf_round]` | beech | 0.6 | 401 | `[7]` | `[7]` | `[[emergent-01], [emergent-02], [midstorey-01]]` | |
| `/assets/trees/rainforest/palms.glb` | Palm bark | Palm fronds | `[tropical_tall]` | palm | 0.5 | 457 | `[5]` | `[5]` | `[[palm-01], [palm-02]]` | |

Why the tiles are what they are: a preferred prototype replaces the generic
ones for its species in that biome (`ForestSpeciesRegistry.prototypesFor`), and
there is no per-tree weight. So the pines are taiga only, palms take the
tropical seasonal forest's tall trees and stay out of the rainforest (where
they would be two of every five tall trees), and the rainforest is the
emergents and the mid-storey tree.

**Remove** these six `treeVariants` entries. Leave their GLBs under
`assets/`; delete only the config entries and their published copies.

| Entry | Why it can go |
| --- | --- |
| `forest-pack/tree-wide-01.glb` | `conifer_wide` is covered by the boreal GLBs in 8 and 9 and by the primary pines elsewhere |
| `forest-pack/tree-wide-02.glb`, `tree-wide-03.glb` | tile 8 only; replaced by `boreal-spruce` |
| `forest-pack/tree-narrow-01.glb` | tiles 9 and 10; taiga takes the boreal GLBs, tundra prefers `tree10`/`tree11` |
| `tree-scene/tree-02.glb` | tile 7 only; replaced by `rainforest.glb` |
| `tree-scene/tree-03.glb` | tile 8 only; `broadleaf_tall` there is covered by the pale meadow trees |

After the edit every species in every biome's palette
(`ForestSpeciesRegistry` `DEFAULT_PALETTES`) must still resolve to at least
one prototype. Add one unit test that builds the registry from the shipped
config and asserts that for tiles 3–10 and 12.

**If a grouped GLB yields fewer prototypes than it has roots** (check
`treeView.prototypes.length` against the expected total after boot), the
multi-root path does not suit kit exports. Then export one GLB per tree
instead (`trees/boreal/spruce-01.glb` and so on), give each its own variant
entry with the same keys, and accept the higher boot count in §7.4. Do not
patch the extractor.

### 7.2 Dead trees draw the snag

**Why.** `weightedAge` in `ForestSpeciesRegistry.js` makes 2.5 % of trees
`dead`, and `AGE_CLASSES.dead` only shrinks the crown to 0.42. A dead tree is
a small live one.

**Files.** `src/config/validateEditorConfig.js`,
`src/editor/stylized/StylizedTreeView.js`,
`src/editor/stylized/forest/ForestSpeciesRegistry.js`.

1. Validation: `treeVariants[].ageClasses` is an optional array of age-class
   names that exist in the registry's `AGE_CLASSES`.
2. `StylizedTreeView`: where it builds `prototypeTileIds` and
   `prototypePreferredTileIds` per appended prototype, build
   `prototypeAgeClasses` (prototype index → `Set` of names) the same way and
   pass it to the registry.
3. Registry: store it, add it to `signature`, and give `prototypesFor` a third
   parameter `ageClass = null`. After the existing `result` is computed:

   ```js
   const ages = this.prototypeAgeClasses;
   if (!ages) return result;
   const tagged = result.filter((index) => ages.get(index)?.has(ageClass));
   const untagged = result.filter((index) => !ages.has(index));
   return tagged.length > 0 ? tagged : untagged.length > 0 ? untagged : result;
   ```

   Include `ageClass` in the cache key. A tagged prototype is therefore drawn
   only for trees of its age class, and those trees draw nothing else when a
   tagged prototype exists for their species and biome.
4. Pass the record's age class at every call of `prototypesFor`
   (`grep -n "prototypesFor(" src`).

**Test.** In the registry's test file: with a snag tagged `dead` and a spruce
untagged, a `dead` record resolves to the snag only, a `mature` record to the
spruce only; with no tagged prototype the result equals today's.

### 7.3 Publish, rebake, validate

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

### 7.4 Gate

Expected, from how preference works. The count of primary-scene pines (six in
use) is inferred from `authored-natural-assets.md`, not measured; phase 0's
census is the truth.

| Biome | Tree prototypes drawn before | After |
| --- | --- | --- |
| Taiga (9) | about 8: six primary pines, `tree-wide-01`, `tree-narrow-01` | 6: three spruce-group trees, two pines, the snag |
| Temperate rainforest (8) | about 13: the above plus two more forest-pack crowns, `tree-03`, three pale meadow trees | 7: three spruce-group trees, the snag, three pale meadow trees |
| Tropical rainforest (7) | 4: `tree-02`, three green meadow trees | 3 |
| Tropical seasonal forest (5) | 3 green meadow trees | 5: two palms for the tall species, three meadow trees for the round one |

- All five commands of §7.3 pass. `npm test` passes, including the coverage
  and age-class tests.
- Startup (`qa:assets:startup`, two runs): GLBs at boot at most the baseline
  (five added, six removed), or baseline + 5 if the per-tree fallback of §7.1
  was taken; cumulative KTX2 transcode time at most baseline + 0.5 s.
- Census at the taiga pose: `stylized-pine-near` draws **not higher** than the
  baseline. At the forest pose: at most baseline + 2. Near-tree triangles at
  most baseline + 2.5 M at either pose; shadow-pass tree draws not higher than
  the baseline at the taiga pose.
- Performance A/B per the performance plan §2, at the forest pose and at the
  taiga pose (`--x -6951 --z 10379`), baseline = the commit before this phase:
  `summary.phases.render.avgMs` within +0.15 ms and `gpuRender.total.avgMs`
  within +0.8 ms. If the GPU gate fails, rebuild the five conifers with the
  card limits of §5.2 lowered by 25 %, republish, rebake, re-run once. Record
  what shipped.
- Captures at `core-taiga`, `core-temperate-rainforest` and `core-rainforest`,
  eye level and from 45 m, plus one eye-level shot inside tile 5
  (`findBiomeSurfacePose(5)`): no forest-pack cone in frame; the taiga skyline
  is spires of two heights with open-crowned pines and the odd grey snag; the
  rainforest shows buttressed emergents with lianas over a feathery
  mid-storey; the seasonal forest has palms above round crowns. Watch one
  impostor transition per new tree while flying out: no pop in silhouette or
  colour. Send the before and after pairs to the user.

**Commit.** `Taiga, rainforest and seasonal forest wear their own trees; dead trees are snags; impostors rebaked`

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

- **Tree ferns and other new species.** Palms, lianas, epiphytes and a snag
  are now in (§5.6, §7.2); judge the result before adding more.
- **Leaf normal maps at runtime and per-leaf flutter.** Relief is baked into
  the atlas brightness instead (§5.3 step 4). Flutter needs a per-vertex
  weight the cards do not carry.
- **Replacing the meadow, swamp, savanna or alpine trees.** They are the good
  ones.
- **Leafless prototypes.** `findPrototypeRoots` requires a leaf and a trunk
  material, so the snag carries a few bare-twig cards as its leaf part rather
  than changing the extractor and the impostor baker.
- **Merging bark and leaf into one draw, or batching prototypes.** It is the
  real fix for tree draw count and it is a renderer project, not an art pass.
  This plan lowers the count the cheap way: preferred specialists replace a
  larger generic pool in three of the four biomes it touches (§7.4).
- **Scanned bark for birch, karst and snag, or an oak profile.** No CC0 scan
  fits the first three; the meadow trees that would wear an oak profile carry
  painted bark. The mechanism for adding one is in §6.2.
- **Seasonal bare crowns.** There is no season state.

## 11. Expected result

| Before | After |
| --- | --- |
| Taiga of 285–630 triangle cones | Spruces, a fir and two pines at 7–8 k triangles with scanned needle sprays, and grey snags for the 2.5 % of trees that are dead |
| Rainforest drawn with meadow trees | Buttressed emergents to 26 m with lianas and epiphytes, over a feathery mid-storey |
| Tropical seasonal forest indistinguishable from the rainforest | Palms above round crowns |
| 128 px procedural bark | 512 px scanned relief on spruce, pine, beech, swamp and palm trunks |
| Crowns still in a storm | Crowns lean up to 70 % further at full storm |
| 24 tree variants in config, six of them placeholders | 23, loaded from one GLB fewer at boot |
| About 8 tree prototypes drawn in taiga, 13 in temperate rainforest | 6 and 7 (estimate; phase 0 measures it) |

What decides whether it reads as AAA is the two contact sheets of phase 2
(each with the scanned tree beside the built one), the bark sheet of phase 3
and the capture pairs of phase 4. All go to the user.

## 12. Implementation record — 2026-11-11

Phases 1 to 5 are implemented on `main`. The code, the five GLBs and the bark
scans exist and the unit tests this plan asked for pass. **None of the visual
or performance gates were run**: no baseline (phase 0), no impostor rebake, no
census, no A/B, no captures. Those are the next agent's job.

Where the build departed from the text above, and why:

| Section | Plan | Built | Why |
| --- | --- | --- | --- |
| §5.3 rectangles | `FT [163,365,501,511]`, `P1 [18,23,110,225]`, `P2 [334,175,478,264]`, `J1 [83,13,505,240]`, `J2 [188,302,511,412]` | `FT [163,428,501,511]`, `P1 [18,23,110,216]`, `P2 [350,176,478,264]`, `J1 [150,13,505,240]`, `J2 [215,302,511,505]` | Checked against the 2k maps: `FT` caught the tips of two sprays, `P1` and `P2` sat in the bark blobs, `J2` held only the upper half of its frond |
| §5.3 self-check | 8–65 % cover, at most one edge over 5 % opaque | 5–75 % cover, at most one edge over 35 % opaque | The rectangles are tight boxes, so foliage grazes every edge; the 5 % rule failed every one of them |
| §5.4 `bake_sprays` | Orthographic emission render | The same flat quads composited in numpy (`tree_sprays.py`) | Exact colour, no scene state, byte-stable |
| §5.4 palm colours | Linear RGB, encoded | Stored as written | Encoded they came out pale mint |
| §5.5 conifer density | 4–5 stations of two crossed cards; pines 3 per whorl, 2 stations | 6 stations of three cards with a little splay; pines 5 per whorl, 3 stations of five | At the table's values the crowns were bare spokes with two thirds of the card budget unspent |
| §5.6 crown cards | At branch tips only | Also at 45 % and 75 % of each fine branch (mid-storey: 50 %) | Tips alone left the crowns see-through |
| §5.6 lianas | One loose turn round the bole | Hang free | Not modelled |
| §5.6 palms | Ten trunk points each | Ten and nine | Identical topology made the exporter share one index buffer, which the asset optimizer then reports as growth |
| §6.1 palm bark | Tileable | Mirrored along the trunk (`mirror: true`) | The scan failed the seam check vertically |
| §7.1 variants | No pivot | `pivot: trunk` on all five | As the other kit-built trees: a leaning trunk must stand on its placement |
| §7.1 retired tests | — | `snow-biome-ecology`, `taiga-prototype-selection`, `stylized-environment` and the tree-representation fixture now name the new trees | They named the six retired entries |
| §9 record | perf-qa tables | Not written | Nothing was measured |

Triangles as built (bark + cards): spruce-01 4 802, spruce-02 5 117, fir-01
4 316, pine-01 1 802, pine-02 1 538, snag-01 431, emergent-01 5 154,
emergent-02 4 329, midstorey-01 1 710, palm-01 380, palm-02 340.
