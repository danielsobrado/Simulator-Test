# Water Performance Optimization Plan

Date: 2026-07-29

Status: planned; no optimization work in this document has been executed.

Related evidence:

- [Player movement performance QA](../perf-qa.md)
- [Water refraction performance investigation](../perf-investigation-2026-07-28.md)
- [W2B water refraction implementation](w2b-water-refraction-implementation-2026-07-28.md)
- [W2C water foam and caustics acceptance](w2c-water-foam-caustics-acceptance-2026-07-28.md)
- [Water acceptance hardening](../qa/water-acceptance-hardening-2026-07-28.md)

## Executive decision

The broad diagnosis is credible: the expensive part of high-tier water is
screen-space and fragment work, not the size of the stored water field. The
original assessment is not, however, an accurate description of the current
implementation. Some of its highest-priority work is already present, some
shader-cost counts became stale after the 2026-07-29 shader optimization, and
several proposed changes still need isolated hardware evidence.

The next change should start with a reproducible water quality A/B matrix and
then make small, independently measurable shader changes. Geometry generation,
bulk water-field generation, texture packing, and instancing stay deferred until
the measurements identify them as material costs.

The total size of a streamed world is not itself the steady-frame cost driver.
The runtime bounds its working set with `world.maxResidentChunks`; the current
configuration uses 64-cell chunks and at most 49 resident chunks. Water cost is
therefore primarily a function of:

- how many resident chunks contain water;
- how much of the viewport those chunks cover;
- which material variant is compiled and active;
- whether viewport colour and depth captures are active;
- whether the underwater full-screen composite is active; and
- how much CPU work and data upload occurs when new chunks arrive.

Claims that water is categorically "too expensive for a huge map" must be
restated as testable claims about those bounded costs on target hardware.

## Goals

1. Preserve current water geography, physics, navigation, body identity, and
   persistence behavior.
2. Avoid all water rendering and viewport-copy work for dry resident chunks.
3. Reduce fragment work for dry pixels inside partially wet chunks.
4. Reduce redundant screen-depth sampling in the refractive material.
5. Keep full-screen projected caustics off when their contribution is
   imperceptible.
6. Define quality tiers that represent predictable performance steps.
7. Reduce water generation and upload work only when streaming counters show it
   contributes materially to frame hitches.
8. Require repeatable hardware evidence and visual acceptance for every
   optimization.

## Non-goals

- Changing canonical water semantics or making render data authoritative.
- Changing terrain IDs, Azgaar biome compatibility, or adding legacy terrain
  migrations.
- Rewriting the render graph before smaller changes are measured.
- Introducing texture arrays or water instancing solely to reduce draw calls.
- Trading visible water seams, foreground leakage, unstable shorelines, or
  floating-origin discontinuities for unmeasured performance gains.
- Treating CPU timers as proof of a GPU improvement.

## Current implementation baseline

### Already implemented

The following work from the original assessment is already present:

- `waterFieldHasCoverage` identifies dry fields from coverage channel 0.
- `StylizedWaterSlot` hides completely dry chunks.
- Dry, wet, refractive, upload-byte, generation-time, and projected-caustic
  counters exist.
- Refraction is a build-time material branch.
- The non-refractive material is created up front.
- The refractive material is created lazily, only when a wet chunk is close to
  the viewer.
- Refraction is limited to a two-chunk Chebyshev radius around the focus chunk.
- Water FBM used by the surface and refraction paths is bounded to two octaves.
- Nearest and smoothed cellular surface metrics reuse one nine-neighbor
  distance set.
- Low quality skips the cellular surface path.
- Procedural surface and caustic edges use derivative anti-aliasing.

These behaviors are protected by:

- `test/water-dry-chunk-culling.test.js`
- `test/water-shader-performance-contract.test.js`
- `test/water-refraction-material-contract.test.js`
- `test/water-quality.test.js`
- `test/projected-water-caustics.test.js`

### Known current costs

#### Viewport capture

High and ultra water use both `viewportOpaqueMipTexture` and
`viewportDepthTexture`. The 2026-07-28 investigation measured this as a
whole-frame cost that behaves more like a binary feature switch than a
per-water-draw cost:

| Probe variant | Average FPS |
|---|---:|
| Both viewport colour and depth | 75.6 |
| Depth only | 76.0 |
| Mipped colour only | 91.4 |
| Entire refraction branch removed | 164.2 |

