# Water Depth, Underwater Rendering, and Swimming Plan

Date: 2026-07-27

Status: planned

Architecture dependency: [`docs/architecture/water-domain-contract.md`](../architecture/water-domain-contract.md)

## Goal

Make water a playable world volume rather than a flat visual layer.

A player must be able to:

- Walk into shallow water and see the terrain through the surface.
- Wade as depth increases.
- Transition into swimming without a hard mode switch.
- Dive below the surface and continue moving through the water volume.
- See depth-correct water colour, absorption, refraction, shore foam, and underwater fog.
- Follow rivers whose beds and local surface elevations match the imported or generated geography.

The implementation must remain compatible with streamed terrain, floating-origin rebasing, deterministic chunk regeneration, the CPU-authoritative heightfield, WebGPU/TSL rendering, and the existing performance QA harness.

## Current implementation

### Water rendering

Current files:

- `src/editor/stylized/StylizedWaterMaterial.js`
- `src/editor/stylized/StylizedWaterSlot.js`
- `src/editor/stylized/SurfaceMaskNodes.js`
- `src/editor/world/ChunkRenderPixels.js`

Current behaviour:

- Each terrain slot creates one water mesh using the shared terrain plane geometry.
- The mesh is placed at the generator sea level plus `stylizedSurface.water.heightOffset`.
- Water coverage comes from the blue channel of `surfaceMaskTexture`.
- The material is transparent, front-sided, and does not write depth.
- Animated FBM and Voronoi patterns drive colour and opacity.
- `deepOpacity` is visual pattern opacity, not actual depth opacity.
- The material does not sample terrain depth, opaque scene depth, or opaque scene colour.
- The surface is not designed to render correctly from below.

### Player movement

Current files:

- `src/editor/player/PlayerController.js`
- `src/editor/player/PlayerPhysics.js`
- `src/editor/InfiniteTerrainView.js`

Current behaviour:

- Player grounding queries `InfiniteTerrainView.getWorldHeight`.
- Movement supports walking, running, stepping, jumping, falling, and ground snapping.
- There is no water query, liquid state, drag, buoyancy, swimming, or submersion state.
- The perspective camera currently uses a near plane of `0.5`, which may clip nearby water surfaces and underwater terrain.

### Terrain and imported geography

Current files:

- `src/editor/world/ProceduralWorldGenerator.js`
- `src/editor/world/AzgaarMacroWorldGenerator.js`
- `src/editor/import/AzgaarMacroWorldSource.js`
- `src/editor/world/generateWorldChunk.js`
- `src/editor/world/WorldChunkWorkerClient.js`

Current behaviour:

- Procedural terrain generates height independently and marks cells below `seaLevel` as water.
- Procedural ocean terrain therefore already provides a usable seabed.
- Imported Azgaar ocean height is mapped below land, but the current bathymetry range is shallow and does not use distance from shore.
- Imported Azgaar rivers are stored as centre lines with width information.
- `AzgaarMacroWorldGenerator.isRiver` changes river cells to the water tile.
- Rivers do not yet carve terrain or calculate a local river surface elevation.
- All rendered water still uses one global sea level.

## Core conclusion

This is not primarily a shader task.

The required order is:

```text
water geography and bed transformation
  -> shared CPU/GPU water domain
  -> depth-aware surface rendering
  -> underwater rendering
  -> water-aware player physics
  -> content and simulation polish
```

Improving transparency or refraction first would hide incorrect geometry rather than fix it. In particular, imported rivers cannot work correctly while they are only water-classified land cells rendered against a global sea-level plane.

## Scope decisions

### Included

- Canonical water queries.
- Streamed per-chunk water fields.
- Procedural and imported ocean bathymetry improvements.
- Deterministic Azgaar river carving.
- Local river surface elevations.
- Depth-based water transparency and absorption.
- Screen-space refraction with a configurable fallback.
- Shore foam.
- Underwater surface rendering and atmospheric treatment.
- Wading, swimming, diving, buoyancy, and drag.
- Performance telemetry and deterministic QA.
- Save-schema and generator-version handling where required.

### Deferred

- Full hydraulic erosion or fluid simulation.
- Dynamic waves that modify collision height.
- Real-time water displacement or flooding.
- Water interaction with GPU-only voxel caves.
- Networked water simulation.
- Boat physics.
- Fishing gameplay.
- Water audio and particles beyond integration hooks.
- Complete lake support before a stable water-body identity model exists.

