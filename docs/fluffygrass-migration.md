# FluffyGrass → Simulator-Test Migration Guide

This document defines what should be migrated from `danielsobrado/FluffyGrass` into `danielsobrado/Simulator-Test`, where each concept belongs in the target codebase, and what must **not** be copied because Simulator-Test already has a stronger implementation.

## Reviewed snapshots

The instructions below were prepared against these exact `main` snapshots:

- **FluffyGrass source:** `7b1d554e05f9680380c90fb54d768f2d5b9107fc`
- **Simulator-Test target:** `1532d88437a5b7de0d7dc91d13a6d45eab686217`
- **Review date:** 2026-08-16

When implementing this plan later, first compare the current heads against these SHAs. If either subsystem changed materially, adapt the target mapping rather than blindly copying old code.

## Migration principles

1. **Simulator-Test remains the owning architecture.** Do not import FluffyGrass as a subsystem or dependency.
2. **Keep WebGPU/TSL.** FluffyGrass renderer/material code is WebGL-oriented; migrate algorithms, not its renderer implementation.
3. **Keep worker-side deterministic generation.** Grass and flowers are already generated during chunk generation through `enrichPageVegetationScatter`. Do not move placement to the main thread.
4. **Use canonical/global world coordinates for deterministic ecology.** Ecology and macro variation must not depend on floating-origin render coordinates.
5. **Use Azgaar data as the environmental source of truth.** Simulator-Test already has richer macro guidance than FluffyGrass; do not recreate a parallel hydrology/world generator.
6. **One causal field should feed multiple visuals.** Grass, flowers, bushes, rocks and ground treatment should agree because they consume the same ecology values.
7. **Configuration belongs in YAML.** Runtime/art tuning goes into `editor.config.yaml` and its validators instead of introducing new hard-coded tuning constants.
8. **Add complexity only after profiling.** Mid grass patches and far grass impostors are optional later phases, not prerequisites.
9. **No GitHub Actions.** Add local Node tests/QA and integrate them into existing npm verification commands only.

## Existing target systems that must be kept

Simulator-Test already has the following systems and they should be extended, not replaced:

- `src/editor/stylized/vegetationScatter.js`
  - deterministic per-chunk/per-cell scatter
  - worker-safe typed-array output
  - current grass and flower generation
  - heightfield sampling
- `src/editor/world/generateWorldChunk.js`
  - canonical worker-side chunk-generation pipeline
  - already invokes vegetation enrichment after terrain/render data generation
- `src/editor/world/WorldGuidanceField.js`
  - Azgaar continuous environmental fields
  - discrete biome IDs and continuous biome blends
- `src/editor/stylized/StylizedGrassMaterial.js`
  - WebGPU/TSL grass material
  - wind, shape, colour and current world-space variation
  - existing terrain/path/object suppression logic
- `src/editor/stylized/StylizedGrassSlot.js`
  - grass chunk/slot ownership and current near/far geometry handling
- `src/editor/stylized/grassLodMath.js`
  - existing two-band near/far grass LOD mathematics
- `src/editor/stylized/GrassTuning.js`
  - shared live TSL uniforms and YAML-oriented tuning export
- `src/editor/stylized/RegionalCharacterField.js`
  - large-scale artistic/regional variation
- `src/editor/stylized/naturalTrailMath.js`
  - existing natural path/trail wear
- `src/editor/stylized/BiomeAssetPalette.js`
- `src/editor/stylized/BiomePrototypeSelector.js`
- `src/editor/stylized/StylizedFlowerView.js`
- `src/editor/stylized/StylizedBushView.js`
- `src/editor/stylized/StylizedRockView.js`
- `src/editor/world/CoordinateSpaces.js`
- `src/editor/world/FloatingOrigin.js`
- `src/config/validateEditorConfig.js`
- `src/config/validateStylizedLodConfig.js`
- existing `qa:vegetation:lod` and `npm run verify` paths

## Target data flow

The desired end state is:

```text
Azgaar macro guidance
  temperature / precipitation / moisture / wetness
  coast + river distance / river flux
  mountainness / ruggedness / valleyness / snow
  forest / agriculture / biome blend
                    |
                    v
local chunk terrain
  height / slope / gradient / curvature
  water / road + path masks / authored disturbance
                    |
                    v
             WorldEcologyField
  moisture / fertility / exposure / disturbance / rockiness
                    |
        +-----------+-----------+-----------+-----------+
        |           |           |           |           |
        v           v           v           v           v
      grass       flowers      bushes      rocks       ground
        |
        v
macro grass variation
  dryness / vigor / canopy AO
        |
        v
same values consumed by every grass LOD
```

The important rule is that **ecology is physical/causal**, while `RegionalCharacterField` remains artistic/regional. Do not merge the two responsibilities. Their outputs may be blended or multiplied at the final placement/material stage.

---

# Phase 1 — Shared ecology field

**Priority: highest. Implement first.**

## Take from FluffyGrass

### `src/world/ecology/WorldEcologyField.ts`

Pinned source:

`https://github.com/danielsobrado/FluffyGrass/blob/7b1d554e05f9680380c90fb54d768f2d5b9107fc/src/world/ecology/WorldEcologyField.ts`

Take the **model and formulas**, especially the common output contract:

- `moisture`
- `fertility`
- `exposure`
- `disturbance`
- `rockiness`

Also retain these design choices:

- slope reduces water retention;
- terrain aspect/exposure affects drying;
- concavity/convexity affects accumulation;
- water proximity increases water supply;
- disturbance reduces fertility/vegetation;
- steep/convex/alpine terrain exposes more rock;
- moisture/cover suppress exposed rock;
- fertility depends on several causal inputs rather than independent random scatter.

## Adapt into Simulator-Test

Create:

```text
src/editor/stylized/ecology/WorldEcologyField.js
src/editor/stylized/ecology/TerrainLandformField.js
src/editor/stylized/ecology/ecologyMath.js
```

Keep these modules free of Three.js, DOM and renderer references so they can execute in the chunk worker and in Node tests.

### Environmental inputs

Do **not** copy FluffyGrass hydrology sampling. Instead consume existing Simulator-Test/Azgaar data from `WorldGuidanceField` when available:

- `temperature`
- `precipitation`
- `waterDistance`
- `riverDistanceMeters`
- `riverFlux`
- `moisture`
- `wetness`
- `mountainness`
- `ruggedness`
- `valleyness`
- `snowPotential`
- `forestPotential`
- `agriculturalPotential`
- biome blend weights

For procedural worlds without Azgaar guidance, provide deterministic defaults derived from the local terrain generator. Do not make ecology depend on having imported an Azgaar map.

### Local landform inputs

Port the useful concepts from FluffyGrass `TerrainLandformField.ts`, but first reuse any slope/gradient information already computed in the chunk/render pipeline. Do not calculate the same derivatives in multiple places.

Required local values:

- height
- gradient X/Z
- slope
- convexity/concavity or an equivalent low-cost curvature estimate

All samples must use canonical chunk/global coordinates, never floating-origin scene coordinates.

### Disturbance

Static disturbance should initially include existing roads/path masks and obvious authored no-growth areas. Keep dynamic footsteps/combat out of Phase 1; dynamic disturbance is Phase 5.

## Configuration

Port values from FluffyGrass `WorldEcologyTuning.ts` only as starting defaults. Store tuning under `editor.config.yaml`, for example:

```yaml
stylizedSurface:
  ecology:
    enabled: true
    slopeShed: 0.0
    exposureAmbient: 0.0
    waterSupply: 0.0
    fertilityMoistureExponent: 0.0
    rockSlopeStart: 0.0
    rockSlopeFull: 0.0
    rockConvexity: 0.0
    rockSoilBurial: 0.0
```

The numbers above are placeholders in this document, not recommended tuning values. During implementation, copy the current donor defaults and then tune against Simulator-Test scale.

Add strict validation to the existing config validation path. Do not silently clamp malformed configuration that should fail at startup.

## Integrate at

`src/editor/world/generateWorldChunk.js`

The ecology calculation should happen before vegetation scatter so the page can expose either compact ecological sample fields or a worker-side sampler/context to `enrichPageVegetationScatter`.

Avoid storing five full-resolution Float32 grids unless profiling shows they are useful elsewhere. Prefer calculating required ecology at scatter candidates or use compact quantized fields when several render systems need the same samples.

## Acceptance criteria

