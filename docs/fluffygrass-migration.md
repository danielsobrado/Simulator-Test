# FluffyGrass → Simulator-Test Migration Implementation Guide

This is an implementation playbook, not a high-level idea list. It says **what to take, from which donor file/symbol, where it belongs in Simulator-Test, what must be changed, what must not be copied, and how to verify every step**.

The migration goal is not to make Simulator-Test look internally like FluffyGrass. The goal is to take the strongest grass/ecology ideas from FluffyGrass and fit them into Simulator-Test's existing Azgaar-driven, worker-generated, chunk-streamed, floating-origin, WebGPU/TSL architecture.

---

## Reviewed snapshots

The instructions below were refreshed against:

- **FluffyGrass donor `main`:** `e990543008b7ea4313b74abe673ad1b3d2ecb8a3`
- **Simulator-Test target `main`:** `ab7a57e5776dcd64439f0c59c60e327985b6ebb4`
- **Review date:** 2026-08-16

Important delta from the first version of this guide:

- FluffyGrass advanced by 185 commits after the earlier `7b1d554e...` review.
- The core donor files used for ecology, macro grass variation, biome profiles and LOD math did not materially change in that delta.
- Donor trail/resource lifecycle, grass geometry, near-grass streaming and verification did change and the instructions below use the newer behavior.
- Simulator-Test's migration-relevant vegetation files remained unchanged between the original review point and the target snapshot above, so the target mapping remains valid.

Before implementing any phase later, compare the then-current `main` heads against these SHAs. If one of the named target functions has moved, preserve the responsibility described here rather than forcing the old file layout.

---

# 1. Architectural rules that are not negotiable

1. **Simulator-Test owns the architecture.** Do not add FluffyGrass as a dependency and do not transplant `WorldGrassSystem`.
2. **Keep WebGPU/TSL.** Copy formulas and data contracts; do not copy WebGL renderer/material lifecycle or GLSL strings.
3. **Keep worker-side static generation.** Static ecology/scatter must stay in `worldChunk.worker.js` through the existing `generateWorldChunk()` path.
4. **Use canonical world coordinates for every persistent/static field.** Never hash or sample floating-origin render-local coordinates.
5. **Azgaar guidance is the macro environmental source of truth when present.** Do not introduce a second climate/biome/hydrology database.
6. **Procedural worlds must still work.** The ecology API must have a deterministic fallback using the existing procedural generator.
7. **One causal ecology field feeds several visual systems.** Grass, flowers, bushes, rocks and ground detail should agree spatially.
8. **`RegionalCharacterField` remains artistic.** Ecology is causal/physical; regional character is compositional/artistic. Do not merge their roles.
9. **Configuration goes in `editor.config.yaml`.** Do not reintroduce donor config loaders/schemas.
10. **Do not increase static per-instance data without proving it is needed.** Prefer derived values, packed channels and build-time decisions.
11. **No GitHub Actions.** Use the existing local test/QA/perf commands.
12. **Every phase must be independently shippable.** Do not make Phase 1 depend on optional mid grass or far impostors.

---

# 2. Current target architecture to preserve

These are the target systems this migration extends instead of replacing.

## Static chunk generation

### `src/editor/world/generateWorldChunk.js`

Current order is:

1. build tile grid;
2. build height grid;
3. generate water field;
4. generate render/surface-mask pixels;
5. call `enrichPageVegetationScatter(page, request.vegetationScatterConfig)`.

**Migration rule:** ecology-aware static vegetation belongs immediately before / inside step 5 while the worker-local `generator` is still available.

## Environmental guidance

### `src/editor/world/AzgaarMacroWorldGenerator.js`

Already exposes:

```js
sampleGuidance(cellX, cellZ)
sampleBiomeBlend(cellX, cellZ)
sampleHeight(vertexX, vertexZ)
sampleTile(cellX, cellZ)
sampleWater(cellX, cellZ)
```

`sampleGuidance()` is already backed by `WorldGuidanceField` and provides the fields needed by the migration.

### `src/editor/world/WorldGuidanceField.js`

Already provides continuous fields including:

- elevation;
- temperature;
- precipitation;
- water distance;
- coast distance;
- river distance;
- river flux;
- moisture;
- wetness;
- mountainness;
- ruggedness;
- valleyness;
- snow potential;
- forest potential;
- agricultural potential;
- harbor potential;
- biome ID;
- biome blending.

Do not recompute these with independent procedural noise for imported Azgaar maps.

### `src/editor/world/ProceduralWorldGenerator.js`

Already exposes deterministic:

```js
sampleHeight(...)
sampleTile(...)
sampleWater(...)
sampleClimate(...)
```

It does **not** currently expose the same rich `sampleGuidance()` contract. Phase 1 adds a small adapter/fallback rather than replacing this generator.

## Scatter

### `src/editor/stylized/vegetationScatter.js`

Current grass scatter:

- iterates eligible tile cells;
- creates deterministic clump offsets;
- samples height;
- produces packed `base` and `parameters` Float32 arrays;
- keeps clump randomness deterministic from chunk/cell/clump coordinates.

Current flower scatter is similarly deterministic.

**Important:** ecology should reject or shape candidates in these existing loops. Do not generate a second scatter set and then run a full-size filter/copy pass.

## Grass rendering

### `src/editor/stylized/StylizedGrassSlot.js`

Already owns:

- near 3-segment / 5-triangle blade geometry;
- far 1-segment / 1-triangle blade geometry;
- shared instance data;
- clump geometry;
- build slicing;
- compaction;
- per-chunk slot ownership;
- current object/rock influence texture path;
- current near/far band selection.

### `src/editor/stylized/StylizedGrassMaterial.js`

Already has:

- WebGPU/TSL implementation;
- world-space patching;
- natural trail/path wear;
- dirt masking;
- root shade;
- wind waves;
- per-blade wind phase/stiffness/flutter;
- per-blade color variation;
- per-blade authored shape data;
- trample/influence texture sampling;
- surface class suppression.

Do not rebuild these systems from donor GLSL.

### `src/editor/stylized/grassLodMath.js`

Already has:

- near/far band selection;
- density falloff math;
- clump density/spacing math;
- triangle cost helpers;
- memory-cost helper.

Extend this module with pure transition math instead of importing a donor controller class.

## Coordinates

### `src/editor/world/WorldCoordinates.js`

Canonical world Z is inverted from cell Z:

```text
world X = +(cellX + 0.5) * tileSize
world Z = -(cellZ + 0.5) * tileSize
```

### `src/editor/world/CoordinateSpaces.js`

Already provides:

```js
cellToCanonicalWorld(...)
canonicalWorldToCell(...)
renderLocalToCanonicalWorld(...)
canonicalWorldToRenderLocal(...)
```

Use these contracts. Do not invent another coordinate convention in ecology.

---

# 3. Fast source → target index