Those absolute figures came from the lighter probe scene and must not be treated
as product performance. The relative result is still useful: removing only one
capture path did not escape the expensive renderer path. The current
plain/refractive material split is therefore more important than ordinary
visibility culling for avoiding the collapse away from water.

In the asset-complete scene, the same material split reduced average render CPU
time by about 0.31 ms but did not produce a statistically reliable average-FPS
gain. This prevents presenting viewport work as the current universal
bottleneck.

#### Fragment shader

On a wet high-tier chunk, the material can evaluate:

- two two-octave surface noise values;
- one nine-neighbor cellular surface evaluation that produces both nearest and
  smoothed-nearest metrics;
- depth optics and Fresnel terms;
- geographic and flow foam;
- two two-octave refraction noise values;
- viewport safety and custom depth rejection;
- one separate nine-neighbor caustic distance field; and
- final colour, absorption, foam, and alpha composition.

`material.alphaTest` is applied after the colour and opacity graphs. It discards
the final fragment but is not an explicit early branch around the preceding
procedural work.

#### Refraction depth samples

The current high/ultra refraction branch performs:

1. a depth sample inside `viewportSafeUV(screenUV)`;
2. a depth sample inside `viewportSafeUV(distortedUV)`;
3. an explicit base depth sample; and
4. an explicit distorted depth sample.

The custom metre-based rejection is valuable because it remains stable when the
camera far plane changes. The duplication around that rejection is a strong
candidate for removal.

#### Projected underwater caustics

Projected caustics replace the ordinary render while active with:

1. an offscreen scene colour/depth pass; and
2. a full-screen reconstruction and caustics composite.

This does not render the world twice, but the composite currently starts for any
positive transition blend. Its fragment graph reconstructs position, computes
distance, evaluates three sine waves and a power, and only then multiplies by
sky, surface, depth, distance, and blend masks.

#### Water-field generation

Chunk generation fills `page.tiles` and `page.heights`, then builds a haloed
water field by calling `sampleWater` for every field sample. Integer height
queries benefit from the water terrain model's vertex-height cache, so this is
not necessarily a full duplicate terrain calculation. It still repeats calls,
queries water semantics, allocates sample objects, and processes a halo.

`waterGenerationMs` exists to determine whether this is significant during
streaming. It should be measured before the generator API is widened.

## Assessment of the proposed changes

| Proposal | Current verdict | Planning consequence |
|---|---|---|
| Hide dry pages | Already implemented | Retain and strengthen its counters/tests |
| Add water bounds and enable frustum culling | Plausible, not proven | Generate bounds off-thread and A/B; do not scan half-floats on upload |
| Explicit early fragment discard | Strong candidate | First shader optimization after the measurement baseline |
| Reduce procedural noise | Partly implemented | Measure current two-octave shader before removing more |
| Remove high-tier legacy cellular detail | Art/performance trade-off | Test as a separate material/tier variant |
| Replace the mipped viewport node | Technically justified at mip 0, benefit uncertain | Isolated A/B after depth-sample cleanup |
| Remove redundant depth checks | Strong candidate | First optimization phase |
| Gate projected caustics | Strong candidate | First optimization phase |
| Make projected caustics ultra-only | Sensible tier policy, not a no-regret fix | Quality-tier phase plus visual sign-off |
| Generate wet-cell geometry | Useful for sparse water if fragment-bound | Defer until wet-pixel and GPU evidence exists |
| Reuse page heights and tiles in water generation | Directionally useful | Defer until generation time is material |
| Use shared neutral flow textures | Small upload/residency saving | Bundle with field metadata only if measurable |
| Texture arrays and instancing | Premature | Consider only after fragment and screen-copy work |

## Measurement protocol

All implementation phases depend on this protocol.

### Environment controls

- Use the deterministic harness described in `docs/perf-qa.md`.
- Use a real WebGPU hardware adapter; abort on software or unidentified
  adapters.
- Close every other tab and dev server rendering the app.
- Keep viewport width, viewport height, and device scale factor identical.
- Confirm authored assets are present and match the normal working copy.
- Use the same source state, route, world seed, camera pose, and warmup.
- Run alternating A/B pairs rather than all A runs followed by all B runs.
- Capture at least three runs per variant; increase the count when results sit
  inside ordinary run-to-run variance.
