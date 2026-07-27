# Water Domain Contract

## Status

Proposed architecture. No runtime behaviour is implemented by this document.

This contract defines the shared water representation required by terrain generation, rendering, player movement, simulation, aquatic vegetation, and future boats. Water geography must be authoritative outside the shader. Rendering consumes the water domain; it must not infer geography from colours or visual masks.

## Current limitation

The current runtime represents water as a flat, masked visual overlay:

- `StylizedWaterSlot` resolves one world sea level and creates one water plane per resident terrain slot.
- `StylizedWaterMaterial` uses the blue channel of `surfaceMaskTexture` as a binary water mask.
- Water colour and opacity come from animated FBM and Voronoi patterns rather than physical water depth.
- Player movement only queries the CPU heightfield through `InfiniteTerrainView.getWorldHeight`.
- Azgaar river centre lines classify cells as water, but do not yet provide a carved bed or a local river surface elevation.

A shader-only upgrade would therefore improve appearance while leaving water depth, river geometry, underwater movement, and simulation inconsistent.

## Design rules

1. One canonical query must describe water at any world position.
2. Terrain generation, rendering, physics, and simulation must consume the same values.
3. Water queries must use canonical world coordinates and remain stable across floating-origin rebases.
4. Water generation must be deterministic across chunk unload and reload.
5. Adjacent chunks must calculate matching water values at shared boundaries.
6. Normal runtime operation must not require GPU readbacks.
7. Visual quality features must be independently configurable and degradable.
8. Imported geography remains source data; generated bathymetry and channels are deterministic derived data.

## Canonical sample

```ts
export const WATER_KIND_NONE = 0;
export const WATER_KIND_OCEAN = 1;
export const WATER_KIND_LAKE = 2;
export const WATER_KIND_RIVER = 3;

export interface WaterSample {
  kind: number;
  bodyId: number;
  coverage: number;
  surfaceHeight: number;
  bedHeight: number;
  depth: number;
  shoreDistance: number;
  flowX: number;
  flowZ: number;
}
```

Required invariants:

- `coverage` is within `[0, 1]`.
- `depth = max(0, surfaceHeight - bedHeight)`.
- `kind === WATER_KIND_NONE` implies `coverage === 0` and `depth === 0`.
- `flowX` and `flowZ` form a normalised horizontal direction when flow is defined.
- `bodyId` is deterministic and stable for the same imported or generated body.
- `shoreDistance` is zero at the water boundary, positive in water, and may be clamped to a configured maximum range.

The first implementation may omit meaningful `bodyId` and flow for oceans, but their fields should exist from the start to avoid changing every consumer later.

## Runtime query API

The world generator should expose a canonical query:

```ts
sampleWater(worldX: number, worldZ: number): WaterSample
```

The terrain view should expose a render-space adapter:

```ts
getWorldWater(renderX: number, renderZ: number): WaterSample
```

`getWorldWater` converts render coordinates through `FloatingOrigin.toCanonical` and delegates to the world generator or a dedicated water-domain service.

Physics must use the CPU query. The shader uses worker-generated chunk textures containing equivalent values. Tests must verify that both paths agree within documented quantisation tolerances.

## Streamed water field

Do not overload `surfaceMaskTexture`. Its channels already represent path influence, grass classification, and binary water classification.

Each terrain slot should receive a dedicated `waterFieldTexture` generated with the page data in the chunk worker.

Recommended first layout: `RGBA16F`.

| Channel | Meaning |
|---|---|
| R | Water coverage |
| G | Water surface height |
| B | Water depth |
| A | Shore distance |

A later flow texture can use `RG8_SNORM`:

| Channel | Meaning |
|---|---|
| R | Flow X |
| G | Flow Z |

For a `64 × 64` page, `RGBA16F` costs 32 KiB. With 49 resident terrain slots, the steady resident allocation is approximately 1.53 MiB before upload staging.

The water field must include enough halo data during generation to calculate boundary-safe shore distance, river profiles, and interpolation. Only the owned `64 × 64` result is uploaded.

## Water-body rules

### Procedural ocean

- `surfaceHeight` uses the authoritative generator sea level.
- Existing generated terrain below sea level remains the seabed.
- A deterministic coastal shelf may reshape shallow bathymetry without moving the coastline.
- Broad seabed variation must remain lower frequency than playable terrain detail.
- Underwater slopes must be clamped where required for walkable shallows and stable collision.

### Imported Azgaar ocean

- Cells below Azgaar's land threshold remain ocean.
- The imported coastline remains unchanged.
- Bathymetry increases with distance from land rather than mapping all ocean heights through one shallow linear formula.
- The configured transition outside imported bounds continues toward deep ocean.
- Derived bathymetry is deterministic from source atlas data, coordinates, and generator seed.

### Imported Azgaar river

A river is not a global sea-level water tile. It requires a local channel model.

For every relevant river segment:

1. Calculate distance to the centre line.
2. Convert imported river width to world-space channel radius.
3. Calculate a smooth bank profile.
4. Derive channel depth from width and optional river metadata.
5. Carve the generated terrain bed.
6. Derive a local water surface elevation from nearby terrain and downstream progression.
7. Merge tributary and main-channel levels without steps.
8. Produce coverage, depth, shore distance, and flow direction.

The initial channel may use a deterministic analytic profile rather than hydraulic simulation.

```text
bedHeight = sourceTerrainHeight
  - channelDepth * smoothBankProfile(distance / channelRadius)
```

River surface elevation must be continuous across chunk boundaries and should maintain a small downstream gradient. It must never be derived independently by each rendered slot.

### Lake

Lakes require a stable `bodyId` and a per-body surface elevation. A single global sea-level plane cannot represent inland lakes correctly.

Lake support may follow oceans and rivers, but the domain contract reserves it now. The preferred model is connected-body identification during import or deterministic generation, followed by one resolved surface level per body.

## Terrain ownership

The canonical CPU heightfield remains authoritative for player collision. Water transformations that alter the seabed or river channel must therefore be applied during world chunk generation before page heights are returned.

The rendered terrain height texture, player grounding, editor picking, water depth, and persistence must all observe the same transformed height values.

Generated transformations are base terrain, not sparse user edits. Manual terrain edits remain overrides on top of the generated water-aware terrain.

## Rendering consumption

The water shader consumes:

- Water coverage.
- Water surface height.
- Water-column depth.
- Shore distance.
- Optional flow direction.
- Opaque scene colour.
- Opaque scene depth.
- Camera position relative to the local water surface.

The shader may add animated normals, highlights, foam, refraction, absorption, and caustics, but none of these may redefine whether water exists or how deep it is.

The current FBM and Voronoi pattern should be retained only as a stylised highlight or foam layer. It must no longer drive the semantic deep/shallow classification.

## Physics consumption

Player movement consumes the same `WaterSample` as rendering.

Required movement states:

```text
dry -> wading -> swimming -> submerged
```

State transitions use configured thresholds and hysteresis. Physics owns movement state; rendering owns only visual transition state.

Suggested status fields:

```ts
interface PlayerWaterStatus {
  waterState: 'dry' | 'wading' | 'swimming' | 'submerged';
  waterDepth: number;
  headSubmerged: boolean;
  bodyId: number;
}
```

Expected behaviour:

- Shallow water preserves ground walking with increasing drag.
- Water deeper than the standing threshold transitions to swimming.
- Swimming reduces effective gravity and applies buoyancy and drag.
- The player continues to collide with the authoritative CPU seabed.
- Normal jumping is disabled while swimming.
- Upward and downward swimming are explicit inputs.
- Surface thresholds use hysteresis to prevent rapid state flicker.

## Persistence

The save format should persist source inputs and authored overrides, not generated per-chunk water textures.

Persist when applicable:

- Water-domain schema version.
- Imported water-body identifiers and metadata.
- Imported river geometry and source width data.
- Per-body lake levels when sourced or authored.
- User-authored water changes.

Regenerate:

- Chunk water fields.
- Shore-distance fields.
- Procedural bathymetry.
- Deterministic river channel carving derived from stored river source data.

Any change that alters deterministic terrain or water output requires an explicit generator or water-domain version increase.

## Configuration boundary

Proposed configuration structure:

```yaml
waterDomain:
  version: 1
  shoreDistanceMeters: 48
  ocean:
    coastalShelfMeters: 32
    shelfDepth: 4
    maximumDepth: 24
    maximumBedSlope: 0.75
  river:
    minimumDepth: 0.8
    maximumDepth: 8
    widthDepthRatio: 0.18
    bankExponent: 1.8
    minimumGradient: 0.0002

player:
  water:
    wadeDepth: 0.7
    swimDepth: 1.35
    transitionHysteresis: 0.12
    wadeDrag: 0.35
    swimSpeed: 5
    verticalSwimSpeed: 3
    buoyancy: 18
    swimDrag: 4
```

Visual settings remain under `stylizedSurface.water` because they do not define geography or physics.

## Required tests

### Determinism

- The same canonical coordinate returns the same water sample after chunk eviction and regeneration.
- Worker and synchronous generation produce identical water fields.
- Floating-origin rebases do not change water values.

### Continuity

- Shared chunk edges have matching surface height, bed height, coverage, depth, and shore distance.
- River surface elevation and carved bed do not step at chunk boundaries.
- Tributaries join main rivers without exposed walls or elevated water shelves.

### Domain agreement

- CPU `sampleWater` agrees with uploaded water-field values within quantisation tolerance.
- Player water states match the rendered local surface and depth.
- Terrain collision bed height equals the bed used by the water shader.

### Persistence

- Save and reload preserve source water data and regenerate identical derived fields.
- Water-domain version mismatch fails explicitly or migrates through a tested path.

### Performance

- No GPU readbacks are introduced.
- Water-field generation reports worker timings.
- Upload bytes and allocation sizes are included in performance telemetry.
- Water-domain work remains bounded by terrain residency rather than total map size.
