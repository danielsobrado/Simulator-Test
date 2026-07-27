# W1 Water Geography Implementation

Date: 2026-07-27

Status: implemented on `agent/w1-water-geography`

Dependency: W0 water-domain contract in PR #36 (`agent/w0-water-contract`)

## Delivered

W1 makes water geography and the terrain beneath it authoritative before W2 adds depth-aware optics.

- Procedural ocean bathymetry derived from deterministic shore distance.
- Imported Azgaar ocean bathymetry without changing land/water classification.
- Imported river centre lines converted into indexed world-space channels.
- River depth derived from imported width and water-domain configuration.
- Continuous downstream river surface profiles that do not depend on page-local minima.
- River beds carved into the CPU-authoritative terrain heightfield.
- Worker-generated semantic water fields.
- Per-terrain-slot half-float water textures.
- Water rendering positioned and masked from the semantic field rather than one global sea-level mask.
- Live tile and height edits regenerate the semantic water field.
- Water generation time and upload bytes reported through performance counters.

## Canonical terrain ownership

`WaterTerrainModel` is the shared deterministic authority for generated seabeds, carved river beds, and CPU water samples.

```text
raw generator height and tile classification
  -> ocean shore-distance profile
  -> indexed river-channel profile
  -> authoritative generated terrain height
  -> canonical WaterSample
  -> worker page heights and water field
  -> CPU collision and GPU rendering
```

There is no separate render-only riverbed mesh. The same transformed height is used by page generation, terrain textures, player grounding, picking, vegetation placement, and water depth.

## Ocean bathymetry

The original coastline classification remains authoritative. Water cells receive a deterministic depth profile:

- Near-shore depth starts from zero.
- Depth grows through a configurable coastal shelf.
- Offshore depth approaches the configured maximum.
- Broad deterministic variation retains seabed character.
- The configured maximum bed slope limits abrupt underwater drops.
- A bounded cached distance field keeps work proportional to resident terrain, not total map size.

## River channels

Imported Azgaar river points are converted from atlas coordinates to canonical world cells. Each river is oriented from higher terrain toward lower terrain, then assigned a deterministic longitudinal surface profile.

For each segment:

- Imported width resolves channel radius.
- Width and `widthDepthRatio` resolve channel depth.
- `bankExponent` controls the smooth channel cross-section.
- `minimumGradient` ensures downstream progression.
- A spatial index limits queries to nearby segments.
- Stable river body IDs derive from imported river IDs.
- Tributary or overlapping segment samples select compatible minimum bed and surface values.

## Streamed water field

Each generated page contains:

```ts
page.waterFieldPixels
page.waterFieldWidth
page.waterFieldHeight
```

The format is `RGBA16F`:

| Channel | Meaning |
|---|---|
| R | Coverage |
| G | Surface height |
| B | Water depth |
| A | Shore distance |

The field is `65 x 65` for a standard `64 x 64` page. This intentionally differs from the earlier `64 x 64` estimate: water-surface height is vertex-owned, so retaining the shared edge makes adjacent pages bit-identical and removes interpolation seams.

A standard field uses 33,800 bytes. At 49 resident slots, the steady texture allocation is approximately 1.58 MiB before staging.

## Rendering boundary

W1 changes only semantic placement and coverage:

- The water mesh samples local surface height from the water field.
- Coverage comes from the water field rather than `surfaceMaskTexture`.
- The existing stylised FBM and Voronoi colour treatment remains.

Actual depth tint, absorption, refraction, geographic foam, and underwater rendering remain W2 and W3 work.

## Live edits and persistence

- Height overrides update water depth because the field is regenerated from `InfiniteWorldStore.sampleHeight`.
- Tile overrides can add or remove water classification.
- Explicit land painting can suppress an imported analytic river at that cell.
- Generated water fields are not persisted.
- Water-domain settings are stored in generator metadata.
- Older version 6 saves without full W1 settings remain compatible through W0 defaults.
- Saves carrying different explicit water-domain settings are rejected instead of silently regenerating different terrain.

## Validation

Focused Node tests: 12 passed.

Coverage includes:

- Ocean coastline preservation and offshore depth progression.
- Ocean determinism.
- Imported river carving and downstream surface continuity.
- River bank blending.
- Shared water-field edges bit-identical across chunks.
- CPU and half-float field agreement within format tolerance.
- W0 sample invariants, metadata compatibility, and configuration validation.

Full visual acceptance still requires a physical WebGPU browser and representative imported Azgaar maps.

## Deferred

- Depth-driven surface colour and transparency.
- Beer-Lambert-style absorption.
- Opaque scene colour/depth refraction.
- Geographic shore foam.
- Underwater rendering.
- Swimming and buoyancy.
- Authored lake body levels.