- Same world seed and same global coordinates always produce identical ecology.
- Neighboring chunks agree at shared boundaries.
- Floating-origin rebasing does not change ecology.
- Azgaar and procedural worlds both work.
- No main-thread terrain/ecology sampling is introduced into grass generation.
- Ecology does not materially increase chunk-generation stalls beyond the existing QA budget.

---

# Phase 2 — Macro grass variation shared by all LODs

## Take from FluffyGrass

### `src/grass/GrassFieldVariation.ts`

Pinned source:

`https://github.com/danielsobrado/FluffyGrass/blob/7b1d554e05f9680380c90fb54d768f2d5b9107fc/src/grass/GrassFieldVariation.ts`

Port the deterministic low-frequency concepts:

- broad dryness patches;
- independent vigor patches;
- two-octave ragged patch noise;
- canopy self-occlusion based on vigor × suitability;
- identical world-coordinate sampling for every LOD.

The most important donor rule is not the exact noise constants: **every representation of the same location must resolve the same macro appearance**. Otherwise LOD changes become visible colour/density rings.

## Adapt into Simulator-Test

Create:

```text
src/editor/stylized/ecology/GrassFieldVariation.js
```

Use pure deterministic math that can run in worker and Node tests.

Move tunable periods/strengths to `editor.config.yaml`, for example:

```yaml
stylizedSurface:
  ecology:
    grassVariation:
      drynessPeriodMeters: 27
      vigorPeriodMeters: 19
      drynessStrength: 0.22
      canopyOcclusionStrength: 0.17
```

These values match the reviewed donor starting point and must be verified against the physical scale of Simulator-Test.

## Integrate at

### `src/editor/stylized/vegetationScatter.js`

Current scatter already produces deterministic clump positions and width/length/angle/random parameters. Keep that structure, but make acceptance and instance parameters ecology-aware.

Conceptually:

```text
base biome suitability
× ecology moisture/fertility suitability
× slope tolerance
× (1 - rock suppression)
× (1 - disturbance)
× macro vigor
= grass placement suitability
```

Do not remove deterministic cell/clump seeds. Ecology determines **where growth is plausible**; seeded randomness prevents a regular grid.

Add only the minimum extra attributes required by the material. Pack or derive values rather than expanding instance data casually.

### `src/editor/stylized/StylizedGrassMaterial.js`

Port donor macro dryness/vigor/canopy effects into the existing WebGPU/TSL material. Do **not** copy GLSL or WebGL material classes.

Preserve the current target features already present there, including wind, per-blade variation, root shade, translucency, regional patching, trail wear and object/terrain suppression.

### `src/editor/stylized/RegionalCharacterField.js`

Keep it. Recommended responsibility split:

- `RegionalCharacterField`: artistic large-region identity;
- ecology: causal environmental state;
- `GrassFieldVariation`: metre-scale meadow variation.

Final grass appearance can combine all three.

## Acceptance criteria

- Grass is no longer statistically uniform across large eligible biome areas.
- Wet hollows, dry ridges and disturbed ground read differently without hand-painted placement.
- Macro patterns do not move when floating origin rebases.
- Near and far grass preserve the same broad colour/density patches.
- No new per-frame CPU noise sampling for static grass.

---

# Phase 3 — Biome-aware vegetation profiles and shared consumers

## Take from FluffyGrass

### `src/grass/biome/GrassBiomeProfile.ts`
### `src/grass/biome/GrassBiomeProfiles.json`
### `src/grass/biome/GrassAccentSpecies.ts`

Pinned source example:

`https://github.com/danielsobrado/FluffyGrass/blob/7b1d554e05f9680380c90fb54d768f2d5b9107fc/src/grass/biome/GrassBiomeProfile.ts`

Take the **profile fields and validation ideas**, not the fixed donor biome-count model.

Useful concepts:

- density multiplier;
- height band;
- width band;
- dryness bias;
- wind damping;
- shape family;
- base/tip/dry palette controls where needed;
- accent vegetation density;
- weighted accent species.

## Adapt into Simulator-Test

Do not create another independent biome database. Simulator-Test already owns Azgaar biome definitions, `BiomeAssetPalette` and `BiomePrototypeSelector`.

Extend the target biome/palette data with optional vegetation/ecology settings and consume `WorldGuidanceField.sampleBiomeBlend()` so transitions can blend continuously rather than changing at one cell boundary.