| Donor source | What to take | Target | Action |
| --- | --- | --- | --- |
| `src/world/ecology/WorldEcologyField.ts` | causal ecology outputs + formulas | new `src/editor/stylized/ecology/WorldEcologyField.js` | port formulas, remove Three.js/types, adapt inputs |
| `src/world/ecology/WorldEcologyTuning.ts` | starting tuning values | `editor.config.yaml` + validator | translate constants to YAML |
| `src/world/ecology/TerrainLandformField.ts` | coarse lattice gradient/curvature algorithm | new `src/editor/stylized/ecology/TerrainLandformField.js` | port, make units explicit, use target canonical coords |
| `src/app/WorldEnvironmentTuning.ts` | donor fixed ecology sun direction `[350,500,220]` | ecology config reference sun | normalize and use as initial static ecology direction only |
| `src/grass/GrassFieldVariation.ts` | dryness/vigor value noise + canopy AO | new `src/editor/stylized/ecology/GrassFieldVariation.js` | port pure math; expose configurable periods/strength |
| `src/grass/biome/GrassBiomeProfile.ts` | validated profile fields | target biome/palette config | adapt concepts, not fixed donor biome registry |
| `src/grass/biome/GrassBiomeProfiles.json` | meadow/dry/alpine starting examples | target Azgaar-biome vegetation overrides | translate selectively, do not copy as parallel truth |
| `src/grass/biome/GrassAccentSpecies.ts` | weighted accent species idea | target asset/prototype selection | map to existing ground-detail/flower/bush prototypes |
| `src/grass/GrassLodController.ts` | stochastic coverage, cheap reject, conservative trim diagnostics | `grassLodMath.js`, `StylizedGrassSlot.js`, material | reimplement for target 2-band system first |
| `src/grass/GrassLodTuning.ts` | shared transition invariants | target LOD config/tests | adopt invariants only; donor impostor constants are optional |
| `src/grass/interaction/GrassTrailField.ts` | RGBA trail state, reprojection, recovery, fixed contacts, 30 Hz update, lifecycle cleanup | new disturbance field | reimplement WebGPU-compatible |
| `src/grass/interaction/GrassInteractionField.ts` | foot/body/pulse contact model | target neutral contact producer | adapt without donor character dependency |
| `src/render/ResourceDisposal.ts` usage in current trail | failure-safe GPU cleanup principle | target disturbance lifecycle | copy lifecycle discipline, not donor helper blindly |
| `src/world/grass/NearGrassStreamingLimits.ts` | explicit safety ceiling principle | target config validation | apply only if adding new grass residency/radius controls |
| `src/grass/GrassPatchGrid.ts` | optional mid representation model | optional target Phase 7 | reference only |
| `src/grass/GrassGeometryFactory.ts` | optional mid geometry principles | optional target Phase 7 | reference only |
| `src/world/WorldGrassSystem.ts` | diagnostics/build-budget ideas | existing target slot/QA paths | reference individual algorithms only |
| `src/grass/impostors/*` | optional far representation | existing target impostor/bake conventions | do not implement until measured |

---

# 4. Phase 0 — Freeze the baseline before changing behavior

Do this before Phase 1.

## Step 0.1 — Capture current QA numbers

Run and save the results locally:

```bash
npm test
npm run qa:vegetation:lod
npm run qa:perf
npm run build
npm run verify
```

Record at least:

- grass scatter generation time;
- grass build slices/frame;
- frame p95/p99 where available;
- hitch counts;
- resident grass instances;
- near/far triangle estimate;
- chunk generation timing.

The target config already documents that increasing grass radius caused `grassScatterMs` and build slices to rise sharply. Do not lose that performance discipline while adding ecology.

## Step 0.2 — Add deterministic fixture helpers first

Before changing rendering, add pure test helpers capable of building a known chunk/page and sampling candidate positions. This gives Phase 1/2 a stable target for seam and determinism tests.

Recommended tests to create during the migration:

```text
test/ecology-field.test.js
test/terrain-landform-field.test.js
test/grass-field-variation.test.js
test/vegetation-ecology-scatter.test.js
test/vegetation-chunk-seam.test.js
test/vegetation-biome-blend.test.js
test/grass-lod-transition.test.js
```

Do not wait until the end to add these.

---

# 5. Phase 1 — Port the shared ecology field

This is the highest-value migration and should be done before adding any new grass representation.

## 5.1 Donor files to read

Use current donor versions at `e990543...`:

```text
src/world/ecology/WorldEcologyField.ts
src/world/ecology/WorldEcologyTuning.ts
src/world/ecology/TerrainLandformField.ts
src/app/WorldEnvironmentTuning.ts
```

The ecology implementation is still the same core model reviewed earlier.

## 5.2 New target files

Create:

```text
src/editor/stylized/ecology/ecologyMath.js
src/editor/stylized/ecology/TerrainLandformField.js
src/editor/stylized/ecology/WorldEcologyField.js
src/editor/stylized/ecology/WorldEcologyGuidance.js
```

Responsibilities must stay small:

### `ecologyMath.js`

Only pure helpers:

```text
clamp01
lerp
smoothstepRange
normalize2/normalize3 if needed
```

No Three.js.

### `TerrainLandformField.js`

Only coarse terrain shape:

```text
convexity
gradientX
gradientZ
slope
```

### `WorldEcologyGuidance.js`

Normalize target generator differences into one ecology-input contract.

### `WorldEcologyField.js`

Combine guidance + landform + static disturbance into:

```text
moisture
fertility
exposure
disturbance
rockiness
```

No rendering knowledge.

---

## 5.3 Port `TerrainLandformField.ts` almost algorithm-for-algorithm

### Take from donor

Keep these exact ideas:

1. sample on a coarse lattice instead of per terrain vertex;
2. use an 8-sample ring at 45° increments;
3. estimate gradient by projecting the ring samples onto X/Z;
4. estimate curvature from ring mean versus center;
5. use `tanh` for convexity instead of hard clamping;
6. bilinearly interpolate lattice results;
7. memoize lattice samples with a bounded cache;
8. derive slope from gradient with:

```text
gradient = hypot(gradientX, gradientZ)
slope = 1 - 1 / sqrt(1 + gradient²)
```

### Do not copy directly

Do not copy:

- TypeScript interfaces;
- donor `HeightSampler` types;
- assumptions that all horizontal coordinates are already metres;
- the packed 16-bit cache key without checking target world-range requirements.

### Target unit adaptation

The donor's documented `LANDFORM_LATTICE_STEP = 8` is **8 metres**.

Simulator-Test terrain generators sample in **cell coordinates**, while canonical world space uses metres through `tileSize`.

Therefore make the target landform field explicitly metre-based:

```js
const sampleHeightMeters = (worldX, worldZ) => {
  const cellX = worldX / tileSize;
  const cellZ = -worldZ / tileSize;
  return generator.sampleHeight(cellX, cellZ);
};
```

Prefer using existing coordinate helpers where integer cell centers are involved. For fractional height samples, keep the same sign convention explicitly and test it.

**Do not feed `localWorldZ` from `vegetationScatter.js` into ecology.** That value is render-local within the chunk. Ecology needs canonical/global position.

### Cache-key adaptation

The donor uses:

```text
(cellX & 0xffff) * 0x10000 + (cellZ & 0xffff)
```

Simulator-Test explicitly supports very large safe world cell coordinates. A 16-bit packed lattice key can alias distant positions.

Adapt this part.

Recommended target approach:

```text
Map key = `${latticeX}:${latticeZ}`
```

or a proven collision-free numeric packing compatible with `WORLD_MAX_SAFE_CELL_COORDINATE`.

The string allocation happens only on coarse lattice misses/hits, not per blade render frame, so correctness is more important than copying the donor key micro-optimization.

### Configuration

Move donor `LANDFORM_LATTICE_STEP = 8` to YAML as the initial value:

```yaml
stylizedSurface:
  ecology:
    landform:
      latticeStepMeters: 8
      measureStepMeters: 8
      curvatureRange: 0.01
      memoEntries: 16384
```

`measureStepMeters` and `curvatureRange` above are **target-owned tuning fields**. Do not use the example numbers blindly if the donor constructor values are not explicitly traced during implementation. The only reviewed hard donor constant here is the 8 m lattice spacing and 16,384 memo bound.

Before committing production tuning, inspect the current donor constructor call site and copy its actual `measureStep`/`curvatureRange` inputs or tune from target terrain scale.

