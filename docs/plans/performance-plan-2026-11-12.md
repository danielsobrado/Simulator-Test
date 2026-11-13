# Critical-path performance plan — 2026-11-12

Follows [performance-plan-2026-11-10.md](performance-plan-2026-11-10.md), whose
outcome is recorded in [perf-qa.md](../perf-qa.md) ("Performance work order
outcome"). Same rules: no reduced densities, distances, texture sizes, shadow
or shader effects; no `viewport*Texture` nodes; no scene lights. One commit per
phase on `main`; a phase that misses its gate is reverted, not tuned.

The critical path is the frame callback in `src/main.js` (`setAnimationLoop`,
line 1622): terrain commit → scenery preparation → player → streaming →
`stylizedSurface.update` → ambience → `drawPreparation.flushBudgeted` →
`terrainView.render`.

## 0. Revision — 2026-11-13, after phases 0 and 1

Phase 0 landed (`5d2798c2`); phase 1 was rejected and reverted
([record](../performance-phase0-1-2026-11-12.md)). The
[phase 0 baseline](../perf-qa.md#critical-path-baseline--2026-11-12-phase-0)
replaces §2. Three things in this plan change because of it.

### 0.1 Phase 1's gate was wrong; re-land preparation alone

**1b retest, 2026-11-13: not promoted.** The exact preparation-only source
was restored and passed 4326 tests. Six accepted hardware captures already
contain corrected-gate failures: grassland B2 reaches 12.2 ms capture / 25.1 ms
callback, and forest B1 reaches 9.3 / 22.1 ms. The second forest pair and
candidate water check remain incomplete after four forest baselines lost
native focus, including two retries after foreground readiness was confirmed.
Runtime edits were reverted; the clean
preparation-only patch is retained. See [fresh retest evidence](../performance-phase1b-2026-11-13.md).

The p95 ≤ 4 ms gate in §4 was this plan's mistake. Preparing the capture
context can only remove *first-use* cost; it was never going to move the
steady cost of a capture, which is what p95 measures. Preparation alone did
what it was for and was thrown away on that number:

| Grassland | Baseline | Preparation only |
| --- | --- | --- |
| Worst capture | 18.2 ms | 5.4 ms |
| Longest capture callback | 28.0 ms | 14.3 ms |
| Capture avg / p95 | 3.97 / 5.85 ms | 3.30 / 4.60 ms |
| Render CPU avg | 5.02 ms | 4.88 ms |

That is one ordered trial, not an A/B. **Phase 1b:** re-apply the
preparation-only patch kept in `tmp/perf-phase1-2026-11-12/`, and run the
A/B/A/B on grassland and forest. New gate, in every change-arm run: worst
capture ≤ 6 ms; no capture callback over 16.7 ms (callback cost, not dt —
phase 0 showed dt hides it); capture p95 and render CPU avg not higher than
the baseline arm's mean; water acceptance passes. Deferral and omission stay
rejected: deferral made the worst callback worse, and omission removed a
visible near-bank reflection.

### 0.2 Phase 2 is narrower than §5 guessed

Phase 0 attributed all 28 town and construction spikes, and **none creates a
resource**: no pipelines, buffers, bind groups or render objects. Three of
§5's four rows are therefore dead. The excess is draw submission, 10–17 ms
against a normal 4–5 ms, arriving in runs of consecutive frames (town 53–58
and 839–848; construction 21–33 and 441–461). Two different things are in
there:

1. **Buffer uploads inside draws (construction).** One `meadow-grass-blades`
   draw took 40.4 ms on its own. A rough slice of the phase 0 profile (spike
   renders against normal ones — crude segmentation, direction only) puts
   `writeBuffer` at about +3.4 ms per spike render there. Uploads do not move
   the *average* frame (§2 finding 5) but a large one landing in a single draw
   is a spike. Fix: no meadow publication may upload more than the sliced
   initial-upload path in `StreamedDrawPreparation` allows per frame (the
   `meadowInitialGpuUploadMaxFrameBytes` counter records its peak; whether
   publications and repacks go through that path is the first thing to
   check). §9
   item 1 removes the cause; this bounds it meanwhile.
2. **The same draws costing several times more (town).** In the same rough
   slice every per-draw function grows together, with no upload or creation
   behind it, plus 1.2–1.5 ms of garbage collection per spike render that
   normal renders do not have. That pattern fits either many objects taking a
   full refresh at once or the same work running slower; the counters cannot
   tell which. **Before any fix,** add two per-frame counters under perf QA:
   draws by refresh type (`FULL` / `SHARED` / `NONE` from `needsRefresh`) and
   draws per callback. If `FULL` jumps in the spike runs, find what bumps
   those objects (a shared uniform, a material version, a matrix) and stop it.
   If it does not, take an allocation profile of the town route and remove
   the per-frame garbage it names.

Phase 2's gate in §5 stands, measured against the phase 0 baseline:
frames over 16.7 ms are 2.8% forest, 2.1% town, 1.9% grassland, 7.1%
construction.

**Counters added, 2026-11-13.** Perf QA now records `renderDraws`,
`renderRefreshFull`, `renderRefreshShared` and `renderRefreshNone` per frame,
and `parse-perf-qa.mjs` prints them on each spike row beside the run's
medians. A first live look (forest pose in the dev Browser pane, scenery not
yet settled — not a timed run) already answers the question: **all 392 draws
sampled took a full refresh**, 386 of them because three's
`NodeMaterialObserver.containsNode` returns true for any material that has a
node-valued property, which every material in this renderer does. The refresh
type therefore never varies, so a jump in `FULL` cannot be what the spike runs
are. That leaves "the same full refreshes running slower" plus the extra
garbage collection: the next step is the allocation profile of the town
route, and `renderDraws` on the spike rows of the next timed run to confirm
the draw count itself is flat. It also explains the steady cost: three's cheap
`SHARED`/`NONE` paths are unreachable here, which is why binding and node
updates are about 28% of main-thread time. Making static draws eligible for
them is a possible later phase, not something to try inside phase 2.

### 0.3 Two cascades are closed

The valid-focus repeat measured 8.98 ms render CPU against the 5.67 ms
ceiling. The earlier rejection was right; §2 finding 7's doubt about it is
withdrawn. The finding itself (contention moves CPU phase time) stands.

### 0.4 Order from here

1b (preparation, corrected gate) → 2 (upload bound, then the refresh
counters) → 3 → 4 → 6 item 1 → 5 → the rest of 6. Phase 6 item 1 moves ahead
of phase 5 because it now removes a measured spike, not just upload volume.

## 1. Evidence, and what it is not

**No new measurement was taken for this plan.** Another session was running a
grass-shadow A/B on this machine, so a census/profile run started here was
stopped after about 90 seconds (it may have overlapped that session's
`grassland-b1` run — re-run that one if it looks off). Everything below is read
from reports already on disk:

| Source | Runtime | Used for |
| --- | --- | --- |
| `tmp/grass-shadow-perf-2026-11-12/grassland-a1-retry1.json` | `6f297b70` (current density, crown shadows on) | grassland frame, reflection captures, meadow uploads |
| [coherence-capture-handoff-2026-11-12.md](../coherence-capture-handoff-2026-11-12.md) | `34b8e9d8` | forest and town, focus-valid |
| `tmp/perf-matrix/*.json` (2026-11-11) | before the density raise | spike attribution on six workloads |
| `tmp/p5-forest-b2.cpuprofile` (2026-11-10) | after phase 5 of the last plan | function-level CPU shares |

The profile predates the understory scans, the density raise and crown shadows,
so its percentages are a guide to *where to look*, not gates.

## 2. Where the frame stands — measured phase 0 baseline

The fresh 2026-11-12 baseline supersedes the reports used to write this plan.
Headed NVIDIA WebGPU, 1280 × 720, native focus held, `--settle` and
`--cpu-profile`, unchanged visual settings. Full counters, probe tables,
commands, source identity and limitations are in
[perf-qa.md](../perf-qa.md#critical-path-baseline--2026-11-12-phase-0).

| Route | Frames / avg FPS | Render avg / p50 / p95 / max ms | GPU avg ms | dt p95 / max ms | Frames >16.667 ms | Attributed render spikes |
| --- | --- | --- | --- | --- | --- | --- |
| forest | 1129 / 94.19 | 6.883 / 6.500 / 9.900 / 60.200 | 3.665 | 14.4 / 68.8 | 32 (2.834%) | 19/20 |
| town | 1108 / 92.46 | 6.725 / 6.600 / 7.600 / 20.600 | 4.416 | 13.965 / 35.9 | 23 (2.076%) | 11/11 |
| grassland | 1352 / 112.76 | 5.024 / 4.800 / 6.645 / 23.900 | 3.166 | 12.645 / 35.8 | 26 (1.923%) | 9/9 |
| construction | 896 / 74.85 | 6.942 / 6.700 / 9.125 / 48.900 | 3.243 | 20.125 / 76.8 | 64 (7.143%) | 17/17 |


Town's 11/11 and construction's 17/17 render spikes have cause counters. No
resources are created in those spikes: draw submission dominates, including
a 40.4 ms meadow-blade submission in construction. This names a stage for
phase 2; it does not establish GC as the root cause.

Grassland captures average 3.967 ms, p95 5.850 ms, worst 18.2 ms. The worst
capture's frame creates 151 render objects, 353 buffers, 309 bind groups and one
pipeline, and shares a frame with a staged first draw. Its callback is 28 ms.
The valid-focus two-cascade repeat fails both old ceilings (8.984 ms render
CPU / 4.255 ms GPU); production stays at one.

## 3. Phase 0 — make the spikes explain themselves

**Completed.** Attribution 100% on town and construction, all six probes valid,
all 4320 tests pass; QA-off runtime has no added hooks. See the measured
[phase 0 record](../perf-qa.md#critical-path-baseline--2026-11-12-phase-0).

Nothing else in this plan can be gated honestly until this lands.

**Change.**

1. In `src/editor/performance/` add per-frame `PerfCounters` for what a first
   draw costs, by wrapping the renderer once at startup under the existing
   perf-QA flag only: render objects created, render pipelines created, GPU
   buffers created (count and bytes), bind groups created, and the render
   target name of any extra scene render (reflection face, planar, shadow).
   They reach the report through `countersDelta` like every other counter.
2. `scripts/probe-render-census.mjs` and `scripts/probe-render-uniforms.mjs`
   take the same lock as `run-perf-qa.mjs` (`acquirePerfRunLock`), so a probe
   can no longer run under someone else's A/B.
3. `scripts/parse-perf-qa.mjs` prints a spike table: every frame whose render
   time exceeds the run's render p50 + 5 ms, with those counters.
4. Re-run, with the machine otherwise idle and native focus held: forest,
   town, grassland and construction ring, each with `--cpu-profile`; plus the
   census and uniform probes at forest, grassland and town. Record the tables
   in `perf-qa.md`. This replaces §2 as the baseline.
5. Repeat the two-cascade trial once under those conditions. If forest render
   CPU is within the last plan's ceiling it was a false rejection: record it
   and hand it to the look owners; change no setting here.

**Gate.** At least 80% of render spikes on town and construction ring carry a
non-zero cause counter. `npm test` passes. No runtime behaviour change with
perf QA off.

## 4. Phase 1 — reflection captures never share a frame with other spikes

**Rejected and reverted after measurement.** Preparation alone reaches
5.4 ms worst capture but misses p95 (4.6 ms >4 ms). Bounded deferral and
ground-detail/flower omission also miss timing gates; omission does not
preserve the river image pair. All phase 1 code was restored to phase 0.
Retained water acceptance passes. See [trial results and captures](../performance-phase0-1-2026-11-12.md).

**Why.** Finding 3. A capture is a second scene render in its own render
context, so its first use of each material pays pipeline and bind-group
creation inside a normal frame, and every later one pays a full set of
per-draw updates.

**Files.** `src/render/reflections/WaterReflectionController.js`,
`ReflectionCaptureSchedule.js`, `src/render/preparation/StreamedDrawPreparation.js`.

**Change, in this order, stopping when the gate holds.**

1. Prepare capture-context pipelines through the same staged path first draws
   use, so a capture never compiles in the frame that renders it.
2. Defer a due capture by one frame when the frame already ran a staged first
   draw or a terrain commit. The capture interval and resolution stay as
   configured; a capture is late by at most one stride, never dropped.
3. Read the census for the capture passes. Anything drawn into a capture that
   cannot appear in it at 256 px (per-prototype ground detail, flowers) is a
   candidate to leave out — only with a reflections-on capture pair showing no
   visible difference at the river-bank pose from the last plan.

**Gate.** Grassland: worst capture ≤ 6 ms, capture p95 ≤ 4 ms, and no capture
frame over 16.7 ms. Reflection captures at coast noon and the river-bank pose
match the baseline. `qa:water:acceptance` passes.

## 5. Phase 2 — fix what phase 0 names

Written after phase 0, because finding 4 is a gap, not a diagnosis. The likely
shapes and their fixes, so the implementer does not start from nothing:

| If the spike frames show | Fix |
| --- | --- |
| Pipelines or bind groups created | The mesh skipped `StreamedDrawPreparation` (LOD swap, construction LOD transition, settlement tier publication). Route it through the staged path. |
| Buffers created, large bytes | Allocate through the existing sliced initial upload instead of on first draw. |
| A shadow or auxiliary pass first seeing a mesh | Stage the shadow-context draw with the main-context one. |
| Nothing created | GC or a long draw list rebuild: take the allocation profile at that route and remove the per-frame garbage it names. |

**Gate.** Frames over 16.7 ms: town ≤ 1%, construction ring ≤ 1.5%, grassland
≤ 1%, forest ≤ 0.5%; no frame over 33.3 ms on forest, town or grassland. All
at unchanged average render CPU and GPU time.

## 6. Phase 3 — stop paying for the clock

**Why.** 4.1% of main-thread time is `performance.now()` itself, called once
per candidate by the yield checks.

**Files.** `src/editor/performance/FrameSlack.js`,
`src/editor/stylized/StylizedBuildQueue.js`, and the `shouldYield` call sites
in `StableScatterManifest.js`.

**Change.** Inner loops consult the clock every 16th iteration, not every one.
Outer, per-job checks stay as they are.

**Gate.** `now` self time ≤ 1% in a forest profile. Scenery CPU p95 and max
not higher than baseline (a coarser check must not overrun the budget).
Manifest fixtures in `test/stable-scatter-manifest-resume.test.js` unchanged.

## 7. Phase 4 — cheaper scatter candidates, then a worker if still needed

**Why.** Scatter manifests are the largest non-render cost (18%) and the whole
of the 2.6 ms avg / 5.0 ms p95 scenery cost while moving. It is budgeted, so
the gain is scenery ready sooner and more slack for phases 1–2, not a shorter
median frame.

**4a.** The hot lookups per candidate are `PreparedPlacementStore.get` (1.8%),
`RegionalCharacterField.nodeAt` (1.6%), `PreparedSampleTable.get` (1.3%) and
`BiomePrototypeSelector.selectPrototype` (0.8%). Candidates in one chunk hit
the same few cells: resolve the store entry and field node once per chunk or
cell and pass them down. Output must be identical.

**4b, only if 4a misses its gate.** Run ground-detail, bush and rock manifests
in the worker lane the meadow already uses; inputs are the prepared placement
arrays, which are already transferable.

**Gate (4a).** `StableScatterManifest.step` inclusive time down by at least a
quarter in a forest profile; `placementPreparedLatencyMs` and scenery recovery
not worse; recorded manifest literals unchanged.

## 8. Phase 5 — steady-state submission

Small, independent items; each is its own commit and its own A/B.

1. **Static subtrees skip the matrix walk.** `updateMatrixWorld` is 1.7% self.
   Terrain slots, settlement tiers, construction shells and instanced scatter
   meshes move only on a floating-origin rebase: set `matrixWorldAutoUpdate =
   false` on their roots and update explicitly in `shiftWorldForOrigin`.
2. **Re-census the understory.** The last census (72 ground-detail draws)
   predates 27 scans. If draws grew, parts that share a material and atlas
   merge into one geometry per prototype; parts that do not are left alone.
3. **One flower mesh** instead of one per terrain slot (14 draws for 10 k
   triangles), now that the last plan's larger items are done.

**Gate.** Each item: render CPU avg not higher than the baseline arm's mean in
both runs, forest and town; item 2 and 3 also lower the census draw count.

## 9. Phase 6 — selection stays on the GPU, nothing read back

**Why.** The frame is CPU-bound with about 13 ms of GPU headroom at 720p, so
work that only decides *what to draw* belongs on the GPU. The runtime already
reads nothing back: the only `mapAsync` is the diagnostics path of
`src/render/occlusion/GpuOcclusion.js`, and the only pixel readbacks are the
impostor baker and the town-kit atlas build. That stays a rule: **no runtime
decision may wait on a readback.** `GpuOcclusion` is the pattern to copy — a
compute pass writes indirect draw arguments, the main pass draws through them.

**Candidates, in order.** Each is its own commit and A/B.

1. **Meadow band selection.** Today a tile's rows are compacted and repacked
   in a worker and re-uploaded when its band or visibility changes: 262 MB of
   uploads per 12 s on the grassland route, 86 MB of it repacking, plus
   `MeadowBandBatch` publication on the main thread. Instead, upload each
   tile's full row page once, and let a compute pass per band write the
   visible-instance index list and the indirect instance count from the
   camera, band distances and the tile's fade state. Band changes then cost no
   upload at all. Same blades, same bands, same fades.
2. **Scatter view culling.** The instanced tree, bush, rock and ground-detail
   views compare and repack instance rows on the CPU
   (`stylizedInstanceRowsCompared`, the "view-cull repacks" `FrameSlack` was
   written for). Keep every resident row on the GPU and cull per instance in
   compute, as `GpuTreeImpostorBatch` already does for impostors; retire the
   CPU path for the main view and for reflection captures
   (`treeImpostorAuxiliary*`).
3. **`detailVisibility`** (Hi-Z occlusion, off in
   `config/render-enhancements.yaml`). With phase 0's baseline, A/B it at the
   forest and town poses: it removes draws the player cannot see, which is
   free quality-wise. Turn it on only if render CPU falls in both runs.

**What stays on the CPU, deliberately.** Scatter *placement* (manifests):
collision, gameplay and the editor need those positions, so generating them on
the GPU would force exactly the readback this phase forbids. Phase 4 covers it.

**Gate.** Item 1: `meadowRepackBytes` zero and `meadowAttributeBytesUploaded`
down by at least half on the grassland route; grass coverage and recovery
gates pass; blade and card captures at grassland and high-grass poses match
the baseline; GPU time within +0.3 ms. Item 2: `stylizedInstanceRowsCompared`
zero while moving; scenery CPU p95 lower; reflections show the same trees.
All items: render CPU avg not higher than the baseline arm's mean, and no
`mapAsync` or `readRenderTargetPixels` call reachable with diagnostics off
(add a test that greps the runtime modules for them).

## 10. Not in this plan

- **Updating the sun shadow map less often.** It would save about 5% CPU and
  crown shadows sway with the wind, so a held map is a visible quality change.
- **Render bundles (`BundleGroup`) for town interiors and shells.** Plausible,
  but a recorded bundle gives up per-mesh frustum culling and three r187's
  refresh rules need reading against this renderer first. Revisit if town
  render CPU is still the limit after phase 2.
- **Bilinear slot reads, packed terrain uniforms.** Tried or ruled out on
  2026-11-10.
- Any change to densities, distances, resolutions, cascades or post effects.

## 11. Expected result

| | Now | After phases 0–3 | Basis |
| --- | --- | --- | --- |
| Frames over 16.7 ms, worst route | 2.8–4.3% | ≤ 1–1.5% | phase 2 gate; depends on what phase 0 finds |
| Worst reflection capture | 21 ms | ≤ 6 ms | phase 1 gate |
| Main-thread time in `now()` | 4.1% | ≤ 1% | phase 3 gate |
| Median render CPU | 5.4–6.0 ms | unchanged to −0.3 ms | phase 5 only |

These are targets, not measurements. Phase 0's tables replace them.
