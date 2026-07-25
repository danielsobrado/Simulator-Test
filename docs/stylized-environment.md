# Stylized WebGPU environment

The environment layer adapts the visual contracts from `cortiz2894/stylized-components`
to the SimCity DnD streamed Three.js world.

## Asset paths

The integration expects these files under `public`:

```text
public/assets/grass-scene.glb
public/assets/textures/bark/bark_color.png
public/assets/textures/bark/bark_AO.png
public/assets/textures/bark/bark_height.png
public/assets/textures/flower/flowers.png
public/assets/textures/flower/flowersRGB.png
public/assets/textures/flower/flowersGradient.png
public/assets/textures/flower3/flowers.png
public/assets/textures/flower3/flowersRGB.png
public/assets/textures/flower3/flowersGradient.png
```

The GLB material-name contract is configured in `editor.config.yaml`:

```yaml
stylizedSurface:
  assets:
    rockMaterial: RocksStylized_M
    trunkMaterial: Material.011
    leafMaterial: 2237f4d60830642a24d65276e7abe1e6
```

## Rendering architecture

- Ground color, dirt, lush/dry variation, path blending and cloud animation use TSL.
- Grass blades are deterministic streamed instances. Wind, blade shortening, color,
  rock trampling, and sun-based translucency run in the WebGPU material.
- Flowers are streamed crossed billboards using the source alpha masks, RGB palette
  zones and base-to-tip gradients.
- Rocks and pine-tree parts are extracted from the source GLB for streaming:
  - **Rocks:** scale-only bake (demo placement tumble is stripped) + y=0 ground pivot,
    unique meshes only. Instances use Y-spin only. Tinted toward `rocks.color`, spread by
    per-instance `colorVariation`, and sunk into the ground by `rocks.burial`.
  - **Pines:** full world-matrix bake (keeps Sketchfab −90°/scale), reject non-upright
    AABBs, shared ground pivot per prototype.
- **Broadleaf species are generated, not authored.** The GLB only contains conifers, so
  `forest/ForestSpeciesGeometry.js` builds `broadleaf_round`, `broadleaf_tall` (a
  white-barked birch), `tropical_tall` and `wetland_sparse` once at startup — never during
  a chunk build. They append after the GLB prototypes, so baked impostor indices for the
  conifer range stay stable. `ForestSpeciesRegistry` maps each `speciesId` to only the
  prototypes that can render it, so biome palettes actually change what you see (taiga →
  conifers, temperate deciduous → broadleaf + birch). Per-species colour comes from
  `FOREST_SPECIES_PALETTES` through the shared leaf/trunk materials.
  Geometry is de-indexed for hard facets, which is why these carry their own root flare
  instead of `attachRootCollar` (that merges an indexed collar and would fail).
- **Undergrowth is its own layer.** `StylizedBushView` places dome bushes and fern tufts
  from an independent cluster field, thinned under canopy by the shared forest-floor rule
  so thickets ring woods instead of carpeting them. Bushes used to exist only as a side
  effect of saplings at patch edges, which left glades bare. Boulders are hard blockers;
  trees deliberately are not — reading the tree manifest would make bush acceptance depend
  on whether that manifest happened to be cached.
- Pine foliage preserves the source alpha silhouette, applies the source color
  treatment and uses the same wind clock as the grass.
- Water tiles get a cel-shaded Voronoi overlay (F1 − SmoothF1) with world-anchored
  flow, matching the upstream WaterFloor look without the demo-only ripple/PDE stack.
- The sky is a camera-following inverted dome with the source day palette, sun glow,
  clouds, fog and lighting. `sky.fogColor` is matched to the sky's horizon band so terrain
  fades into the sky rather than meeting it at a colour seam.
- The far-terrain backdrop (`world/MacroFarTerrainView.js`) uses a **polar grid graded
  toward the camera**. A uniform grid at a 60 km radius spends most vertices on the far rim
  and leaves ~750 m per vertex where mountains are actually read, so peaks came out as
  blobs; grading cuts near-band spacing to ~80–160 m for the same vertex budget, with no
  ring seams and still one draw call. Slope drives biome → scree → bare rock, and snow
  settles above `snowLine` but not on faces steeper than `snowSlopeMax`. Origin-snap
  rebuilds are sliced across frames into a back buffer and swapped when complete, so a snap
  cannot spike a frame or tear the mesh.
