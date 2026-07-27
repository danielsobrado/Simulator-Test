# W1 Water Geography Implementation

Date: 2026-07-27

Status: implemented on `agent/w1-water-geography`; hardened by the W0–W1 review-fix PR.

Dependency: W0 water-domain contract from PR #36.

## Delivered

W1 makes water geography and the terrain beneath it authoritative before W2 adds depth-aware optics.

- Procedural and imported ocean bathymetry derived from deterministic shore distance.
- Imported Azgaar river centre lines converted into indexed world-space channels.
- Width-based river depth and continuous downstream surface profiles.
- River beds carved into the CPU-authoritative terrain heightfield.
- Worker-generated semantic water fields.
- Per-terrain-slot half-float water textures.
- Local surface placement instead of one global sea-level plane.
- Live tile and height edits regenerate and upload semantic water data.
- Near and macro-far terrain use the same transformed water contract.
- Water generation time and upload bytes are reported through performance counters.

## Canonical terrain ownership

`WaterTerrainModel` is the shared deterministic authority for generated seabeds, carved river beds, and CPU water samples.

```text
raw generator height and tile classification
  -> cached ocean classification and shore distance
  -> slope-bounded ocean bathymetry
  -> indexed river-channel profile
  -> authoritative transformed vertex height
  -> bilinear CPU terrain and WaterSample queries
  -> worker page heights and water field
  -> collision, picking, vegetation, near rendering, and macro rendering
```

There is no render-only riverbed mesh.

## Ocean bathymetry

The original land/water classification remains authoritative.

- Mixed coastline vertices remain unchanged.
- Fully submerged vertices follow a piecewise depth profile.
- Depth reaches `shelfDepth` at `coastalShelfMeters`.
- Depth reaches `maximumDepth` at `shoreDistanceMeters`.
- Both profile segments are validated against `maximumBedSlope`.
- Broad deterministic noise retains low-frequency seabed character.
- Canonical classification and transformed vertices use bounded block caches.

Default version-2 profile:

```text
shore distance: 48 m
coastal shelf: 20 m
shelf depth: 4 m
maximum depth: 24 m
maximum profile slope: 0.75
```

## River channels

Imported Azgaar river points are converted from atlas coordinates to canonical world cells. Each river is oriented from higher terrain toward lower terrain and assigned a deterministic longitudinal surface profile.

- Imported width resolves channel radius.
- A 0.75-cell minimum radius guarantees contact with the terrain vertex grid.
- Width and `widthDepthRatio` resolve channel depth.
- `bankExponent` controls the cross-section.
- `minimumGradient` enforces downstream progression.
- A spatial index limits segment candidates.
- One selected segment owns body, flow, surface, coverage, and shore distance.
- The minimum overlapping bed owns terrain carving.
- Invalid points and dimensions are rejected or skipped safely.

## Streamed water field

Each generated page contains:

```ts
page.waterFieldPixels
page.waterFieldWidth
page.waterFieldHeight
page.waterFieldSurfaceOrigin
page.waterFieldRevision
```

The texture is `RGBA16F`:

| Channel | Meaning |
|---|---|
| R | Analytic coverage |
| G | Surface-height offset from `waterFieldSurfaceOrigin` |
| B | Water depth |
| A | Shore distance |

For a 64×64 page, the field is 65×65 so adjacent pages share the complete vertex edge. A one-cell sampling halo supplies stable dry-boundary surface values.

The exact 64×64 surface mask remains the cell-coverage authority. The shader combines exact cell coverage with analytic coverage, while semantic height comes from the field.

A field uses 33,800 texture bytes. At 49 resident slots, steady texture allocation is approximately 1.58 MiB before staging.

## Precision

Absolute river elevations are not stored directly in half float. Each page stores a full-precision surface origin and half-float local offsets. This avoids metre-scale terracing in high-elevation rivers while preserving compact GPU storage.

## Live edits

- Height edits regenerate depth and increment `waterFieldRevision`.
- Tile edits add or remove exact water coverage.
- Painted water uses the authoritative sea level.
- Explicit land painting can suppress an imported analytic river cell.
- Render slots upload when the field revision changes, even if the page object is unchanged.

## Persistence

W1 terrain semantics are water-domain version 2.

- Generated fields are not persisted.
- Version 2 generator metadata stores normalized water-domain settings.
- Missing, version 0, and version 1 persisted water contracts require an explicit migration.
- Newer versions are rejected.
- Equivalent settings compare independently of object property order.

Silent regeneration into different terrain is not allowed.

## Performance

- Ocean classifications and transformed vertex heights use bounded typed-block caches.
- Neighbouring fields reuse canonical halo data.
- Half-float conversion reuses shared bit-conversion views.
- Worker and main-thread generation timings are not double-counted.

Focused repeated-field diagnostics are approximately 1–3 ms after cache warm-up. Cold generation remains dependent on coastline complexity and worker state and requires headed release measurement.

## Validation

Focused Node tests: 31 passed.

Coverage includes:

- W0 sample invariants and immutable contracts.
- Water-domain version and settings compatibility.
- Ocean maximum depth and slope limits.
- Coastline vertex ownership.
- Fractional heightfield parity.
- Narrow and overlapping river behaviour.
- River bank blending and downstream continuity.
- Ocean and river shared-edge continuity.
- Relative half-float precision at high elevations.
- Dry shoreline surface and depth inheritance.
- Live field revision changes.
- Page dimension validation.
- Floating-origin parity and live edits.
- Macro-far terrain parity.
- Negative-coordinate cache behaviour and bounded eviction.

## Deferred

- Depth-driven colour and transparency.
- Beer–Lambert-style absorption.
- Opaque scene colour/depth refraction.
- Geographic shore foam.
- Underwater rendering.
- Swimming and buoyancy.
- Authored lake body levels.