### Non-goals

- Replacing the heightfield terrain with volumetric terrain.
- Reading GPU water or terrain data back to the CPU.
- Persisting generated water textures in save files.
- Making shader animation authoritative for physics.

## Target architecture

See the water-domain contract for the full interface.

The required runtime shape is:

```text
World generator / water domain
  -> canonical CPU WaterSample query
  -> worker-generated page heights
  -> worker-generated water field
      -> terrain renderer
      -> water renderer
      -> aquatic scatter

Player controller
  -> render-space water adapter
  -> canonical WaterSample
  -> dry / wading / swimming / submerged state
```

The first GPU field should use a dedicated `RGBA16F` texture:

| Channel | Value |
|---|---|
| R | coverage |
| G | surface height |
| B | depth |
| A | shore distance |

Flow direction can follow in `RG8_SNORM` once rivers are stable.

## Phase W0 — Contract and baseline

### Objective

Introduce the domain contract, configuration boundaries, tests, and telemetry without changing visual behaviour.

### Work

1. Add water constants and immutable sample helpers.
2. Add `sampleWater(worldX, worldZ)` to world generators.
3. Add `getWorldWater(renderX, renderZ)` and `getCanonicalWater(worldX, worldZ)` to `InfiniteTerrainView`.
4. Add water-domain configuration under a separate top-level section.
5. Add config validation.
6. Add water-domain version metadata.
7. Add performance counters for water generation and upload bytes.
8. Add deterministic tests before changing terrain output.

### Proposed files

New:

- `src/editor/water/WaterConstants.js`
- `src/editor/water/WaterSample.js`
- `src/editor/water/WaterConfig.js`
- `test/water-domain.test.js`
- `test/water-floating-origin.test.js`

Modified:

- `src/config/validateEditorConfig.js`
- `editor.config.yaml`
- `src/editor/world/ProceduralWorldGenerator.js`
- `src/editor/world/AzgaarMacroWorldGenerator.js`
- `src/editor/InfiniteTerrainView.js`
- `src/editor/performance/qa/PerfCounters.js`

### Initial behaviour

- Procedural ocean reports `surfaceHeight = seaLevel` and `bedHeight = sampleHeight`.
- Non-water reports zero coverage and depth.
- Azgaar ocean reports the current generated bed and sea-level surface.
- Azgaar river initially reports water classification but is marked as incomplete until W1 carving lands.

### Acceptance

- No visible change.
- Existing tests and build remain green.
- Canonical water samples are stable across floating-origin rebases.
- The same query returns the same result after chunk eviction and regeneration.
- No GPU readback is added.

## Phase W1 — Water-aware terrain and streamed field

### Objective

Make terrain and water geography correct before adding expensive rendering features.

### W1.1 Worker-generated water field

Extend chunk generation to return water data beside tiles and heights.

Required output:

```ts
page.waterFieldPixels
page.waterFieldWidth
page.waterFieldHeight
```

The field must be generated from canonical coordinates with a halo large enough for shore distance and river profiles.

Terrain slots gain:

- `waterFieldPixels`
- `waterFieldTexture`
- Upload accounting.
- Disposal handling.

The water slot must consume the field rather than deriving all semantic values from `surfaceMaskTexture`.

### W1.2 Procedural ocean bathymetry

Keep the existing generated terrain as the source seabed.

Add an optional deterministic coastal transformation:

- Preserve the coastline classification.
- Create a shallow shelf near shore.
- Increase depth smoothly away from shore.
- Prevent isolated near-surface spikes where they harm navigation.
- Clamp extreme underwater slopes.
- Retain low-frequency terrain character.

This must be implemented in the generator, not only in shader depth.

### W1.3 Imported Azgaar ocean bathymetry

Replace the current shallow linear underwater conversion with a coastline-aware profile.

Required behaviour:

- Preserve raw Azgaar land/water classification.
- Use distance from land to deepen the seabed.
- Continue into the existing out-of-bounds ocean transition.
- Add deterministic broad seabed variation.
- Keep the coastline bit-identical unless a separate migration explicitly changes it.

### W1.4 Imported Azgaar river carving

Use the existing imported river centre lines and width data.

For each generated page:

1. Query nearby indexed river segments using a world-space or atlas-space spatial index.
2. Calculate the nearest segment distance and tangent.
3. Resolve channel radius from imported width.
4. Derive channel depth from width and configuration.
5. Apply a smooth bank profile to page heights.
6. Calculate a continuous local surface elevation.
7. Calculate coverage, depth, shore distance, and flow.
8. Reuse canonical coordinates and halo samples across chunk boundaries.

The local river surface should be derived from a deterministic longitudinal profile, not from the minimum terrain value inside each page. A per-page minimum would produce steps at chunk boundaries.

A first implementation may use:

```text
channelDepth = clamp(
  minimumDepth + worldWidth * widthDepthRatio,
  minimumDepth,
  maximumDepth
)
```

The bed profile should use a smooth curve controlled by `bankExponent`.

### W1.5 Terrain ownership

The carved bed must be written into the generated page heights before:

- Height textures are uploaded.
- `ChunkedHeightField` serves player grounding.
- Terrain picking samples the page.
- Objects or vegetation sample the ground.
- Water depth is calculated.

Do not create one hidden render-only riverbed mesh. That would immediately desynchronise collision and rendering.

### Proposed files

New:

- `src/editor/water/WaterField.js`
- `src/editor/water/WaterDistanceField.js`
- `src/editor/water/OceanBathymetry.js`
- `src/editor/water/RiverChannel.js`
- `src/editor/water/RiverSurfaceProfile.js`
- `test/water-field-continuity.test.js`
- `test/azgaar-river-channel.test.js`
- `test/ocean-bathymetry.test.js`

Modified:

- `src/editor/world/generateWorldChunk.js`
- `src/editor/world/worldChunk.worker.js`
- `src/editor/world/WorldChunkWorkerClient.js`
- `src/editor/world/AzgaarMacroWorldGenerator.js`
- `src/editor/world/ProceduralWorldGenerator.js`
- `src/editor/InfiniteTerrainView.js`
- `src/editor/stylized/StylizedWaterSlot.js`

### Acceptance

- Imported rivers have visible carved beds.
- River water appears at a local elevation instead of global sea level.
- River beds and surfaces are continuous across chunk borders.
- Procedural and imported ocean shorelines remain stable.
- CPU water samples and uploaded field values agree within format tolerance.
- Chunk regeneration is deterministic.
- The new field adds no work proportional to total map area.
- Worker timing and texture upload bytes are reported.

## Phase W2 — Depth-aware water surface

### Objective

Make the surface communicate real depth and allow the player to see the seabed through shallow water.

### W2.1 Semantic depth colour

Replace pattern-driven deep/shallow opacity with water-column depth.

Inputs:

- `coverage`
- `surfaceHeight`
- `depth`
- `shoreDistance`
- camera position

Use depth for:

- Shallow colour.
- Deep colour.
- Opacity.
- Absorption.
- Foam eligibility.

Keep the existing FBM and Voronoi functions as stylised animation only.

### W2.2 Absorption

Use an inexpensive Beer-Lambert-style approximation:

```text
transmittance = exp(-absorptionCoefficient * opticalDepth)
```

The implementation does not need spectral simulation. Separate RGB coefficients are enough to remove warm wavelengths faster and produce believable blue-green depth.

Optical depth should account for view angle so grazing views become less transparent than vertical views through the same water column.

### W2.3 Opaque scene colour and depth

Refraction requires the opaque scene colour and depth before water is composited.

Use Three.js TSL viewport nodes where supported:

- Safe viewport UV.
- Opaque scene colour or shared viewport texture.
- Opaque scene depth.
- Linearised depth.

Refraction rules:

- Distort scene colour using two animated normal scales.
- Reject samples that cross foreground geometry boundaries.
- Reduce distortion in shallow water and near the shore.
- Fade refraction at long range.
- Provide a no-refraction quality path.

### W2.4 Shore foam

Use shore distance and scene-depth intersection rather than procedural noise alone.

Foam should appear:

- Near the shoreline.
- Where water intersects steep terrain.
- In selected river flow bands.

Noise breaks the edge shape but does not define the shoreline.

### W2.5 Surface geometry and side handling

The surface must render from both above and below.

Evaluate two approaches:

1. One double-sided material with camera-relative branches.
2. Separate top and underside materials sharing the same geometry and water field.

Prefer the single material only if pipeline complexity and branching remain acceptable. Otherwise use explicit top/underside passes for predictable render ordering.

### Proposed files

New:

- `src/editor/stylized/water/WaterOpticsNodes.js`
- `src/editor/stylized/water/WaterNormalNodes.js`
- `src/editor/stylized/water/WaterRefractionNodes.js`
- `src/editor/stylized/water/WaterFoamNodes.js`

Modified:

- `src/editor/stylized/StylizedWaterMaterial.js`
- `src/editor/stylized/StylizedWaterSlot.js`
- `src/editor/InfiniteTerrainView.js`
- `editor.config.yaml`
- scene-settings capture and validation files if water visual settings are persisted

### Suggested visual configuration

```yaml
stylizedSurface:
  water:
    enabled: true
    heightOffset: 0.04
    shallowColor: '#72d5df'
    deepColor: '#12658e'
    absorption:
      density: 0.18
      red: 1.35
      green: 0.55
      blue: 0.18
    refraction:
      enabled: true
      strength: 0.025
      depthFade: 5
      distanceFade: 180
    foam:
      enabled: true
      shoreWidth: 1.5
      intersectionDepth: 0.35
      noiseScale: 0.8
    normals:
      smallScale: 0.7
      largeScale: 0.12
      smallSpeed: 0.09
      largeSpeed: 0.025
```

### Acceptance

- Terrain is clearly visible through shallow water.
- Visibility decreases continuously with actual depth.
- The same world point looks shallow or deep consistently from different chunks.
- Foreground objects are not incorrectly refracted through the water.
- Shore foam follows geography rather than tile squares.
- Water can be seen from below.
- Refraction can be disabled without disabling depth tint or absorption.
- No new visible seam appears at terrain-slot boundaries.

## Phase W3 — Underwater rendering

### Objective

Allow the camera to cross the water surface and render a coherent underwater world.

### W3.1 Camera submersion state

At every player update, query water at the camera/player position.

Calculate:

- Feet depth.
- Standing depth.
- Eye depth.
- Whether the eye is below the local surface.
- Distance to the surface.

Use hysteresis around the eye boundary to prevent rapid visual toggling when waves or numerical noise place the camera close to the surface.

### W3.2 Underwater atmosphere

When the camera is submerged:

- Apply distance-based underwater absorption and fog.
- Reduce far visibility.
- Shift scene colour by configured water body or water kind.
- Render the water underside above the camera.
- Reduce or replace sky contribution.
- Prevent normal above-water god rays from compositing unchanged.
- Optionally add shallow caustics projected onto terrain.

The first implementation should prefer a compact full-screen underwater pass rather than modifying every terrain and object material.

### W3.3 Render order

Target render flow:

```text
opaque terrain and objects
  -> capture opaque colour and depth
  -> water surface
  -> underwater atmosphere when submerged
  -> final god-rays or alternate underwater light pass
  -> output
```

`StylizedGodRaysPostProcess` must expose either:

- A bypass while submerged.
- Underwater parameters.
- A compositing hook that runs after underwater atmosphere.

### W3.4 Camera near plane

Test lowering the player camera near plane from `0.5` to `0.1` or `0.2`.

Acceptance must include:

- No unacceptable depth precision loss.
- No clipping of the nearby water surface.
- No clipping of close underwater terrain or construction pieces.

Do not change the near plane without the headed comparison.

### Proposed files

New:

- `src/editor/stylized/water/UnderwaterPostProcess.js`
- `src/editor/stylized/water/WaterCameraState.js`
- `test/water-camera-state.test.js`

Modified:

- `src/editor/InfiniteTerrainView.js`
- `src/editor/player/PlayerController.js`
- `src/editor/stylized/StylizedGodRaysPostProcess.js`
- `src/main.js`
- `editor.config.yaml`

### Acceptance

- Crossing the surface in either direction does not pop, flash, or lose the water plane.
- Above-water and underwater effects use the same local surface height.
- The horizon and sky do not render as if the camera were still in air.
- Underwater visibility scales with configured absorption and distance.
- Floating-origin rebasing does not reset the underwater state.
- The post-process path remains valid on WebGPU and the supported fallback path.

## Phase W4 — Wading, swimming, and diving

### Objective

Extend player movement from ground-only physics to a stable water-aware state machine.

### Player states

```text
dry
  -> wading
  -> swimming
  -> submerged
```

Transitions use local depth and eye position with hysteresis.

### W4.1 Physics input

Extend `stepPlayerPhysics` with:

```ts
getWaterSample: (x, z) => WaterSample
```

Avoid embedding world-generator access inside the pure physics function.

### W4.2 Wading

While the seabed remains reachable:

- Preserve ground collision.
- Reduce horizontal speed based on depth.
- Reduce jump impulse.
- Add stronger acceleration damping.
- Keep the player grounded.

### W4.3 Swimming

When water depth exceeds the standing threshold:

- Transition to buoyant motion.
- Apply water drag.
- Reduce effective gravity.
- Allow movement relative to horizontal camera direction.
- Allow upward input.
- Disable normal ground jumping.
- Continue colliding with the seabed.

### W4.4 Diving

When the player is swimming:

- `Space` swims upward.
- `Control` or `C` swims downward.
- Forward direction may include camera pitch only in the submerged state or when a dedicated swim mode is active.
- Clamp upward motion at the surface unless the player exits through a jump/breach rule.

### W4.5 State and UI contract

Expose through `PlayerController.getStatus()`:

```ts
waterState
waterDepth
headSubmerged
waterBodyId
```

This becomes the integration point for:

- Underwater rendering.
- Footstep/splash audio.
- Breathing or stamina systems.
- Wildlife reactions.
- Future boats and interactions.

### Suggested movement configuration

```yaml
player:
  water:
    wadeDepth: 0.7
    swimDepth: 1.35
    transitionHysteresis: 0.12
    wadeSpeedMultiplier: 0.62
    wadeJumpMultiplier: 0.45
    swimSpeed: 5
    verticalSwimSpeed: 3
    buoyancy: 18
    gravityMultiplier: 0.12
    drag: 4
```

### Proposed files

New:

- `src/editor/player/PlayerWaterState.js`
- `test/player-water-physics.test.js`

Modified:

- `src/editor/player/PlayerController.js`
- `src/editor/player/PlayerPhysics.js`
- `src/editor/player/playerConstants.js`
- `src/config/validateEditorConfig.js`
- `editor.config.yaml`
- performance QA harness files

### Acceptance

- Dry walking remains unchanged outside water.
- Entering shallow water gradually slows the player.
- Deep water transitions to swimming without teleporting vertically.
- The player can dive and return to the surface.
- The player cannot stand on the visual water surface.
- The player collides with the same seabed rendered below the water.
- State transitions remain stable at threshold depth.
- Automated movement QA can report water-state timelines and frame timings.

## Phase W5 — Lakes, currents, content, and quality tiers

### Objective

Build higher-level systems only after the core volume is correct.

### Lakes

- Resolve connected water-body identities.
- Assign deterministic per-body surface elevation.
- Preserve imported lake identities where available.
- Avoid representing inland lakes at ocean sea level.

### Flow

- Generate river tangent flow into `RG8_SNORM`.
- Advect highlight and foam patterns along flow.
- Expose current strength for player and boat physics.
- Keep ocean animation visual unless a gameplay current model is added.

### Aquatic content

Use depth and water kind for:

- Reeds and shoreline plants.
- Lotus and floating plants.
- Underwater plants.
- Fish spawning.
- Wet rocks and shoreline props.

Aquatic plants must stop relying only on tile ID. They require valid water coverage, depth range, and shore distance.

### Quality tiers

Recommended tiers:

| Tier | Features |
|---|---|
| Low | depth tint, absorption, no refraction, no caustics |
| Medium | refraction, shore foam, two-scale normals |
| High | depth rejection, underwater caustics, flow animation |
| Ultra | higher-resolution normals/caustics and longer refraction range |

Geography, collision, and swimming must be identical across tiers.

## Save and migration plan

Generated fields are not saved.

Persist only:

- Water-domain version.
- Source river geometry and metadata.
- Water-body identities and authored levels where needed.
- User-authored water edits.
- Configuration values that are part of deterministic generation, or a generator version that fixes them.

A change to any of these requires an explicit version decision:

- Ocean bathymetry formula.
- River channel depth formula.
- River surface profile.
- Water-body identity algorithm.
- Shore-distance semantics.

Manual terrain edits remain sparse overrides over generated water-aware base terrain.

## QA plan

### Unit tests

- Water sample invariants.
- Ocean classification and depth.
- River distance and bank profile.
- Local river-surface continuity.
- Wading and swimming thresholds.
- Buoyancy and drag.
- Surface crossing hysteresis.
- Save/reload determinism.

### Chunk-border tests

Test all water values across east/west and north/south boundaries:

- Coverage.
- Surface height.
- Bed height.
- Depth.
- Shore distance.
- Flow direction.