---

## 5.4 Port `WorldEcologyTuning.ts` values into YAML

Donor values reviewed:

```text
baseRainfall                  0.46
curvatureDry                  0.55
curvatureWet                  1.55
slopeShed                     0.62
exposureDry                   0.78
exposureWet                   1.16
exposureAmbient               0.34
waterSupply                   0.72
rockSlopeStart                0.22
rockSlopeFull                 0.62
rockConvexity                 0.42
rockSoilBurial                0.72
fertilityMoistureExponent     0.65
fertilityDisturbance          0.70
fertilityFloor                0.12
fertilityCeiling              0.62
alpineFade                    0.22
```

Add these under a target-owned config shape, for example:

```yaml
stylizedSurface:
  ecology:
    enabled: true
    referenceSunDirection: [350, 500, 220]
    baseRainfall: 0.46
    curvatureDry: 0.55
    curvatureWet: 1.55
    slopeShed: 0.62
    exposureDry: 0.78
    exposureWet: 1.16
    exposureAmbient: 0.34
    waterSupply: 0.72
    rockSlopeStart: 0.22
    rockSlopeFull: 0.62
    rockConvexity: 0.42
    rockSoilBurial: 0.72
    fertilityMoistureExponent: 0.65
    fertilityDisturbance: 0.70
    fertilityFloor: 0.12
    fertilityCeiling: 0.62
    alpineFade: 0.22
```

The donor `referenceSunDirection` comes from `WORLD_SUN_DIRECTION = [350, 500, 220]`.

### Important adaptation: ecology sun is static

Do not bind ecological exposure to the current time-of-day/weather sun every frame. That would make static soil/moisture suitability change when the renderer sun moves.

Normalize the configured reference direction once when constructing the ecology sampler. Treat it as long-term insolation bias, separate from visual lighting.

---

## 5.5 Port `WorldEcologyField.sample()` formula-by-formula

Do not copy the class structure blindly. Copy the math.

### Inputs in donor

```text
height
landform { slope, convexity, gradientX, gradientZ }
hydrology { humidityBoost, waterProximity }
pathGrassMask
target sample object
```

### Target input contract

Use:

```js
{
  height,
  landform,
  guidance,
  staticDisturbance,
}
```

where `guidance` is normalized by `WorldEcologyGuidance.js`.

### Step A — slope / curvature

Copy:

```text
slope = clamp01(landform.slope)
convexity = clamp01(landform.convexity)
concavity = clamp01(-landform.convexity)
```

### Step B — exposure

Copy the donor's normal-from-gradient reconstruction rather than using the renderer normal:

```text
inverseLength = 1 / sqrt(gradientX² + gradientZ² + 1)

facing =
  (-gradientX * sunX + sunY - gradientZ * sunZ)
  * inverseLength

exposure = clamp01(
  exposureAmbient
  + (1 - exposureAmbient) * clamp01(facing)
)
```

### Step C — disturbance

Donor uses:

```text
disturbance = clamp01(1 - pathGrassMask)
```

Target should expose disturbance directly:

```text
disturbance = clamp01(staticDisturbance)
```

Do not invert twice.

Initial static disturbance sources:

1. road/path surface mask;
2. natural-trail wear mask only if it is available deterministically at build time;
3. authored no-growth areas if already represented in the chunk data.

Do **not** include player footsteps here. Dynamic disturbance is a separate runtime overlay in Phase 6.

### Step D — water retention

Copy:

```text
retention =
  (1 - slopeShed * slope)
  * lerp(exposureWet, exposureDry, exposure)
```

### Step E — local gathering

Copy:

```text
gathering = lerp(
  curvatureDry,
  curvatureWet,
  clamp01(0.5 + 0.5 * (concavity - convexity))
)
```

### Step F — mapped water supply adaptation

Donor has `max(humidityBoost, waterProximity)`.

Target Azgaar guidance already has richer data. Adapt it into a normalized `mappedWater` value rather than copying donor hydrology.

Recommended target normalization order:

```text
mappedWater = max(
  normalized guidance.moisture,
  normalized guidance.wetness,
  proximityFromRiverDistance,
  proximityFromWaterDistance
)
```

For `riverDistanceMeters` / water distance, use configurable falloff distances and convert to `[0,1]` with smoothstep. Do not compare raw metres directly with normalized moisture.

`riverFlux` may strengthen river proximity but should not be added as an independent full-strength moisture term without normalization.

Then preserve donor combination semantics:

```text
mapped = mappedWater * waterSupply
supply = max(baseRainfall * gathering, mapped)
```

### Step G — alpine drying adaptation

Donor computes an alpine band from `grassMaxAltitude`.

Simulator-Test imported Azgaar mountains can be vertically exaggerated and also exposes `snowPotential` and `mountainness`.

Use a combined target rule:

1. preserve a height-based fade for procedural worlds;
2. for Azgaar, allow `snowPotential` / mountainness to increase alpine suppression;
3. do not make Azgaar required.

Keep the donor principle:

```text
moisture = clamp01(supply * retention * alpineDrying)
```

### Step H — rockiness

Port donor math:

```text
stripped = clamp01(
  smoothstep(slope, rockSlopeStart, rockSlopeFull)
  + convexity * rockConvexity
  + alpineRockTerm
)

cover = clamp01(moisture * (1 - slope * 0.5))

rockiness = clamp01(
  stripped * (1 - rockSoilBurial * cover)
)
```

For Azgaar, `ruggedness` and `mountainness` may strengthen `alpineRockTerm`, but do not replace local slope/convexity. Azgaar says **what macro region this is**; local landform says **what this specific patch can retain**.

### Step I — fertility

Port donor math:

```text
accumulation =
  pow(moisture, fertilityMoistureExponent)
  * (1 - rockiness)
  * (1 - fertilityDisturbance * disturbance)
  * lerp(0.45, 1, 1 - slope)

fertility = smoothstepRange(
  accumulation,
  fertilityFloor,
  fertilityCeiling
)
```

Do not replace this with a sum of independent scores. The donor intentionally uses limiting/multiplicative factors to preserve ecological extremes.

---

## 5.6 Build `WorldEcologyGuidance.js`

This is the adaptation layer that prevents ecology from knowing whether the world came from Azgaar or the procedural generator.

### For `AzgaarMacroWorldGenerator`

Use:

```js
generator.sampleGuidance(cellX, cellZ)
generator.sampleBiomeBlend(cellX, cellZ)
```

Do not create a second `WorldGuidanceField` instance in vegetation code.

### For `ProceduralWorldGenerator`

Use existing:

```js
generator.sampleClimate(cellX, cellZ)
generator.sampleWater(cellX, cellZ)
generator.sampleTile(cellX, cellZ)
```

Normalize procedural climate to the same ecology guidance shape.

The procedural `sampleClimate().moisture` currently comes from signed fractal noise, so explicitly remap it to `[0,1]` before feeding ecology.

Do not pretend procedural worlds have real `riverFlux`, `forestPotential`, etc. Return documented neutral/default values for fields that do not exist.

Recommended normalized result:

```js
{
  moisture,
  wetness,
  waterProximity,
  riverProximity,
  mountainness,
  ruggedness,
  valleyness,
  snowPotential,
  forestPotential,
  agriculturalPotential,
  biomeBlend,
}
```

Each field should be finite and documented as `[0,1]` except the biome blend structure.

---

## 5.7 Integrate ecology into `generateWorldChunk.js`

Current call:

```js
enrichPageVegetationScatter(page, request.vegetationScatterConfig);
```

Change the API so scatter receives a **worker-local context**, not more serialized config.