- Report median and spread, not only the best run.
- Preserve raw JSON reports under a dated `tmp/` or QA evidence directory.

### Required scenarios

The matrix needs both dry and wet routes:

1. **Dry route:** no visible water and no nearby refractive chunk.
2. **Shore route:** mostly dry viewport with a coastline crossing it.
3. **River route:** a narrow water body producing a low wet-cell ratio.
4. **Open-water route:** water covers most of the viewport.
5. **Underwater transition:** enter, remain submerged, and surface.
6. **Chunk-crossing water route:** cross a chunk boundary while water fields
   stream.

Procedural ocean and imported river/coast water must both be represented before
final acceptance.

### Required quality and feature matrix

```text
water disabled
low
medium
high without refraction
high with refraction
high with refraction but without projected caustics
high with projected caustics
ultra
```

The harness should support feature overrides without editing the checked-in
visual YAML between runs. Overrides are diagnostic only and must not change
simulation water semantics.

### Metrics

Collect for every run:

- average FPS;
- frame `dt` p50, p95, p99, maximum, and hitch rate;
- render and stylized phase distributions;
- terrain commit and streaming phase distributions;
- water generation time;
- water upload bytes;
- resident dry and wet water chunks;
- refractive water chunks;
- actual submitted water draws;
- wet-cell ratio per submitted chunk or an aggregate histogram;
- frames on which viewport capture is expected to be active;
- projected-caustic active frames and CPU submission time;
- renderer draw calls and triangles where reliable;
- adapter, viewport, device scale factor, source revision, and config snapshot.

`waterChunksRefractive` is currently a useful proxy for viewport-copy activity,
but it is not a direct renderer counter. Reports must label it as a proxy unless
Three.js exposes a reliable capture counter.

### Decision rule

An optimization advances only when:

1. the expected counter or phase moves in the intended direction;
2. the result repeats across alternating runs;
3. p95, p99, and hitch rate do not regress materially;
4. visual and gameplay acceptance passes; and
5. the improvement is larger than the observed run-to-run spread.

No fixed FPS target is defined here because target hardware and product frame
budget have not been specified. Before final delivery, establish target adapter
classes and frame budgets for dry, shoreline, open-water, and underwater
scenarios.

## Delivery plan

Each phase should be an independent pull request or a series of small commits
that can be toggled and measured separately.

### Phase 0 — Measurement and attribution

Objective: produce trustworthy current-state evidence before changing the
shader.

Planned work:

- [ ] Add water quality and feature overrides to the performance runner.
- [ ] Add deterministic dry, shore, river, open-water, underwater, and
      water-chunk-cross routes.
- [ ] Add an actual water-draw counter.
- [ ] Record the number of frames carrying a refractive material.
- [ ] Record wet-cell counts/ratios without adding a main-thread field scan.
- [ ] Include the active quality tier and feature overrides in every report.
- [ ] Capture a current baseline matrix on the primary target adapter.
- [ ] Inspect generated WGSL or renderer diagnostics to confirm texture-sample
      counts for each material variant.
- [ ] Record visual screenshots for shoreline, river, open-water, and
      underwater comparisons.

Exit criteria:

- Every matrix row can be run without editing source/config files.
- Reports make dry/wet/refractive/projected-caustic state observable.
- At least three valid hardware runs exist for each baseline row being used to
  justify Phase 1.

### Phase 1 — Low-risk shader and post-process reductions

Objective: remove work that cannot affect the final pixel.

#### 1A. Early fragment discard

- [ ] Sample surface coverage, water coverage, and the minimum required
      shoreline-depth mask first.
- [ ] Use explicit TSL fragment flow control to discard fragments that cannot
      contribute.
- [ ] Ensure the expensive noise, optics, refraction, foam, and caustic graph is
      inside the surviving control-flow path in generated WGSL.
- [ ] Avoid replacing built-in material behavior accidentally when assigning a
      `fragmentNode`; a `colorNode` function with explicit discard may be safer
      if it preserves the current output contract.
- [ ] Test exact zero, encoded negative zero, partial coverage, shoreline fades,
      and underwater back faces.
- [ ] A/B shore and river routes, where the expected benefit is largest.

Do not assume `alphaTest` provides equivalent early execution. Confirm generated
shader control flow.

#### 1B. Refraction depth-sample deduplication