Use rivers crossing boundaries at shallow, diagonal, and near-parallel angles.

### Headed visual battery

Add deterministic poses:

- Ocean shore, standing on land.
- Knee-deep water.
- Looking vertically through shallow water.
- Deep-water surface at grazing angle.
- Camera immediately above the surface.
- Camera immediately below the surface.
- Submerged shallow view with visible bed.
- Submerged deep view.
- River bank.
- River centre.
- River chunk crossing.
- Floating-origin rebase while swimming.

Capture at least the no-refraction and full-refraction profiles.

### Movement QA

Add scenarios:

```text
qa=water-entry
qa=water-cross
qa=swim
qa=dive
qa=river-follow
```

Record:

- Frame-time histogram.
- Water state timeline.
- Surface and bed height.
- Water depth.
- Vertical velocity.
- Floating-origin events.
- Streaming backlog.
- Water generation timings.
- Water pass GPU/CPU timing where available.

### Performance budgets

Initial budgets should be measured against the current main baseline before final thresholds are fixed.

Required constraints:

- Zero GPU readbacks.
- Water generation stays inside worker execution.
- Texture allocation is fixed by terrain-slot capacity.
- No per-frame water-field allocation.
- No per-frame reconstruction of river spatial indices.
- Refraction can be disabled independently.
- Underwater atmosphere uses one bounded full-screen pass.
- Movement water queries remain constant time or bounded by a local spatial index.

## Risks and mitigations

### River elevation is underspecified by source data

Azgaar river centre lines and widths do not automatically provide a physically correct longitudinal water profile.

Mitigation:

- Derive a deterministic profile from sampled terrain and downstream ordering.
- Enforce a minimum downhill gradient.
- Smooth the profile over segment distance.
- Add specific tributary and chunk-boundary tests.

### Transparent render ordering

Water, vegetation, particles, and post-processing can produce incorrect depth composition.

Mitigation:

- Capture opaque scene colour/depth before water.
- Keep water in an explicit render stage.
- Test foreground depth rejection.
- Avoid relying only on `renderOrder` once refraction is enabled.

### Terrain edits can invalidate water

Sculpting a riverbed or shoreline changes depth and coverage assumptions.

Mitigation:

- Rebuild affected page water fields when tile or height edits touch the configured water halo.
- Keep user edits as overrides and regenerate derived water values.
- Do not cache shore distance independently of page revision.

### CPU/GPU disagreement

Physics can diverge from rendering if the CPU query and worker field use separate algorithms.

Mitigation:

- Put shared pure functions in modules usable by workers and the main thread.
- Add domain-agreement tests.
- Document field quantisation tolerances.

### Camera surface flicker

Small numerical differences near the surface can alternate above/below effects.

Mitigation:

- Use separate enter and exit thresholds.
- Use local authoritative surface height.
- Do not use animated visual wave displacement for physics in this phase.

### Scope expansion

Water quickly expands into waves, weather, boats, fishing, and dynamic fluids.

Mitigation:

- Complete W0-W4 before adding dynamic water systems.
- Keep gameplay water height static in the first release.
- Treat visual waves as normal/refraction animation only.

## Recommended first delivery slice

Implement W0 and the Azgaar river part of W1 before touching refraction.

Definition of done:

> A player can walk into a correctly carved imported river, query one stable local water surface and bed depth, and transition from dry ground to wading while the existing water material remains visually unchanged.

This slice validates the hard shared-domain work:

- Canonical water queries.
- Deterministic carving.
- CPU terrain ownership.
- Chunk continuity.
- Player integration.

Once it is green, W2 becomes a contained renderer upgrade instead of a shader attempting to compensate for incorrect world data.

## Final acceptance gates

The complete water feature is accepted only when all gates pass:

- Shallow water reveals the seabed.
- Deep water progressively obscures the seabed using real depth.
- Imported rivers have carved channels and local surface elevations.
- Water does not step at chunk boundaries.
- The player moves through dry, wading, swimming, and submerged states.
- The camera crosses the surface without popping or clipping.
- Underwater atmosphere uses the same local water sample as physics.
- Floating-origin rebases preserve water body, surface, depth, and player state.
- Save/reload regenerates identical water fields.
- Aquatic and terrestrial vegetation respect actual water coverage and depth.
- No GPU readbacks are added.
- All visual quality features can degrade without changing geography or physics.
- Unit, deterministic, headed visual, movement, and performance QA are green.