Recommended shape:

```js
enrichPageVegetationScatter(
  page,
  request.vegetationScatterConfig,
  {
    generator,
    ecologyConfig: request.vegetationScatterConfig.ecology,
  },
);
```

Or create the sampler once in `generateWorldChunk()` and pass it:

```js
const ecology = createWorldEcologySampler({
  generator,
  page,
  tileSize: request.vegetationScatterConfig.tileSize,
  config: request.vegetationScatterConfig.ecology,
});

enrichPageVegetationScatter(
  page,
  request.vegetationScatterConfig,
  { ecology },
);
```

The second form is preferred because it keeps generator-specific adaptation out of `vegetationScatter.js`.

### Do not attach the generator to `page`

`page` is transferred/retained as chunk data. Keep non-serializable generator/sampler objects in the local call stack only.

### Do not generate five full Float32 ecology rasters by default

Initially sample ecology only at accepted/candidate vegetation positions.

Add page-level ecology rasters later only if rocks, ground material, bushes and other systems prove that one shared raster is cheaper than resampling.

---

## 5.8 Integrate ecology into `buildGrassScatter()` without another allocation pass

Current grass loop has this shape:

```text
for cell
  reject non-grass tile
  for clump
    deterministic offset
    sample height
    write instance
```

Change it to:

```text
for cell
  reject non-grass tile
  for clump
    deterministic offset
    resolve canonical candidate coordinate
    sample height
    sample ecology
    compute suitability
    deterministic accept/reject
    if accepted: write instance
```

### Candidate coordinates

Current local render coordinates are:

```js
localWorldX = -chunkWorldSize / 2 + sampleX * tileSize;
localWorldZ =  chunkWorldSize / 2 - sampleZ * tileSize;
```

Those are correct for instance placement but **not** the source for persistent ecology hashing.

Resolve canonical candidate coordinates from global cell position:

```text
globalCellX = page.originX + sampleX
globalCellZ = page.originZ + sampleZ
canonicalX = globalCellX * tileSize
canonicalZ = -globalCellZ * tileSize
```

Use exact target coordinate helpers when possible and add a seam test for fractional candidates.

### Suitability

Start simple and explicit:

```text
waterSuitability      = moisture response
soilSuitability       = fertility
rockSuitability       = 1 - rockiness
trafficSuitability    = 1 - disturbance
macroBiomeSuitability = existing tile eligibility / biome profile

suitability =
  waterSuitability
  * soilSuitability
  * rockSuitability
  * trafficSuitability
  * macroBiomeSuitability
```

Then compare suitability against an existing deterministic random channel:

```js
const acceptanceRoll = cellSampleRandom01(..., NEW_FIXED_SALT);
if (acceptanceRoll > suitability) continue;
```

Use a new documented salt/channel. Do not reuse width/length/angle random channels because changing suitability would then also change morphology correlation.

### Preserve prefix/compaction behavior

`compactGrassScatter()` assumes each accepted source cell contributes a fixed source-clump group. Ecology rejection can break that assumption if individual clumps within a cell are removed.

Therefore choose one of these two target-safe designs:

**Preferred A — cell-level density budget:**

- evaluate a cell suitability once;
- deterministically decide `acceptedClumps` from `0..clumpsPerCell`;
- always keep source clump indices `0..acceptedClumps-1`;
- preserve prefix semantics used by lower-density compaction.

**Alternative B — rewrite compaction metadata:**

- store per-cell/group metadata so compaction can still select deterministic prefixes;
- more code/memory, only use if per-clump ecology variation is visibly needed.

Start with A. Ecology varies at metre scale; it does not need to make 96-blade clump membership random independently inside one 2 m cell.

### Instance parameter adaptation

Use ecology to modify the existing width/length rolls at build time before writing them.

Example:

```text
lengthScale = lerp(dryHeightScale, wetHeightScale, ecology.moisture)
lengthScale *= lerp(poorSoilScale, 1, ecology.fertility)
lengthScale *= 1 - rockHeightReduction * ecology.rockiness
```

Keep final width/length inside configured target limits.

Do not add ecology Float32 attributes just to scale static blade length if the same result can be baked into existing `instanceParams`.

---

## 5.9 Phase 1 tests

Add tests for:

1. same canonical coordinate → identical ecology;
2. same seed/reload → identical ecology;
3. adjacent chunks give equal/near-equal landform/ecology on shared boundary samples;
4. negative chunk coordinates do not alias memo keys;
5. floating-origin conversion does not change ecology;
6. procedural and Azgaar guidance adapters both produce finite normalized values;
7. stronger disturbance never increases fertility;
8. steeper terrain does not increase water retention under equal inputs;
9. higher cover does not increase exposed rock under equal inputs;
10. ecology grass scatter remains deterministic and compactable.

### Phase 1 exit criteria

Do not proceed until:

- static vegetation scatter still happens in the worker;
- no new main-thread terrain sampler exists;
- chunk seams are clean;
- perf regression is measured;
- all old grass rendering remains visually functional even if ecology is temporarily subtle.

---

# 6. Phase 2 — Port macro grass variation

## 6.1 Donor file

Take from:

```text
src/grass/GrassFieldVariation.ts
```

Donor constants/ideas:

```text
dryness lattice period: 27 m
vigor lattice period:   19 m
dryness seed:            0x517cc1b7
vigor seed:              0x27220a95
macro dryness strength:  0.22
canopy AO strength:      0.17
second octave frequency: 2.7x
second octave weight:    0.5
```

## 6.2 New target file

Create:

```text
src/editor/stylized/ecology/GrassFieldVariation.js
```

Port these functions:

```text
hashLattice
valueNoise
patchNoise
sampleGrassMacroDryness
sampleGrassMacroVigor
resolveGrassCanopyAo
```

### Adaptation

Change the donor hard-coded periods/strengths to function/config inputs while retaining donor defaults.

Recommended API:

```js
createGrassFieldVariation(config)
  -> {
       sampleDryness(canonicalX, canonicalZ),
       sampleVigor(canonicalX, canonicalZ),
       canopyAo(vigor, suitability),
     }
```

Do not allocate objects inside hot candidate loops if a small functional API is faster/clearer.

## 6.3 Use the same macro sample for every grass representation

This is the most important donor invariant.

Do not sample one noise in worker scatter and a different noise node in `StylizedGrassMaterial.js` unless they are mathematically guaranteed to be identical.

Preferred target strategy:

- sample **vigor** at build time because it affects static density/height;
- sample **dryness** either at build time and bake it into existing parameters, or reproduce the exact same deterministic field in TSL using canonical world coordinates;
- canopy AO can be derived from vigor × suitability and baked into an existing color/variation channel if available.

Because WebGPU vertex buffer count is already constrained in `StylizedGrassSlot`, avoid adding a new dedicated ecology buffer unless profiling/design proves necessary.

## 6.4 Replace/augment current patch coloration carefully

`StylizedGrassMaterial.js` already computes:

```js
const patch = stylizedPatchMask(worldXZ, patchSettings);
const patchColor = mix(tuned.patchLush, tuned.patchDry, patch);
```

Do not simply stack another full-strength dryness noise on top. That would double-count large patch variation.

Migration choices:

### Preferred

Turn existing `stylizedPatchMask` into the artistic component and feed causal dryness as an additional low-strength modifier:

```text
finalDryness =
  ecologyDryness * ecologyWeight
  + artisticPatch * artisticWeight
```

Keep weights bounded and config-driven.

### Avoid

Do not replace `RegionalCharacterField` or all current patch noise with ecology in one change. Preserve art direction while adding causal coherence.