- [ ] Clamp or otherwise bound candidate viewport UVs without adding hidden
      depth samples.
- [ ] Sample distorted depth once.
- [ ] Compare distorted depth with water depth in view-distance metres.
- [ ] Sample base depth only when intersection foam needs it.
- [ ] Select the base or distorted colour coordinate after the custom check.
- [ ] Confirm foreground grass, rocks, trees, walls, and held objects do not
      leak through water.
- [ ] Confirm behavior with ordinary and very large camera far planes.
- [ ] Inspect generated WGSL to verify the final sample count.

The custom metre-based rejection remains. This task removes overlap, not the
correctness check.

#### 1C. Projected-caustic activation gates

- [ ] Define a small transition-blend threshold below which the ordinary render
      path remains active.
- [ ] Disable projected caustics when the camera is deeper than their configured
      useful range.
- [ ] Add explicit early flow control for sky, above-surface, deep, and
      out-of-range pixels before evaluating the wave pattern.
- [ ] Keep entry/surface transitions visually smooth around every threshold.
- [ ] Measure the underwater-transition and sustained-underwater routes.

#### 1D. Non-mipped shared viewport colour experiment

- [ ] Replace `viewportOpaqueMipTexture(..., 0)` in an isolated variant with the
      non-mipped shared viewport texture.
- [ ] Preserve opaque-only capture ordering.
- [ ] Verify multiple transparent water draws do not feed previously drawn
      water back into the shared capture.
- [ ] A/B with depth capture still enabled.
- [ ] Keep the change only if it produces a repeatable benefit or materially
      lowers GPU bandwidth without visual regressions.

This experiment is deliberately last in Phase 1. Earlier evidence shows that
depth capture can dominate enough to hide the benefit of removing mip
generation.

Phase 1 exit criteria:

- Generated shader structure confirms the intended work was removed.
- Shore, river, open-water, and underwater routes pass visual acceptance.
- At least one target scenario shows a repeatable improvement above noise.
- Dry-route performance does not regress.

### Phase 2 — Quality-tier policy and material variants

Objective: make each tier a predictable performance choice.

Proposed policy for evaluation:

| Tier | Intended role | Candidate features |
|---|---|---|
| Low | Minimum GPU cost | Two-octave surface noise, no cellular detail, no refraction, no caustics |
| Medium | Default scalable water | Flow, depth optics, foam, no viewport capture, no projected caustics |
| High | Physical surface | Near refraction, intersection foam, restrained surface caustics, no projected underwater caustics |
| Ultra | Maximum effects | High plus projected underwater caustics and stronger effect budgets |

Planned work:

- [ ] Decide whether medium or high is the product default using the Phase 0
      matrix and target frame budget.
- [ ] Test removing legacy cellular colour/detail from high and ultra.
- [ ] Reuse surface/refraction noise for foam breakup or caustic modulation only
      where the visual result remains stable.
- [ ] Make projected caustics ultra-only unless high-tier measurements justify
      them.
- [ ] Formalize near/far material selection rather than adding dynamic branches
      to one shader.
- [ ] Keep feature selection build-time where it changes viewport-node presence.
- [ ] Check for visible material transitions across wide lakes and chunk
      boundaries.

Exit criteria:

- Every tier has a documented feature contract.
- Increasing a tier never silently disables a lower-tier semantic behavior.
- Frame cost changes monotonically enough to make the tiers useful.
- The chosen default meets the agreed target hardware budget.

### Phase 3 — Chunk metadata, culling, and sparse geometry

Objective: reduce submissions and rasterization after shader work is measured.

#### 3A. Water metadata

Generate metadata in the worker as part of the same pass that emits the field:

```text
waterHasCoverage
waterWetVertexCount
waterWetCellCount
waterHasFlow
waterBounds
waterMinimumSurface
waterMaximumSurface
```

Requirements:

- [ ] Define exact coverage thresholds for wet vertices and wet cells.
- [ ] Count a cell as wet when any relevant corner can contribute.
- [ ] Generate bounds from the displaced surface, not terrain geometry bounds.
- [ ] Update metadata whenever `waterFieldRevision` changes.
- [ ] Preserve correct behavior for runtime flooding and draining edits.
- [ ] Remove the upload-time coverage scan only after metadata revision tests
      prove it cannot become stale.
- [ ] Add metadata to worker transfer and page validation contracts.

