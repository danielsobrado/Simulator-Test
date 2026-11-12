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

## 2. Where the frame stands

1280×720, NVIDIA Lovelace, headed WebGPU, `--warmup 8 --duration 12 --settle`.

| Route | Render CPU avg | Scenery CPU avg / p95 | GPU avg | Frames over 16.7 ms | Worst frame |
| --- | --- | --- | --- | --- | --- |
| Forest `--x 2005 --z 2941` | 5.85 ms | — | 2.88 ms | 0.73% | 35.6 ms |
| Town `settlement-approach` | 6.04 ms | — | 4.13 ms | 2.66% | 64.5 ms |
| Grassland `--x -1869 --z -4003` | 5.38 ms | 2.62 / 5.0 ms | 2.97 ms | 2.79% | 53.5 ms |
| Construction ring (11-11) | 6.36 ms | — | — | 4.34% | 179 ms |
| Standard, dense forest, dense mixed, high grass (11-11) | 4.6–4.9 ms | — | — | 0% | < 8 ms |

Findings:

1. **The average is not the problem; the tail is.** The median frame callback
   is 6–10 ms on every route. The 60 FPS floor is broken only by spikes, and
   in 77 of the 97 over-budget frames examined the callback itself was long
   (the rest lost their time outside it: GC, compositor, focus).
2. **The spikes are in `render`.** It is the largest phase in 74 of the 77
   long callbacks. Scenery work stays inside its budget.
3. **Water reflection captures are one named cause.** On the grassland route
   26 capture frames cost 4.4 ms avg, 21.1 ms worst; render p50 is 5.1 ms
   without a capture and 8.9 ms with one. 6 of that route's 14 render spikes
   are capture frames. Routes with no water in reach have none.
4. **Most spikes are still unattributed.** On town and construction ring, 31 of
   32 render spikes carry no counter that explains them (no capture, no staged
   first draw, small uploads). The last plan guessed "first draws of newly
   streamed meshes"; nothing on disk confirms or refutes that.
5. **Upload volume does not drive render time.** Grassland uploads 262 MB of
   meadow attributes in 12 s (86 MB of it repacking), yet render time per frame
   is flat against bytes uploaded (fit: −0.4 ms per MB).
6. **Steady-state CPU, from the profile:** per-draw binding and node updates
   about 28% of main-thread time; budgeted scatter manifests 18%
   (`StableScatterManifest.step`); sun shadow pass 5.7%; **`performance.now()`
   4.1%** (yield checks in `FrameSlack` and `StylizedBuildQueue`); bloom's
   passes 3.2%; `updateMatrixWorld` 1.7% self.
7. **CPU phase times are not immune to contention.** `grassland-a1` and its
   retry are the same code and pose: 9.84 ms vs 5.38 ms render. The earlier
   rule "CPU phase time does not depend on focus" is unsafe; the two-cascade
   rejection (8.03 ms, focus lost) rested on it.

## 3. Phase 0 — make the spikes explain themselves

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

## 9. Not in this plan

- **Meadow upload volume** (262 MB per 12 s). Finding 5: it does not move the
  frame. Worth its own look for memory-bus and battery reasons, not for FPS.
- **Updating the sun shadow map less often.** It would save about 5% CPU and
  crown shadows sway with the wind, so a held map is a visible quality change.
- **Render bundles (`BundleGroup`) for town interiors and shells.** Plausible,
  but a recorded bundle gives up per-mesh frustum culling and three r187's
  refresh rules need reading against this renderer first. Revisit if town
  render CPU is still the limit after phase 2.
- **Bilinear slot reads, packed terrain uniforms.** Tried or ruled out on
  2026-11-10.
- Any change to densities, distances, resolutions, cascades or post effects.

## 10. Expected result

| | Now | After phases 0–3 | Basis |
| --- | --- | --- | --- |
| Frames over 16.7 ms, worst route | 2.8–4.3% | ≤ 1–1.5% | phase 2 gate; depends on what phase 0 finds |
| Worst reflection capture | 21 ms | ≤ 6 ms | phase 1 gate |
| Main-thread time in `now()` | 4.1% | ≤ 1% | phase 3 gate |
| Median render CPU | 5.4–6.0 ms | unchanged to −0.3 ms | phase 5 only |

These are targets, not measurements. Phase 0's tables replace them.