## 6.5 YAML

Add:

```yaml
stylizedSurface:
  ecology:
    grassVariation:
      drynessPeriodMeters: 27
      vigorPeriodMeters: 19
      drynessStrength: 0.22
      canopyOcclusionStrength: 0.17
      fineFrequencyMultiplier: 2.7
      fineWeight: 0.5
```

## 6.6 Tests

Port donor invariants:

- deterministic at fixed world coordinate;
- smooth continuity across lattice cells;
- dryness and vigor are decorrelated fields;
- values remain `[0,1]`;
- near/far representation uses the same macro result;
- floating-origin rebase does not move macro patches.

---

# 7. Phase 3 — Adapt biome grass profiles into the existing Azgaar/asset system

## 7.1 Donor files

Use:

```text
src/grass/biome/GrassBiomeProfile.ts
src/grass/biome/GrassBiomeProfiles.json
src/grass/biome/GrassAccentSpecies.ts
```

Useful donor profile fields:

```text
density
heightBand
widthBand
drynessBias
windDamping
shapeFamily
baseColor
tipColor
dryColor
rootDarkening
tipColorStrength
accentDensity
weighted accentSpecies
```

Donor example profiles are only:

```text
meadow
dry-steppe
alpine
```

They are examples, **not** a complete mapping for Simulator-Test/Azgaar.

## 7.2 Do not copy `GrassBiomeProfiles.json` as another runtime database

Simulator-Test already owns:

```text
Azgaar biome definitions
BiomeAssetPalette
BiomePrototypeSelector
editor.config.yaml asset/biome steering
```

Translate donor profile concepts into the target's existing biome definition/override layer.

Recommended YAML shape:

```yaml
stylizedSurface:
  vegetationProfiles:
    defaults:
      density: 1
      heightScale: [0.9, 1.1]
      widthScale: [0.9, 1.1]
      drynessBias: 0
      windDamping: 1

    byTileId:
      3:
        density: 0.55
        drynessBias: 0.35
      4:
        density: 1.0
      11:
        density: 0.25
        heightScale: [0.7, 0.85]
```

The IDs/values above must be filled from actual target biome semantics during implementation. Do not copy this example verbatim as final tuning.

## 7.3 Use biome blends on imported maps

For Azgaar worlds call:

```js
generator.sampleBiomeBlend(cellX, cellZ)
```

Blend numeric profile values by biome weight:

```text
density = Σ(weight × biomeDensity)
drynessBias = Σ(weight × biomeDrynessBias)
windDamping = Σ(weight × biomeWindDamping)
```

For bands, blend each endpoint independently and revalidate ordering.

For discrete choices such as `shapeFamily` or prototype species:

- choose using deterministic weighted selection from blend weights;
- do not abruptly use only the canonical biome at the boundary.

## 7.4 Map donor accent species to target assets

Do not copy donor species identifiers unless matching assets actually exist.

Map concepts:

```text
daisy / round-bloom     -> existing flower variants
fern / small-fern       -> existing ground-detail variants if available
grass-tuft / seed-head  -> existing authored ground-detail grass variants
low-shrub               -> existing bush/ground-detail variants
broadleaf-rosette       -> closest existing low foliage prototype
```

Use target `groundDetailVariants`, flower assets, bush variants and existing prototype-selection machinery.

If no equivalent asset exists, omit the species. Do not invent a fake runtime asset reference.

## 7.5 Feed the same profile/ecology into all small vegetation

Consumers should become:

### Grass

```text
biome profile × ecology suitability × macro vigor
```

### Flowers

Increase with:

```text
fertility
moderate moisture
low disturbance
accentDensity
appropriate biome profile
```

Avoid maximum flower density in saturated/waterlogged zones unless the selected species is wetland-specific.

### Bushes

Use profile/canopy/forest potential and moderate disturbance suppression.

### Rocks

Use ecology `rockiness` as a probability/scale modifier, while preserving existing target rock regional placement and authored asset selection.

### Ground detail

Use ecology to steer density/species, not to replace `RegionalCharacterField`.

## 7.6 Update existing scatter systems, do not create parallel renderers

Likely target files to adapt as consumers include:

```text
src/editor/stylized/vegetationScatter.js
src/editor/stylized/StylizedFlowerView.js
src/editor/stylized/StylizedBushView.js
src/editor/stylized/StylizedRockView.js
src/editor/stylized/BiomeAssetPalette.js
src/editor/stylized/BiomePrototypeSelector.js
```

Only modify each consumer as far as required to use the shared ecology/profile data.

---

# 8. Phase 4 — Extend config and validation correctly

## 8.1 `editor.config.yaml`

Add ecology immediately next to other `stylizedSurface` systems.

Do not put these values in JS constants once they become art/runtime tuning.

## 8.2 `src/config/validateEditorConfig.js`

Add a dedicated helper instead of bloating the existing main function further:

```js
function validateEcologyConfig(surface) { ... }
```

Then call it from `validateStylizedSurface()`.

Validate:

- `enabled` boolean;
- reference sun is 3 finite numbers and non-zero length;
- periods/steps > 0;
- memoEntries positive integer with a sane cap;
- normalized strengths in `[0,1]` where conceptually normalized;
- `rockSlopeStart < rockSlopeFull`;
- `fertilityFloor < fertilityCeiling`;
- profile bands have 2 finite ordered values;
- density multipliers are non-negative and bounded;
- any distance falloffs are positive and ordered.

Do not silently clamp malformed config at startup. Fail with a precise config path like the existing validator.

## 8.3 `createVegetationScatterConfig()`

Extend its serializable return with only the ecology configuration needed by worker generation.

Recommended:

```js
return {
  tileSize,
  ecology: serializeEcologyConfig(stylizedConfig.ecology),
  grass: ...,
  flowers: ...,
};
```

Keep it plain-data only.

---

# 9. Phase 5 — Improve current two-band LOD before adding another representation

## 9.1 Donor files

Read:

```text
src/grass/GrassLodController.ts
src/grass/GrassLodTuning.ts
```

Take these ideas:

1. reject by cheap distance before expensive visibility work;
2. overlap/crossfade representations rather than hard switching;
3. stochastic/dithered coverage instead of a transparent alpha sheet;
4. keep CPU coverage math conservative relative to the shader;
5. track **actually submitted** work;
6. avoid drawing a farther representation where a nearer representation fully covers it.

Do **not** copy the donor three-stage class as-is.

Simulator-Test already uses a two-band design:

```text
near = 3 segments / 5 triangles per blade
far  = 1 segment  / 1 triangle per blade
```

Improve that first.

## 9.2 Extend `grassLodMath.js`

Add pure functions such as:

```js
grassNearCoverage(distance, nearRadius, transitionWidth)
grassFarCoverage(distance, nearRadius, transitionWidth)
grassLodDitherKeep(seed, coverage)
```

Desired coverage relationship across the transition:

```text
near coverage: 1 -> 0
far coverage:  0 -> 1
```

Use a deterministic seed from instance/cell identity so the overlap does not shimmer as the camera moves.

Do not base the dither on frame/time.

## 9.3 Adapt `StylizedGrassSlot.js`

Current near and far geometry already share instance attributes. Preserve that.

Implementation order:

1. keep both geometries available around the transition ring;
2. give material/slot the same coverage inputs;
3. use deterministic instance/blade rank to decide visibility;
4. after visual parity is correct, reduce submitted far instances that are provably hidden by full near coverage.

Do not rebuild full instance buffers every frame just to crossfade.

## 9.4 Adapt `StylizedGrassMaterial.js`

Add stochastic coverage at the earliest cheap point available in the TSL graph.