- `sky.aerial` adds aerial perspective to that backdrop in the shader (not baked into
  vertex colours, so it tracks the camera between origin snaps): distance hazes toward
  `horizonColor`, and `heightFalloff` keeps peaks clearer than valley floors so ranges
  layer front-to-back.
- Paths blend through a **tread and a verge** rather than one hard stripe, with optional
  ruts. Trees, bushes and boulders are cleared from roads by
  `forest/PathClearanceField.js`, which chamfers the canonical tile map — never a page's
  surface-mask pixels, so clearance cannot depend on which chunks are resident.
- **Riparian belts.** `forest/TileDistanceField.js` measures distance to the nearest tile
  of a given id from the canonical tile map; `PathClearanceField` and
  `InfiniteTerrainView.getCanonicalWaterDistance` are both thin policy layers over it.
  A shoreline contributes `riparianCoverage` in its own right, easing to zero by
  `riparianRange`, and **competes with the patch field** rather than scaling it — a
  multiplier could never create gallery woodland where the patch field says "no patch
  here", which is exactly where river woods belong. Dry biomes (savanna, grassland,
  tundra) opt in; wetland instead uses `waterMaximum` to suppress stands away from open
  water, so they read as islands rather than continuous swamp forest.
  `habitat.waterRangeMeters` bounds the chamfer halo and must cover the widest range any
  profile tests; set it to 0 to disable the water term. Species selection is weighted by
  `waterAffinity` against the riparian signal, so a shore reads as willow-and-alder while
  the slope behind it stays coniferous.
- Terrain, grass and flowers use Lambert node materials under the shared day rig.
- Generated render data is not read back from the GPU.

## Streaming limits

Grass, rocks, flowers and trees have independent resident radii. Tree/rock instances
are stored in canonical world space and offset by a group for floating-origin snaps,
so origin shifts do not rebuild instance buffers. Animation is uniform-driven and does
not rebuild instances every frame.

## Configuration

All style and density values live under `stylizedSurface` in `editor.config.yaml`.

Grass density vs upstream: the GrassField demo uses **300 blades / world-unit²** on a
tiny patch. Here `bladesPerCell` is per terrain cell (`tileSize × tileSize` area), so
areal density is `bladesPerCell / tileSize²` (default ≈ 12/u²). Blade width/length
defaults match the upstream Spring preset so the field reads dense without the demo’s
full instance count.

Density is patch-driven: `trees.habitat.candidateBudgetPerChunk` and `maxAcceptedPerChunk`
raise how dense a forest *core* can get, while the patch field keeps glades open. Two things
make high budgets affordable and must stay that way:

- `StableScatterManifest` spacing is bucket-indexed, so cost is linear in candidates rather
  than quadratic. `tests/scatterSpacing.test.js` pins acceptance to a brute-force reference.
- `ForestHabitatField` samples the expensive patch term on a `patchSampleSpacing` grid and
  interpolates it, which is what makes the cache hit across overlapping chunk halos.

Each tree LOD band is sized to its own radius. Sizing every band for the impostor window
(as it once did) wasted several times the instance memory — at 72 accepted/chunk and 11
prototypes that is ~32 MB instead of ~58 MB.

Reduce these first when tuning performance:

1. `grass.bladesPerCell`
2. `flowers.perChunk`
3. `bushes.perChunk`
4. `trees.habitat.maxAcceptedPerChunk`, then `candidateBudgetPerChunk`
5. `rocks.perChunk`
6. `world.farTerrain.angularResolution` / `radialResolution`
7. individual resident radii
8. `sky.shadows` or `sky.shadowMapSize`

Watch `forestInstancesDroppedByCapacity` and `stylizedInstancesDroppedByCapacity` — both
must stay at 0 — plus `treeManifestQueueDepth` for manifest backlog.

## Attribution

See `THIRD_PARTY_NOTICES.md` for the upstream MIT notice.