Prefer YAML configuration in the existing config contract rather than copying `GrassBiomeProfiles.json` as another source of truth.

The profile should cover all standard Azgaar biomes and deterministic custom-biome fallback behavior.

## Consumers

Feed the shared ecological sample/profile into:

- grass density/height/colour;
- flower probability/species;
- bush probability/species;
- rock exposure and moss/lichen likelihood where supported;
- ground-detail density/tint;
- later tree undergrowth decisions.

Do not force every renderer to own a separate noise implementation.

## Acceptance criteria

- Savanna and grassland remain visually distinct.
- Forest transitions affect undergrowth continuously.
- Wetlands select wet vegetation rather than simply increasing generic grass.
- Tundra/alpine zones reduce grass and favor appropriate low detail.
- Custom Azgaar biomes have deterministic fallback behavior.

---

# Phase 4 — Grass LOD continuity and submission optimization

## Take from FluffyGrass

### `src/grass/GrassLodController.ts`

Pinned source:

`https://github.com/danielsobrado/FluffyGrass/blob/7b1d554e05f9680380c90fb54d768f2d5b9107fc/src/grass/GrassLodController.ts`

Take these algorithms/concepts:

1. stochastic/dithered overlap instead of hard representation switches;
2. distance reject before more expensive frustum work;
3. conservative CPU-side reduction of geometry that cannot survive shader coverage;
4. shared LOD appearance/coverage rules;
5. diagnostics based on what is actually submitted, not only nominal geometry size.

The reviewed donor also compacts mid instances that are entirely covered by near grass and trims sorted blade runs conservatively. Port the principle only where it maps cleanly to WebGPU submission in Simulator-Test.

## Adapt into existing target files

### `src/editor/stylized/grassLodMath.js`

Current target is intentionally simpler: near full-shape blades and far cheap blades. Extend this first with transition/coverage math and tests. Do not immediately replace it with the donor three-stage controller.

### `src/editor/stylized/StylizedGrassSlot.js`

Apply stochastic near/far crossfade and conservative instance/draw reduction here if the WebGPU representation permits it without expensive buffer rebuilds.

### `src/editor/stylized/StylizedGrassMaterial.js`

The TSL shader must use the same deterministic coverage seed as the CPU/slot logic. Coverage transitions must preserve macro ecology/colour values from Phase 2.

## Do not add mid patches yet

First profile the improved current two-band system. The target already has a cheaper single-triangle far blade representation, so adding another representation carries real complexity and memory cost.

Only add the donor-style middle patch representation when profiling demonstrates that the current far blade band is still a major GPU/CPU cost or cannot provide the required visual density.

## Do not add grass impostors yet

Simulator-Test already has distant terrain treatment and a separate tree impostor pipeline. A grass impostor atlas should be justified by measured distant-grass cost and visual requirements, not copied because FluffyGrass has one.

## QA

Extend the existing `qa:vegetation:lod` path rather than inventing a parallel QA command.

Port ideas from FluffyGrass verification scripts:

- LOD continuity;
- shape continuity;
- colour parity;
- placement determinism;
- performance envelope;
- streaming performance.

Add deterministic Node tests for the pure math and browser/perf QA only for behavior that requires rendering.

## Acceptance criteria

- No obvious grass ring during movement or camera rotation.
- No density hole between current near and far bands.
- Broad ecology/colour patches remain stationary through transitions.
- Submitted instances/vertices decrease with distance as expected.
- Improvement is demonstrated in the existing performance QA, not assumed.

---

# Phase 5 — Persistent vegetation disturbance

## Take from FluffyGrass

### `src/grass/interaction/GrassTrailField.ts`
### `src/grass/interaction/GrassInteractionField.ts`

Pinned source:

`https://github.com/danielsobrado/FluffyGrass/blob/7b1d554e05f9680380c90fb54d768f2d5b9107fc/src/grass/interaction/GrassTrailField.ts`

Take the interaction model:

- scrolling/persistent local field around the focus;
- stored crush direction;
- crush amount;
- contact freshness;
- gradual recovery;
- multiple simultaneous contacts;
- foot/body contacts;
- radial landing/impact pulses;
- bounded update frequency instead of necessarily updating at display refresh rate.