The seed must be stable from data already present, for example:

- `parameters.w` clump seed;
- deterministic blade phase;
- canonical/world position hash.

Avoid a screen-space dither that swims with the camera.

## 9.5 Preserve ecology through LOD

Near/far must use the same:

```text
placement
height scale
dryness/vigor
palette bias
wind damping
```

Do not let far grass fall back to generic green while near grass is ecology-aware.

## 9.6 Add diagnostics

Port the donor principle of tracking actual submitted work.

Add/extend target perf counters for:

```text
near grass instances submitted
far grass instances submitted
estimated submitted grass vertices/triangles
visible grass chunks by band
```

Use existing `PerfCounters` conventions.

## 9.7 QA

Extend the existing:

```bash
npm run qa:vegetation:lod
```

Test:

- no empty ring;
- no double-density bright ring;
- deterministic transition pattern;
- color/ecology parity;
- actual submitted work falls with distance;
- camera rotation does not reveal band seams.

Do not create another unrelated LOD QA command unless the existing script cannot reasonably own the checks.

---

# 10. Phase 6 — Port persistent dynamic vegetation disturbance

This is separate from static ecology.

## 10.1 Donor files

Current donor:

```text
src/grass/interaction/GrassTrailField.ts
src/grass/interaction/GrassInteractionField.ts
src/render/ResourceDisposal.ts
```

## 10.2 What to take from current `GrassTrailField.ts`

Take the state contract exactly in concept:

```text
R = encoded crush direction X
G = encoded crush direction Z
B = crush amount
A = contact freshness
```

Neutral:

```text
(0.5, 0.5, 0, 0)
```

Take:

- a square field centered/following the focus;
- reprojection from previous center to new center;
- two-buffer ping-pong state;
- fixed contact capacity;
- max contact count = 4 as a good initial target;
- contact data packed in preallocated arrays;
- exponential recovery + linear recovery floor;
- faster freshness decay;
- 30 Hz simulation update instead of display refresh;
- frame delta clamp;
- half-float preferred, quantized fallback behavior if needed;
- failure-safe allocation and cleanup;
- explicit disposal/reconfiguration lifecycle.

Current donor defaults:

```text
resolution      256
coverage        24 m
recoveryRate    0.5 / sec
freshnessRate   1.4 / sec
update rate     30 Hz
max contacts    4
```

Use them as starting values, then profile target GPU behavior.

## 10.3 What not to copy

Do not copy:

- `THREE.WebGLRenderTarget`;
- `THREE.ShaderMaterial`;
- GLSL vertex/fragment strings;
- WebGL renderer attachment API;
- donor global singleton ownership if it conflicts with target lifecycle.

## 10.4 New target modules

Create:

```text
src/editor/stylized/interaction/VegetationDisturbanceField.js
src/editor/stylized/interaction/VegetationContactBuffer.js
```

Optional small helper:

```text
src/editor/stylized/interaction/vegetationDisturbanceMath.js
```

### `VegetationContactBuffer.js`

Own a fixed Float32Array for contacts.

Suggested neutral contact API:

```js
submitContact({
  x,
  z,
  radius,
  strength,
  directionX,
  directionZ,
  innerRadiusFraction,
  directionalBlend,
})
```

No player/grass imports.

### `VegetationDisturbanceField.js`

Own:

- GPU state textures;
- focus/canonical center;
- update cadence;
- reprojection;
- decay;
- lifecycle/disposal;
- texture/view exposed to vegetation materials.

## 10.5 Port donor contact behavior from `GrassInteractionField.ts`

Take concepts, not donor character constants/classes:

### Foot contacts

- two contacts;
- forward/lateral offsets;
- strength related to planted phase and movement;
- direction biased toward travel direction;
- small deterministic irregularity.

### Body contact

- one broader contact behind/around body;
- directional bias rises with movement speed.

### Landing/impact pulse

- expanding ring;
- exponential strength decay;
- inner-radius fraction creates a ring rather than a filled disc.

### Target adaptation

Do not import donor `SnowflowCharacter` or `STRIDE_LENGTH_METERS`.

Take pose data from the existing Simulator-Test player/controller state. If exact foot animation phase is unavailable, start with body + velocity-based contacts and add true foot phase only when the target animation system exposes it cleanly.

Expose a gameplay-neutral pulse function so spells/explosions can later call:

```js
vegetationDisturbance.pulse(canonicalX, canonicalZ, radius, strength)
```

without importing grass code.

## 10.6 Integrate with `StylizedGrassMaterial.js`

The target already samples a `trampleTexture` supplied to the grass material.

Do not add a second independent grass-interaction texture if the current `trampleTexture` contract can be generalized.

Preferred migration:

1. separate current static object/rock influence from dynamic disturbance logically;
2. either combine them before material sampling or sample two textures only if the extra texture binding is acceptable;
3. keep rock flattening behavior intact;
4. use dynamic crush direction/amount/freshness to bend and temporarily flatten grass.

Because the grass pipeline already operates close to WebGPU vertex-buffer limits, prefer texture/state reuse over new vertex attributes.

## 10.7 Coordinate handling

Store disturbance field center in canonical world coordinates.

On render, convert between canonical and render-local using `FloatingOrigin`/`CoordinateSpaces`.

Rebasing must not clear or shift the trail. Only actual movement of the focus relative to canonical world should reproject it.

## 10.8 Lifecycle

Current donor added stronger failure-safe cleanup after the first guide.

Copy that discipline:

- allocate temporary GPU resources transactionally;
- if creation fails, dispose every successfully-created partial resource;
- reconfiguration releases old targets only in a controlled path;
- destroy/dispose is idempotent;
- no stale texture reference remains in material after disposal.

Add a lifecycle test similar in spirit to the donor's new verification work.

---

# 11. Phase 7 — Optional mid grass representation, only after profiling

Do not implement this because the donor has it. Implement only if Phase 5 proves the current far single-triangle blades are still too expensive or visually insufficient.

## Donor references

Read:

```text
src/grass/GrassPatchGrid.ts
src/grass/GrassGeometryFactory.ts
src/world/grass/WorldGrassPatchGeometryFactory.ts
src/world/WorldGrassSystem.ts
src/grass/GrassLodController.ts
```

## What to take

- render batches coarser than exact near grass;
- per-instance coverage;
- build slicing;
- chunk-local grouping;
- avoid redundant far layers inside the mid band;
- conservative submission trimming;
- streaming fade-in rather than chunk pop;
- explicit measured build budgets.

## What to keep from target

- `StylizedGrassSlot` ownership;
- worker scatter data;
- WebGPU/TSL material;
- existing near authored blade shapes;
- target config/QA/perf system.

## Target design

If needed, add one **coarser representation inside the existing slot**, not another global world grass manager.

It must consume the same:

```text
ecological suitability
biome blend
macro dryness/vigor
wind model
coverage seed
```

as near/far grass.

## Safety limits

Current donor later added explicit near-grass radius safety (`MAX_NEAR_GRASS_TILE_RADIUS = 24`).

If Simulator-Test adds a new independently-configurable mid/near residency radius, add a similar target-specific maximum in config validation. Do not permit accidental config values to allocate an unbounded grass ring.

---

# 12. Phase 8 — Optional far grass impostors, last

Only consider this after current two-band + optional mid grass has been measured.

Donor references:

```text
src/grass/impostors/
src/world/grass/WorldGrassImpostorAtlasFactory.ts
src/grass/GrassLodTuning.ts
```

Take:

- atlas lifecycle discipline;
- same wind phase/visual response across transition;
- shared color/ecology inputs;
- chunk-level/coarse far grouping;
- bounded atlas memory;
- validation that wind displacement stays inside bounds.

