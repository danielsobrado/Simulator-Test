# Performance review follow-up — 2026-11-07

Follows the supplied static review of `7f95b9b3`, implemented on top of
`d546a08c`. The user will test later. This pass runs static checks and prepares
regression tests; no new runtime or hardware performance evidence is claimed.

## Findings and scope

| Review finding | Result |
| --- | --- |
| 1. Town interior subset publications copy the full changed span | `writeSubset` records changed slots. A shared writer copies those rows and requests separate contiguous upload runs, also used by the existing split-town writer. Pending undrawn ranges retain the existing bounded coalescing policy. This path belongs to opt-in `?towns=kit`. |
| 2. Reflection captures search every scene object for shadows | The reflection controller owns a shadow-owner registry. It discovers the initial scene once, then tracks subtree additions, removals and reparenting through Three's child events. Every capture reads the current shadow object from each registered light/owner and retains exception-safe restoration. Disposal removes hierarchy listeners. |
| 3. Auxiliary CPU impostor culling may be costly | Added separate update CPU, maximum update CPU, records-tested, update-count and cache-hit counters. Selection, visibility, attribute publication and eligibility are unchanged. The review explicitly requires profiling before choosing a spatial or GPU replacement. |
| 4. Settlement roots are repositioned every frame | The complete placement pass runs after an origin change. Pool retirement advances a separate clock that triggers stale-tier cleanup. New/updated tiers retain their existing publication-time placement; idle frames traverse no tiers. |
| 5. Reflection scheduling ignores configuration | Shared-scheduler captures honor `captureFrameStride`. Reservation estimates use `initialCaptureCpuMs`, `captureSafetyFactor`, and separately learned cube-face/planar CPU costs. Default stride four, capture interval, resolution and complete-probe publication stay as before. Reservations remain soft shared-budget allowances, preserving the existing progress policy. |
| 6. Town preparation may repeat costly bounds work | Added CPU and work counters while retaining the exact per-mesh bound algorithm. CPU timing excludes time suspended at generator yields, including cancellation. This opt-in kit-town path still needs the review's requested benchmark before bounds reuse is selected. |

The existing settlement-interior batching changes in `d546a08c` remain in place.
No polygon counts, texture sizes, vegetation density, shader effects or draw
distances are reduced in this follow-up.

## Prepared tests

```sh
node --test test/towns/town-sparse-publication.test.js test/towns/town-bounds-diagnostics.test.js test/towns/town-lod.test.js test/towns/town-split-lod.test.js
node --test test/reflection-shadow-registry.test.js test/reflection-capture-schedule.test.js test/render-enhancements.test.js test/planar-reprojection.test.js test/tree-impostor-empty-batch.test.js
node --test test/settlement-selection-budget.test.js test/settlement-tier-publication.test.js test/settlement-pool-queue.test.js
```

Coverage includes distant dirty slots, exact matrices/colours, pending uploads,
empty/shrunk/regrown subsets, nested light edits, reparenting and shadow
replacement, render/restore exceptions, registry disposal, custom strides,
separate capture estimates, unchanged placement, origin changes, tier retirement,
auxiliary cache accounting and bounds timing excluding suspended work.

These tests are prepared but unexecuted. The static checks are repository
ESLint, JavaScript syntax checks and Git whitespace checks.

## Measurement handoff

All counters below enter the existing QA reports through `PerfCounters`:

| Counter | Meaning |
| --- | --- |
| `townInstanceRowsCopied` | Matrix rows copied across all affected meshes during town instance publication; colours accompany the same rows where present. |
| `settlementPlacementTiersVisited` | Tiers inspected by the full origin-placement/retirement pass. An unchanged frame should add zero. |
| `waterReflectionBudgetEstimateMs` | Estimate for the next capture type. The controller diagnostics also expose stride, budget estimate and last capture CPU. |
| `treeImpostorAuxiliaryCpuMs` / `treeImpostorAuxiliaryMaxCpuMs` | Total/largest CPU update for auxiliary impostor selection and attribute publication, excluding the following reflection render. |
| `treeImpostorAuxiliaryRecordsTested` / `treeImpostorAuxiliaryUpdates` / `treeImpostorAuxiliaryCacheHits` | Actual full-scan record work, auxiliary update count and reused-view count. Main-view updates do not contribute. |
| `townBoundsCpuMs` / `townBoundsMaxStepCpuMs` | Bounds CPU and largest preparation step, excluding suspended wall time. |
| `townBoundsInstanceRowsRead` / `townBoundsGeometryVerticesScanned` / `townBoundsMeshesPrepared` | Repeated instance and geometry work, and completed per-mesh bounds preparations. |

Follow [performance QA](perf-qa.md) with frozen baseline/candidate sources and
headed hardware WebGPU captures. Run the full matrix, settlement approach with
camera-turn revisit, dense forest near reflective water, and the water acceptance
route. The supplied review's `settlement-approach` and dense-mixed commands are
appropriate default-renderer controls. Add `towns=kit` to a separate server URL
for town publication/bounds measurements; the normal matrix does not exercise
those opt-in classes. The movement runner accepts query parameters in its URL:

```sh
npm run qa:perf -- --headed --qa settlement-approach --warmup 8 --duration 14 --settle --gpuTimings 1 --revisit --turn-on-revisit
npm run qa:perf -- --headed --qa settlement-approach --url 'http://localhost:5173/?towns=kit' --warmup 8 --duration 14 --settle --gpuTimings 1 --revisit --turn-on-revisit
```

Compare CPU costs and counters before selecting optimizations for findings 3
and 6. Keep native foreground-focus evidence, browser errors, initial/revisit
settling, collision readiness, scenery recovery and grass coverage. Inspect
reflections after light additions/removals, day/night changes, camera turns,
world edits and origin rebases. New FPS, GPU-cost and visual-parity claims remain
pending those checks.