## Adapt for Simulator-Test

Do not copy the WebGL ping-pong render-target implementation directly.

Create a WebGPU/TSL-oriented generalized system, preferably named for the broader responsibility, for example:

```text
src/editor/stylized/interaction/VegetationDisturbanceField.js
```

It should eventually accept contacts from:

- player feet/body;
- creatures;
- mounts;
- carts;
- combat impacts;
- explosions/spells;
- construction or heavy traffic where useful.

Keep the static ecology field deterministic and immutable. Dynamic disturbance is a transient overlay:

```text
base ecology disturbance + dynamic disturbance → current vegetation response
```

Initially affect only grass bending/flattening. Do not add persistence to save files until gameplay requires long-lived tracks.

## Integration points

- `PlayerController` / character locomotion supplies foot/body contacts.
- spell/combat systems submit impact pulses through a small neutral interface rather than importing grass classes.
- `StylizedGrassMaterial.js` samples the disturbance field.
- future flowers/small foliage may consume it through the same abstraction.

## Acceptance criteria

- grass remains displaced briefly after the player passes;
- field follows/reprojects around the player without world-space sliding;
- rebasing does not corrupt trail position;
- recovery is bounded and does not leave quantized permanent damage;
- disabled interaction has negligible overhead.

---

# Phase 6 — Optional mid grass patches

**Implement only if Phase 4 profiling justifies it.**

## Donor references

Use these as design references:

- `src/grass/GrassPatchGrid.ts`
- `src/grass/GrassGeometryFactory.ts`
- mid-related paths in `src/world/WorldGrassSystem.ts`
- mid coverage and compaction in `src/grass/GrassLodController.ts`

Do not copy `WorldGrassSystem` wholesale.

Target architecture should remain chunk/slot based. Build a compact mid representation that consumes the **same deterministic ecology, macro variation, wind model and coverage seeds** as existing near/far grass.

Acceptance requirement: it must produce a measurable GPU/submission improvement or a clear visual-density improvement at equal performance. Otherwise remove it.

---

# Phase 7 — Optional far grass impostors

**Last resort / long-distance quality feature.**

FluffyGrass uses view-dependent far impostors and stochastic transitions. This is useful reference material, but Simulator-Test should not create another impostor pipeline until the need is measured.

If implemented later, inspect:

```text
src/grass/impostors/
src/grass/GrassImpostorLimits.ts
```

Requirements for a target implementation:

- WebGPU-compatible;
- deterministic per world position;
- shares ecology/colour/wind with near representations;
- no visible seam at mid/far transition;
- atlas memory is bounded;
- terrain-horizon fade hides final cutoff;
- integrates with existing performance/asset validation conventions.

Reuse existing target impostor infrastructure where practical instead of introducing a second unrelated atlas/bake framework.

---

# Source → target migration matrix

| FluffyGrass source | Target location | Action | Priority |
| --- | --- | --- | --- |
| `src/world/ecology/WorldEcologyField.ts` | new `src/editor/stylized/ecology/WorldEcologyField.js` | **Adapt formulas/model** to Azgaar + local landform inputs | P0 |
| `src/world/ecology/TerrainLandformField.ts` | new `src/editor/stylized/ecology/TerrainLandformField.js` or existing terrain helpers | **Adapt/reuse**, do not duplicate derivatives | P0 |
| `src/world/ecology/WorldEcologyTuning.ts` | `editor.config.yaml` + config validators | **Move tuning to YAML** | P0 |
| `src/grass/GrassFieldVariation.ts` | new `src/editor/stylized/ecology/GrassFieldVariation.js` | **Port deterministic math**, config-drive periods/strength | P0 |
| `src/grass/biome/GrassBiomeProfile.ts` | existing biome/palette/config system | **Adapt profile concepts** | P1 |
| `src/grass/biome/GrassBiomeProfiles.json` | `editor.config.yaml` / existing biome definitions | **Translate**, do not create duplicate biome truth | P1 |
| `src/grass/biome/GrassAccentSpecies.ts` | existing vegetation prototype/palette selection | **Adapt weighted species concept** | P1 |
| `src/grass/GrassLodController.ts` | `grassLodMath.js`, `StylizedGrassSlot.js`, `StylizedGrassMaterial.js` | **Port coverage/culling/trim concepts**, not class | P1 |
| `src/grass/interaction/GrassTrailField.ts` | new `interaction/VegetationDisturbanceField.js` | **Reimplement in WebGPU/TSL** | P2 |
| `src/grass/interaction/GrassInteractionField.ts` | disturbance contact API | **Adapt contact model** | P2 |
| `src/grass/GrassPatchGrid.ts` | optional target mid representation | **Reference only until profiling** | P3 |
| `src/grass/GrassGeometryFactory.ts` | optional target mid geometry | **Reference algorithms only** | P3 |
| `src/grass/impostors/*` | optional existing target impostor infrastructure | **Reference only until profiling** | P4 |
| donor verification scripts | existing `test/`, `scripts/`, `qa:vegetation:lod`, `verify` | **Port invariants/tests** | P0-P2 |