Do not copy donor WebGL material code.

Prefer adapting Simulator-Test's existing authored impostor/bake infrastructure and asset validation conventions rather than creating a grass-only second framework.

---

# 13. Detailed file-by-file target edit list

This section is the practical checklist to follow while coding.

## New files

### `src/editor/stylized/ecology/ecologyMath.js`

Take from:

- helper math embedded in donor `WorldEcologyField.ts`;
- bilinear interpolation idea from `TerrainLandformField.ts`.

Implement:

```text
clamp01
lerp
smoothstepRange
bilinear
```

No config, no renderer, no Three.js.

### `src/editor/stylized/ecology/TerrainLandformField.js`

Take from donor `TerrainLandformField.ts`:

```text
8-sample ring
coarse lattice
bilinear interpolation
tanh convexity
slope from gradient
bounded memo
```

Adapt:

```text
metre/cell conversion
cache key range
plain JS
config-driven lattice/measure settings
```

### `src/editor/stylized/ecology/WorldEcologyGuidance.js`

Take from target generators, not donor.

Adapt:

```text
Azgaar sampleGuidance -> normalized ecology guidance
procedural sampleClimate/sampleWater -> same normalized shape
```

### `src/editor/stylized/ecology/WorldEcologyField.js`

Take formulas from donor `WorldEcologyField.ts`.

Adapt:

```text
no THREE.Vector3
static configured reference sun
Azgaar/procedural guidance abstraction
direct disturbance input
```

### `src/editor/stylized/ecology/GrassFieldVariation.js`

Take pure deterministic noise from donor `GrassFieldVariation.ts`.

Adapt hard constants to config while retaining donor defaults.

### `src/editor/stylized/interaction/VegetationContactBuffer.js`

Take fixed packed contact storage idea from current donor trail field.

### `src/editor/stylized/interaction/VegetationDisturbanceField.js`

Take trail-state algorithm/lifecycle from current donor trail field.

Reimplement for target WebGPU lifecycle.

---

## Existing files to modify

### `editor.config.yaml`

Add:

```text
stylizedSurface.ecology
stylizedSurface.vegetationProfiles (or equivalent existing biome override ownership)
stylizedSurface.interaction/disturbance settings when Phase 6 starts
LOD transition width/settings when Phase 5 starts
```

Use donor constants as starting defaults only where this guide lists reviewed values.

### `src/config/validateEditorConfig.js`

Add dedicated validators:

```text
validateEcologyConfig
validateVegetationProfiles
validateVegetationDisturbanceConfig
```

Do not scatter dozens of ecology checks through unrelated blocks.

### `src/editor/stylized/vegetationScatter.js`

Modify:

```text
createVegetationScatterConfig
buildGrassScatter
buildFlowerScatter
enrichPageVegetationScatter
```

Changes:

1. serialize ecology config;
2. accept worker-local ecology context;
3. evaluate grass cell suitability before writing instances;
4. preserve deterministic prefix/compaction semantics;
5. scale existing width/length parameters instead of automatically adding attributes;
6. make flowers ecology/profile aware;
7. add timings if ecology becomes measurable cost.

### `src/editor/world/generateWorldChunk.js`

Changes:

1. construct world ecology sampler after terrain/water data are available;
2. keep sampler worker-local;
3. pass sampler/context to vegetation scatter;
4. record ecology/scatter timing separately if useful;
5. do not attach generator object to page.

### `src/editor/world/ProceduralWorldGenerator.js`

Prefer **not** to change its public contract unless necessary.

If the adapter becomes cleaner with a `sampleGuidance()` method, add it here using existing `sampleClimate()`/water data and document that it is the procedural fallback contract.

Do not duplicate Azgaar-only fields with fake procedural simulations.

### `src/editor/stylized/StylizedGrassSlot.js`

Phase 1/2:

- no architectural rewrite;
- consume ecology-shaped scatter parameters already packed by worker.

Phase 5:

- add stochastic near/far transition ownership;
- add conservative submission reduction;
- keep shared instance buffers;
- keep geometry buffer count under WebGPU limits.

Phase 6:

- wire generalized disturbance texture/state into material lifecycle.

### `src/editor/stylized/StylizedGrassMaterial.js`

Phase 2:

- blend causal dryness/vigor/canopy AO with existing artistic patch/color system;
- preserve current wind/root/translucency/shape logic;
- avoid duplicate large-scale noise at full strength.

Phase 5:

- apply deterministic coverage/dither.

Phase 6:

- sample persistent dynamic disturbance.

### `src/editor/stylized/grassLodMath.js`

Add only pure/testable math:

```text
transition coverage
stochastic keep threshold
submitted-cost estimates
```

Do not put scene/mesh state here.

### `src/editor/stylized/BiomeAssetPalette.js`
### `src/editor/stylized/BiomePrototypeSelector.js`

Adapt only enough to accept profile/ecology weighting of existing prototypes.

Do not make them sample terrain or climate themselves.

### `src/editor/stylized/StylizedFlowerView.js`
### `src/editor/stylized/StylizedBushView.js`
### `src/editor/stylized/StylizedRockView.js`

Consume already-resolved scatter/profile/ecology decisions.

Do not create one independent ecology sampler per renderer.

---

# 14. Data ownership rules

Use this to avoid duplicated state.

## Worker-only transient data

```text
generator reference
landform sampler/memo during chunk build
ecological candidate samples
biome blend at candidate
```

Do not transfer these objects to main thread.

## Chunk/page transferred data

Only data actually required by rendering/runtime:

```text
existing grass base/params
existing flower base/params
optionally compact ecology-derived packed values if material cannot derive them
```

## Main-thread runtime data

```text
GPU grass geometry/material
LOD state
dynamic disturbance field
player/spell contact producers
```

## YAML-owned tuning

```text
ecology coefficients
landform scale
guidance falloff distances
grass macro variation periods/strength
biome vegetation overrides
interaction field size/recovery
LOD transition width
```

---

# 15. Performance rules for implementation

1. **No per-frame CPU ecology for static grass.** Static ecology is build-time.
2. **No duplicate full scatter filter pass.** Reject before writing accepted instances.
3. **No per-candidate object churn in worker hot loops.** Reuse sample objects or return scalars/packed structures.
4. **Landform must be coarse/memoized.** Do not sample an 8-point height ring for every blade candidate independently.
5. **Do not attach five Float32 ecology rasters to every chunk by default.**
6. **Do not add vertex attributes before checking the existing WebGPU buffer budget.** `StylizedGrassSlot` already documents the eight-buffer pipeline limit.
7. **Use existing random channels or add documented independent salts.** Do not call `Math.random()`.
8. **Keep near/far instance buffers shared.** Do not duplicate scatter buffers per LOD.
9. **Update dynamic trail at a capped cadence (start at donor 30 Hz).**
10. **Bound every new residency/cache/texture allocation with validation.**
11. **If ecology adds > a small measurable chunk-generation cost, profile before optimizing blindly.** The landform cache and cell-level ecology evaluation are the first optimization levers.

---

# 16. QA migration from donor

Useful donor verification concepts to reproduce under target conventions include:

```text
verify-ecology
verify-lod-continuity
verify-grass-shape-continuity
verify-lod-color-parity
verify-grass-placement
verify-grass-streaming-performance
verify-grass-performance
verify-world-grass-allocation
verify-near-grass-streaming
verify-near-grass-lifecycle
verify-grass-geometry-lifecycle
```

Do not copy scripts wholesale. Port their **invariants** into target tests/QA.

## Required Node tests