#### 3B. Frustum culling

- [ ] Determine the Three.js r185 mechanism for per-slot displaced bounds
      without duplicating all shared geometry attributes.
- [ ] Use worker-generated bounds; do not decode and scan the full half-float
      field on the main thread.
- [ ] A/B wet worlds with offscreen resident chunks.
- [ ] Separate ordinary draw/fill savings from binary viewport-copy behavior.
- [ ] Revert if bound maintenance costs as much as it saves.

Prior testing found no benefit from a main-thread per-upload bound scan and
measured about 0.6 ms of added work. This phase must not repeat that approach.

#### 3C. Neutral flow texture

- [ ] Use `waterHasFlow` to avoid uploading a unique flow field when all samples
      are neutral.
- [ ] Preserve configured fallback current behavior.
- [ ] Share one immutable neutral texture across eligible slots.
- [ ] Measure upload bytes and texture residency before retaining the change.

#### 3D. Wet-cell index buffers

- [ ] Build a per-page index buffer containing only wet cells.
- [ ] Share terrain position/UV attributes rather than duplicating the full
      geometry.
- [ ] Rebuild the index on water-field revision changes.
- [ ] Preserve seam cells whose contribution crosses a chunk boundary.
- [ ] Validate rivers, narrow coasts, isolated pools, and runtime edits.
- [ ] A/B river and shore routes for raster and frame-time changes.
- [ ] Track index generation time and index upload bytes.

Exit criteria:

- Sparse geometry reduces submitted triangles or wet raster work materially in
  river/shore scenarios.
- Metadata and index maintenance do not worsen streaming hitches.
- No water cracks appear along chunk edges or after edits.

### Phase 4 — Water-field generation

Objective: reduce worker generation time only if Phase 0 attributes streaming
cost to water.

Candidate API:

```js
generator.createWaterField({
  originX,
  originZ,
  chunkSize,
  tiles,
  heights,
});
```

The exact API is not committed by this plan. It must support halos, imported
water, procedural rivers/oceans, edits, and existing generator adapters.

Planned work:

- [ ] Break down water generation into bed sampling, water semantics, halo
      resolution, field encoding, flow encoding, and temporary allocation.
- [ ] Reuse `page.heights` for in-page bed vertices where correctness permits.
- [ ] Query the generator for halo heights not present in the page.
- [ ] Reuse tiles only where their semantics exactly match canonical ocean/river
      classification.
- [ ] Avoid creating thousands of temporary `WaterSample` objects, potentially
      through a caller-provided output record or structure-of-arrays builder.
- [ ] Emit field pixels, flow pixels, and Phase 3 metadata in one pass.
- [ ] Preserve the current `sampleWater` API for gameplay/domain queries.
- [ ] Measure worker throughput, boundary backlog, memory allocation, transfer
      bytes, and main-thread commit time.

Exit criteria:

- Water generation is proven material before implementation.
- The optimized path matches reference field bytes or approved numeric
  tolerances across procedural and imported fixtures.
- Chunk-crossing hitch metrics improve without moving equivalent work onto the
  main thread.

### Phase 5 — Advanced options

These options require evidence that Phases 1–4 are insufficient:

- [ ] Replace procedural FBM with one small tileable startup-generated or
      authored noise/normal texture.
- [ ] Render projected caustics at half resolution and upscale.
- [ ] Investigate a water-specific depth/prepass only if early discard and wet
      geometry remain insufficient.
- [ ] Pack fields into texture arrays.
- [ ] Instance water chunks sharing a material variant.
- [ ] Restructure the render graph to provide a cheaper opaque colour/depth
      source.

Each option needs a separate design note because it increases architectural,
asset, or render-order complexity.

## Correctness and visual acceptance

Every phase must preserve:

- canonical water queries and body IDs;
- ocean, river, lake, and dry classifications;
- swimming, wading, submersion, current drift, and navigation;
- imported and procedural water;
- runtime flood/drain edits and field revisions;
- exact or acceptably smooth chunk seams;
- floating-origin continuity;
- water visibility from above and below;
- shoreline fade and terrain occlusion;
- foreground rejection during refraction;
- RGB absorption under different camera far planes;
- intersection and geographic foam where enabled;
- surface and projected caustic tier contracts;
- post-processing compatibility with god rays;
- deterministic worker output; and
- disposal of slot-local materials, fields, geometry, and pipelines.