---

# Files/systems that must NOT be copied wholesale

## `src/grass/GrassDistribution.ts`

Do not migrate `MeshSurfaceSampler` placement. Simulator-Test's chunk-worker scatter is a better fit for an infinite deterministic world and already emits compact typed arrays.

## FluffyGrass terrain generator, terrain streamer and world app

Do not migrate:

- `TerrainField`
- `TerrainStreamer`
- FluffyGrass world/chunk ownership
- `WorldApp`
- FluffyGrass camera/controller ownership

Simulator-Test already has infinite chunk streaming, Azgaar guidance, predictive loading, floating origin and its own player/editor runtime.

## WebGL shader/material implementation

Do not copy `ShaderMaterial`, WebGL render targets, GLSL strings or WebGL renderer lifecycle into the target grass path. Translate the required formulas/state into the existing WebGPU/TSL system.

## Duplicate configuration stack

Do not copy FluffyGrass `WorldConfigLoader`, schema or separate runtime config hierarchy. Add fields to `editor.config.yaml` and the existing target validators.

## Character system

Do not migrate FluffyGrass character/controller/animation code as part of this work. Simulator-Test already owns its player/character/spell runtime.

## Full donor `WorldGrassSystem`

Use it as an architectural/reference index only. Pulling it in would duplicate target slot ownership, streaming and render lifecycle.

---

# Configuration work

All new tuning should remain under the existing YAML configuration and be validated.

Recommended shape:

```yaml
stylizedSurface:
  ecology:
    enabled: true

    # Physical ecology derived from terrain + Azgaar guidance.
    moisture:
      # TODO: add tuned values copied/adapted from donor defaults.
      slopeShed: 0.0
      exposureDrying: 0.0
      waterSupply: 0.0

    fertility:
      moistureExponent: 0.0
      disturbanceStrength: 0.0
      floor: 0.0
      ceiling: 0.0

    rockiness:
      slopeStart: 0.0
      slopeFull: 0.0
      convexityStrength: 0.0
      soilBurialStrength: 0.0

    grassVariation:
      drynessPeriodMeters: 27
      vigorPeriodMeters: 19
      drynessStrength: 0.22
      canopyOcclusionStrength: 0.17
```

Do not commit the placeholder `0.0` values as production tuning. They exist here only to show the intended ownership and structure.

Validation should cover:

- finite numbers;
- non-negative periods;
- normalized weights/strengths where required;
- ordered ranges;
- LOD transition distances and residency relationships;
- memory/performance caps for any future interaction texture or impostor atlas.

---

# Worker and memory rules

The migration must preserve the current worker architecture.

1. `generateWorldChunk.js` remains the orchestration point.
2. Ecological math must be importable by `worldChunk.worker.js` without Three.js/DOM dependencies.
3. `vegetationScatter.js` remains responsible for compact scatter buffers.
4. Avoid per-candidate object allocation in hot loops; use scalar values, reusable objects or packed arrays.
5. Do not attach large redundant Float32 ecology rasters to every page unless a measured multi-consumer benefit justifies them.
6. Use global chunk/cell coordinates for all hashes/noise so neighboring chunks and reloads reproduce identical fields.
7. If ecology data is transferred back from the worker, transfer/retain only what render consumers actually need.

---

# QA and verification migration

Simulator-Test already has `node --test`, `qa:vegetation:lod`, performance QA and `npm run verify`. Extend those paths.

Add tests covering at minimum:

```text
test/ecology-field.test.js
test/grass-field-variation.test.js
test/vegetation-ecology-scatter.test.js
test/vegetation-chunk-seam.test.js
test/vegetation-floating-origin-invariance.test.js
test/vegetation-biome-blend.test.js
```

Extend `scripts/run-vegetation-lod-qa.mjs` for:

- stochastic transition continuity;
- colour parity across LODs;
- visible density continuity;
- actual submitted instance/vertex envelope;
- regression checks for camera movement and chunk streaming.

Useful donor verification ideas to reproduce in target conventions:

- `verify-ecology.mjs`
- `verify-lod-continuity.mjs`
- `verify-grass-shape-continuity.mjs`
- `verify-lod-color-parity.mjs`
- `verify-grass-placement.mjs`
- `verify-grass-streaming-performance.mjs`
- `verify-grass-performance.mjs`

Do not add GitHub Actions. Verification remains local and part of existing npm commands.

Before each migration phase is considered complete:

```bash
npm test
npm run qa:vegetation:lod
npm run qa:perf
npm run build
npm run verify
```

Browser/WebGPU visual verification is still required for render-only artifacts even when all static tests pass.

---

# Recommended implementation order

1. **Baseline tests and perf capture** on current Simulator-Test.
2. **World ecology pure math** with deterministic Node tests.
3. **Worker integration** using existing Azgaar guidance/local terrain data.
4. **Ecology-aware grass scatter** without changing rendering representation.
5. **Macro dryness/vigor/canopy variation** shared by scatter/material.
6. **Flowers, bushes, rocks and ground details** consume the same ecology.
7. **Biome blend profiles** using existing Azgaar biome blend data.
8. **Stochastic current near/far LOD transition** and conservative submission reductions.
9. **Persistent dynamic disturbance** in WebGPU/TSL.
10. **Profile again.** Add mid grass patches only if justified.
11. **Profile again.** Add far grass impostors only if justified.

This order intentionally improves world coherence before adding another rendering representation.

---

# Definition of done

The migration is complete when:

- vegetation placement is based on shared causal ecology rather than biome eligibility plus independent randomness;
- Azgaar continuous fields materially influence local vegetation without making imported maps mandatory;
- grass, flowers, bushes, exposed rocks and ground detail agree spatially;
- grass has stable metre-scale dryness/vigor variation;
- LOD changes preserve the same large-scale density/colour patterns;
- all static vegetation remains deterministic across reloads, chunk eviction/regeneration and floating-origin rebases;
- current worker streaming architecture is preserved;
- WebGPU/TSL remains the render implementation;
- no duplicate terrain, hydrology, biome or config system is introduced;
- performance is at least equal to baseline at equivalent quality, or any deliberate cost has a measured visual justification;
- tests and `npm run verify` pass;
- WebGPU browser smoke testing shows no seams, rings, popping or obvious ecological contradictions.

---

# Attribution

`danielsobrado/FluffyGrass` is a fork of the MIT-licensed `thebenezer/FluffyGrass`. Even though this migration is between repositories controlled by the same owner, code copied from upstream-derived portions must retain the applicable MIT copyright/license notice.

When copying substantive source rather than independently reimplementing an algorithm, update `THIRD_PARTY_NOTICES.md` in Simulator-Test accordingly.

---

# Short decision summary

**Take now:**

- shared ecology model;
- landform-derived ecological inputs;
- macro dryness/vigor/canopy variation;
- biome vegetation profile concepts;
- stochastic LOD transition logic;
- conservative submission trimming concepts;
- persistent interaction model;
- donor QA invariants.

**Keep from Simulator-Test:**

- Azgaar guidance and biome blending;
- infinite terrain/chunk streaming;
- worker generation;
- floating origin;
- typed-array vegetation scatter;
- WebGPU/TSL materials;
- existing grass slot ownership;
- existing biome/palette system;
- existing tree/rock/flower/bush renderers;
- YAML config and validators;
- existing QA/performance framework.

**Do not copy now:**

- donor `MeshSurfaceSampler` placement;
- donor terrain/world streamer;
- donor WebGL shader/material/runtime implementation;
- duplicate config loaders;
- donor character/controller stack;
- full `WorldGrassSystem`;
- mid patches until measured;
- grass impostors until measured.