### `test/terrain-landform-field.test.js`

Cover:

- flat plane → near-zero gradient/slope/convexity;
- plane incline → stable gradient and no fake convexity;
- bowl → negative convexity;
- ridge → positive convexity;
- negative/global coordinates do not alias cache;
- interpolation continuous between lattice cells.

### `test/ecology-field.test.js`

Cover monotonic causal rules and bounds.

### `test/grass-field-variation.test.js`

Cover deterministic/noise range/continuity.

### `test/vegetation-ecology-scatter.test.js`

Cover:

- deterministic count/data;
- cell prefix semantics;
- high disturbance reduces accepted clumps;
- high rockiness reduces accepted clumps;
- ecology scales existing parameters predictably.

### `test/vegetation-chunk-seam.test.js`

Build adjacent chunks and compare ecological samples on both sides of the seam.

### `test/vegetation-biome-blend.test.js`

Verify weighted numeric profile blending.

### `test/grass-lod-transition.test.js`

Verify coverage sums/ordering and stable dither.

### disturbance lifecycle tests

When Phase 6 lands, test:

- configure/reconfigure cleanup;
- partial allocation failure cleanup;
- idempotent dispose;
- fixed contact capacity;
- recovery reaches neutral;
- focus movement reprojects rather than clears valid overlap.

## Browser/perf QA

Extend existing target paths:

```bash
npm run qa:vegetation:lod
npm run qa:perf
```

Add views/counters only where rendering is required.

---

# 17. Implementation order by commit-sized slice

Use this order. Each item should leave `main` healthy.

## Slice 1 — pure landform math

Files:

```text
+ ecologyMath.js
+ TerrainLandformField.js
+ tests
```

No runtime integration yet.

## Slice 2 — pure ecology math

Files:

```text
+ WorldEcologyField.js
+ YAML ecology config
+ config validation
+ tests
```

Still no rendering behavior change.

## Slice 3 — guidance adapter

Files:

```text
+ WorldEcologyGuidance.js
+ procedural/Azgaar adapter tests
```

## Slice 4 — worker integration, grass only

Files:

```text
generateWorldChunk.js
vegetationScatter.js
scatter tests
```

Use ecology only for grass density/height. Keep color/render unchanged initially.

## Slice 5 — macro dryness/vigor

Files:

```text
+ GrassFieldVariation.js
vegetationScatter.js
StylizedGrassMaterial.js
config/tests
```

## Slice 6 — flowers and small vegetation

Files:

```text
vegetationScatter.js
BiomeAssetPalette/Selector as needed
flower/bush/rock/detail consumers as needed
```

## Slice 7 — biome blend profiles

Add/configure profile data and deterministic blended selection.

## Slice 8 — current near/far LOD continuity

Files:

```text
grassLodMath.js
StylizedGrassSlot.js
StylizedGrassMaterial.js
qa/test updates
```

## Slice 9 — persistent dynamic disturbance

Files:

```text
+ interaction modules
player/contact integration
StylizedGrassSlot/material wiring
lifecycle tests
```

## Slice 10 — profile again

Only after measurements decide whether Phase 7/8 optional representations are justified.

---

# 18. Things explicitly not to migrate

## Do not copy donor placement architecture

Do not migrate `MeshSurfaceSampler` / donor `GrassDistribution` placement into the streamed world.

Target worker scatter is more appropriate for deterministic huge maps.

## Do not copy donor world ownership

Do not migrate:

```text
WorldApp
TerrainStreamer
full WorldGrassSystem
camera/controller lifecycle
world config loader/schema
```

## Do not copy donor WebGL materials

No:

```text
ShaderMaterial
WebGLRenderTarget
GLSL strings
WebGL renderer attach/update lifecycle
```

Algorithms only.

## Do not copy donor biome registry as truth

Azgaar/target biome definitions remain authoritative.

## Do not copy donor character implementation

Only adapt contact concepts into target controller/gameplay data.

## Do not add mid/far representations pre-emptively

The target already has a deliberately cheap far blade. Measure first.

---

# 19. Definition of done for the whole migration

The migration is done only when all of these are true:

- static grass placement is driven by shared causal ecology, not only tile eligibility + unrelated randomness;
- imported Azgaar moisture/wetness/river/morphology guidance materially influences local vegetation;
- procedural worlds produce deterministic sensible fallback ecology;
- grass, flowers, bushes, rocks and ground detail agree spatially where migrated;
- wet hollows and dry/exposed ridges are visible as coherent regions;
- disturbance suppresses growth consistently;
- broad grass dryness/vigor patches are stable in canonical world space;
- near/far grass uses the same ecological appearance;
- no LOD density/color ring is obvious during movement;
- static ecology/scatter remains worker-side;
- floating-origin rebasing changes no static field;
- dynamic tracks remain in the correct canonical location across rebases;
- no duplicate terrain/hydrology/biome/config system was introduced;
- no WebGL dependency was added to the target grass path;
- new GPU resources have bounded allocation and safe disposal;
- performance is equal to or better than baseline at equivalent quality, or a measured cost is explicitly accepted for a measured visual gain;
- `npm test`, `npm run qa:vegetation:lod`, `npm run qa:perf`, `npm run build`, and `npm run verify` pass;
- manual WebGPU visual smoke testing shows no seams, mirrored ecology, swimming patches, popping, permanent quantized trails or obvious ecological contradictions.

---

# 20. Attribution

`danielsobrado/FluffyGrass` is a fork of the MIT-licensed `thebenezer/FluffyGrass`.

When copying substantive source code rather than independently reimplementing an algorithm, retain the applicable MIT attribution and update `THIRD_PARTY_NOTICES.md` in Simulator-Test as required.

For this migration, the preferred approach is:

- port pure algorithms where appropriate;
- rewrite renderer/lifecycle code for target architecture;
- retain attribution for donor-derived implementation code.

---

# 21. Final decision summary

## Migrate now

```text
WorldEcologyField formulas
TerrainLandformField coarse landform algorithm
WorldEcologyTuning starting values
fixed ecological sun-direction concept
GrassFieldVariation deterministic macro fields
biome profile fields/validation concepts
biome weighted accent-selection concept
current two-band stochastic LOD transition ideas
persistent trail/contact model
resource lifecycle discipline
donor QA invariants
```

## Keep from Simulator-Test

```text
Azgaar WorldGuidanceField
Azgaar sampleBiomeBlend
ProceduralWorldGenerator
worldChunk worker architecture
generateWorldChunk orchestration
vegetationScatter typed arrays
floating origin / coordinate helpers
StylizedGrassSlot
WebGPU/TSL grass material
current near/far blade geometry
RegionalCharacterField
BiomeAssetPalette / BiomePrototypeSelector
existing flower/bush/rock/detail renderers
editor.config.yaml
validateEditorConfig
PerfCounters
existing QA/perf commands
```

## Adapt rather than copy

```text
donor hydrology -> target Azgaar/procedural guidance adapter
donor metre coordinates -> target canonical world/cell conversion
donor Three.js ecology vector math -> scalar worker-safe JS
donor hard tuning constants -> YAML
donor fixed biome registry -> target Azgaar/profile overrides
donor WebGL trail texture -> target WebGPU-compatible disturbance field
donor 3-stage LOD controller -> target 2-band transition first
donor cache key -> huge-world-safe key
donor character contacts -> neutral target contact API
```

## Do not migrate unless profiling later proves the need

```text
mid patch representation
far grass impostors
full donor WorldGrassSystem
donor terrain streamer
donor MeshSurfaceSampler placement
donor WebGL materials/render targets
donor config loader/schema
donor character/controller stack
```