Headed review positions:

1. low-angle coastline;
2. narrow river with vegetation and rocks crossing the silhouette;
3. open water filling the viewport;
4. camera immediately above and below the surface;
5. deep underwater;
6. wide lake showing near/far material transitions;
7. water across a chunk seam;
8. water during a floating-origin rebase; and
9. newly flooded and newly drained runtime edits.

## Test plan

### Unit and contract tests

- Coverage and wet-cell metadata thresholds.
- Metadata revision after flood/drain edits.
- Generated bounds include displaced minimum and maximum surface heights.
- Neutral-flow classification.
- Wet-cell indices for empty, full, single-cell, shoreline, and seam fixtures.
- Quality-tier feature contracts.
- Refraction material variants keep viewport nodes inside build-time branches.
- Explicit discard remains before procedural noise in generated source or WGSL.
- Refraction depth sample count contract.
- Projected-caustic activation thresholds.
- Water-field reference parity for bulk generation.
- Resource disposal for shared and slot-local assets.

### Integration tests

- Worker page generation and transfer with new metadata.
- Main-thread upload and revision behavior.
- Runtime edit rebuilds visibility, bounds, flow choice, and wet indices.
- God-rays and underwater render-hook compatibility.
- Performance report schema and feature override parsing.

### Commands to run during implementation

```bash
node --test \
  test/water-dry-chunk-culling.test.js \
  test/water-shader-performance-contract.test.js \
  test/water-refraction-material-contract.test.js \
  test/projected-water-caustics.test.js \
  test/water-quality.test.js

npm test
npm run build
npm run qa:water:acceptance
npm run qa:perf -- --qa chunk-cross --warmup 8 --duration 14 --speed run
npm run qa:perf:parse
```

Future scenario and feature flags should be documented here once their exact CLI
names exist. No command in this section has been run as part of creating this
plan.

## Proposed pull-request sequence

| PR | Scope | Depends on |
|---|---|---|
| Water Perf 0 | Harness matrix, scenarios, counters, current baseline evidence | None |
| Water Perf 1A | Explicit early fragment discard | Perf 0 |
| Water Perf 1B | Refraction depth-sample deduplication | Perf 0 |
| Water Perf 1C | Projected-caustic activation gates | Perf 0 |
| Water Perf 1D | Non-mipped shared viewport A/B | Perf 1B |
| Water Perf 2 | Quality-tier and material-variant policy | Perf 1 results |
| Water Perf 3A | Worker-generated water metadata | Perf 0 |
| Water Perf 3B | Bounds and frustum-culling experiment | Perf 3A |
| Water Perf 3C | Shared neutral flow texture | Perf 3A |
| Water Perf 3D | Wet-cell geometry | Perf 3A and fragment evidence |
| Water Perf 4 | Bulk field generation | Generation evidence |
| Water Perf 5 | Advanced GPU/render-graph work | Phases 1–4 insufficient |

PRs 1A, 1B, and 1C may be developed in either order after Perf 0, but their
measurements and commits must remain separable. Do not combine them into one
before/after result that cannot attribute the improvement.

## Stop conditions

Stop or defer an optimization when:

- the measured result is within ordinary run-to-run variance;
- it improves average FPS while worsening p95, p99, or hitch rate;
- it adds main-thread work to save unproven GPU work;
- it makes a quality-tier or distance transition visibly objectionable;
- it breaks water edits, seams, foreground rejection, or underwater rendering;
- it requires render-graph complexity disproportionate to the measured gain; or
- another subsystem is demonstrably the active frame bottleneck.

## Open decisions

Before declaring the plan complete, the project owner must choose:

1. Target hardware adapter classes.
2. Target frame budgets for dry, shoreline, open-water, and underwater views.
3. Whether medium or high should be the default tier.
4. Whether projected caustics are an ultra-only feature.
5. Acceptable visual transition distance between refractive and plain water.
6. Whether runtime water edits must update within the same frame or may use a
   budgeted rebuild.

These decisions do not block Phase 0 measurement.

## Recommended next action

Implement **Water Perf 0 only**: extend the deterministic harness with the
quality/feature matrix, water-specific routes, and attribution counters, then
capture an asset-complete hardware baseline. Do not begin instancing, texture
packing, wet geometry, or generator restructuring until that evidence exists.
