# Performance investigation — 2026-07-29

Scope: movement critical paths, streaming boundaries, dense trees and grass,
water approach/submersion, and dense wall constructions. All authoritative runs
used headed Chromium, Three.js WebGPU, and the NVIDIA Lovelace adapter at
1280×720. Azgaar terrain IDs and persisted biome data were not changed.

## Executive result

The original diagonal boundary run averaged 135.4 FPS with p50/p95/p99
6.5/10.1/23.5 ms and a 322.8 ms maximum. Two of the largest apparent CPU costs
were the QA harness measuring itself. Removing those costs raised the same run
to 166.0 FPS and reduced p50/p99 to 4.9/15.6 ms.

Production changes then moved cold rock manifests and reusable GPU resources out
of a single boundary frame, staged water refraction material residency, and
batched whole-forest LOD writes. The best comparable diagonal run after those
changes reached:

| Metric | Initial | After |
|---|---:|---:|
| Average FPS | 135.4 | 166.2 |
| dt p50 | 6.5 ms | 5.5 ms |
| dt p95 | 10.1 ms | 7.9 ms |
| dt p99 | 23.5 ms | 22.9 ms |
| Maximum dt | 322.8 ms | 129.4 ms |
| Tree LOD rebuilds / 14 s | ~3,064 | 165 |
| Instance attribute uploads / 14 s | 118.1 MB | 21.8 MB |

The remaining maximum is not steady-state load: it is a short cluster when a
new terrain ring completes, cold water-refraction bindings become resident, and
one rock manifest can still exceed its nominal time budget. Steady p95 remains
below 13 ms in every density/wall matrix case.

## Incoming-main regression hardening

A review of the 24-commit spell repair series plus the final terrain-crossing
change found three contract gaps. They are fixed and covered by behavioral
tests:

1. Spell `compileAsync()` was started without returning an awaitable readiness
   boundary. Startup now awaits a dedicated spell precompiler, and its test
   holds hidden spell objects visible until a deferred compilation promise
   settles. This keeps first-cast pipeline work under the loading overlay.
2. `cube` was accepted by Earth spell configuration but rejected at terrain
   commit. Finite and infinite heightfields now support square footprints using
   Chebyshev brush distance; the existing spherical brush remains the default.
3. Invalid spell leaf values selected schema minima or white instead of the
   generated YAML defaults. Numeric and colour readers now validate the override,
   then the generated fallback, before using a last-resort constant.

The focused spell gate now contains 29 tests. The complete suite passed all
1,651 tests, and the Vite production build succeeded.

## Authoritative post-review matrix

The matrix runner now validates workload activation as well as process success.
It records the effective density knobs, requires WebGPU-only counters, checks
collision readiness, requires resident wall geometry, and applies portable
33.3 ms p95 / 2% hitch-rate ceilings. It also uses an exclusive PID lock after
an overlapping headed run demonstrated that two concurrent GPU tests can
produce plausible but invalid regressions.

Isolated NVIDIA Lovelace results at 1280×720, 8 s warmup + 8 s measurement:

| Case | Effective load | Avg FPS | p95 | p99 | Max | Hitch rate |
|---|---|---:|---:|---:|---:|---:|
| Standard | 12 trees/chunk, 576 grass blades/cell | 170.91 | 7.5 ms | 10.2 ms | 100.5 ms | 0.15% |
| Dense forest | 24 trees/chunk, 2× candidate/acceptance budgets | 136.71 | 8.9 ms | 10.4 ms | 42.9 ms | 0.09% |
| High grass | 1,152 grass blades/cell | 97.86 | 12.7 ms | 18.2 ms | 148.8 ms | 0.13% |
| Dense mixed | Both 2× envelopes | 114.51 | 11.9 ms | 28.3 ms | 89.9 ms | 0.33% |
| Construction corridor | 96 modules, 551 stones | 161.82 | 7.9 ms | 15.8 ms | 152.2 ms | 0.46% |
| Water acceptance | 8.36 m max immersion | — | 6.3 ms | — | — | 0.10% |

Every case reported `rendererWebGPUBackend=1`,
`rendererWebGLBackend=0`; water reached submerged and returned dry, with a
3.3 ms maximum projected-caustics CPU cost. The matrix verdict was `passed:
true` with no failures. Isolated maxima remain cold-streaming events, so release
decisions should still repeat the matrix as described under Remaining work.

## Findings and changes

### 1. The QA overlay was an O(n log n) per-frame workload

`PerfQaHarness.endFrame()` called `FrameProfiler.summarize()` every frame.
Summarization copied and sorted the complete retained frame history. A sampled
CPU profile attributed about 1.24 s to this function during one run.

`FrameProfiler` now tracks measured frame count and duration incrementally and
exposes `getLiveAverageFps()`. Full sorting happens only when producing a report.

### 2. Collision status rebuilt a canonical signature every frame

The live QA overlay called the full collision `getStatus()`. That path computed
the canonical collision-world signature; profiling attributed about 1.16 s to
`CollisionWorldMetrics.write`.

`CollisionRuntime.getLiveStatus()` now returns only residency/readiness/failure
state for per-frame display. Full signatures and provider/world diagnostics are
still generated for the final report.

### 3. A “budgeted” rock rebuild contained an unbudgeted residency ring

The rock build queue limited whole rebuild jobs, but one job synchronously built
every missing chunk manifest. A focus shift could therefore evaluate a cold
ring plus the 3×3 rock-blocker halo needed by one tree manifest in a single
frame.

Rock manifests now have a cache-only lookup and a one-cold-manifest-per-frame
preparation path. Tree manifest jobs remain queued until their complete,
deterministic rock blocker halo is ready. Placement order, blocker signatures,
and generated results remain unchanged.

One manifest can still take roughly 15–56 ms on a cold procedural field. The
ring burst is gone, but making an individual stable-scatter manifest resumable
is the next step if the maximum-dt gate must reach zero.

### 4. Tree LOD buffers were rewritten on nearly every rendered frame

While manifest data arrived, each manifest or quantized fade change scheduled a
whole tree LOD rebuild. One 14 s run performed more than 3,000 rebuilds.

Tree LOD application is now rate-limited to a 33 ms minimum interval while work
is pending, with an immediate final update when the queue drains. A comparable
run dropped to 165 rebuilds and reduced instance attribute writes from 118.1 MB
to 21.8 MB. Placement data continues to build at the existing deterministic
rate; only GPU buffer publication is batched.

### 5. Reusable terrain/grass texture creation landed on movement frames

Grass slots released resources after a short inactive period. Pool slots first
claimed at a boundary then created geometry, material bindings, and textures
while moving.

All fixed terrain, water-field, and grass influence textures are initialized
during the existing boot prewarm. Grass slot resources are pinned for reuse for
the lifetime of the view. This increases fixed residency modestly but removes
release/reallocate churn from traversal.

### 6. Water refraction has a binary and a per-slot cold cost

The first refractive material activates Three.js viewport color/depth resources.
Each newly used slot also creates bindings the first time its refractive variant
is submitted.

Boot now performs one controlled refractive render under the loading overlay.
Unused pool slots are warmed there when identifiable; additional wet slots are
staged one at a time while still outside the near-refraction radius. Warming
every water slot was tested and rejected: maximum dt fell to about 105 ms, but
renderer texture residency rose from roughly 627 to 1,575.

Water residency counters were also corrected from lifetime accumulators to
per-frame gauges. `waterChunksWet`, `waterChunksDry`, and
`waterChunksRefractive` now mean what their documentation says.

### 7. The water QA driver was not actually authoritative

The old route finder used one small fixed search window and could fail to find a
deep route. When it did find a route, browser keyboard events competed with the
in-app harness key injector, so dive/exit phases could be overwritten.

Route discovery now expands through deterministic bounded profiles with cached
samples. `water-acceptance` reserves movement for the external phase driver,
which writes through `window.__perfQa.setKeys()`. Entry stops at the discovered
deep target rather than relying only on elapsed time.

The final hardware run passed all gates:

- dry → wading/swimming → submerged → surfaced → dry
- maximum immersion 8.35 m; underwater blend reached 1
- projected caustics active; maximum recorded CPU cost 3.1 ms
- dt p95 6.4 ms; hitch rate 0.1%

### 8. WebGPU was first, but automatic tree baking weakened the no-readback contract

The world renderer already imports `three/webgpu`, requests the
`high-performance` adapter, uses TSL materials, and keeps voxel generation and
tree culling in storage buffers with indirect draws. Water viewport sampling is
a GPU-to-GPU color/depth copy, not a GPU-to-CPU readback.

The exception was the development tree-atlas fallback. With `runtimeBake: true`,
a missing or stale manifest could automatically invoke
`TreeImpostorBaker.readRenderTargetPixelsAsync()` for albedo and normal atlases.
This was asynchronous and outside the frame loop, but it still weakened the
normal-runtime contract and could add a large startup disturbance.

Normal configuration now sets `runtimeBake: false`; missing atlases retain the
low-poly proxy representation. The explicit `?bakeImpostors=1` asset workflow
still overrides that setting and owns the only two allowed readbacks. A recursive
source-contract test scans every editor JavaScript module and fails if any other
readback API appears. Renderer initialization also records the selected backend
in performance counters and warns when an unexpected WebGL fallback is selected.

A headed NVIDIA Lovelace verification after regenerating the policy-independent
v3 atlas signature reported `rendererWebGPUBackend=1`,
`rendererWebGLBackend=0`, 296 GPU-culling impostors, zero proxy fallbacks, and
7.7 ms p95 over the short diagonal audit.

## Density and construction matrix

Command:

```bash
npm run qa:perf:matrix -- --headed --warmup 8 --duration 8
```

The density envelopes are deliberately stressful. Standard grass is already
576 blades per cell; `high-grass` and `dense-mixed` raise it to 1,152. Forest
profiles double `trees.perChunk` and both habitat candidate/acceptance budgets.

| Case | Avg FPS | p95 | p99 | Max | Hitches |
|---|---:|---:|---:|---:|---:|
| Standard diagonal | 181.77 | 8.5 ms | 14.0 ms | 75.4 ms | 4 |
| Dense forest (2×) | 149.89 | 7.9 ms | 9.0 ms | 212.8 ms | 2 |
| High grass (2×) | 94.92 | 12.9 ms | 14.4 ms | 221.9 ms | 2 |
| Dense mixed (2× + 2×) | 89.79 | 12.9 ms | 35.5 ms | 204.0 ms | 8 |
| Construction corridor | 136.86 | 8.5 ms | 19.8 ms | 294.9 ms | 10 |
| Water acceptance | — | 6.4 ms | — | — | 0.1% rate |

The construction case rendered 96 resident construction modules and 551 stones,
with 24 active construction colliders. Its 294.9 ms maximum coincided with a
terrain/water/rock streaming cluster, not construction compilation:
construction changed only one LOD transition on that frame while the stylized
phase built a 55.9 ms rock manifest and the renderer initialized water bindings.
Steady wall-corridor p95 was 8.5 ms.

High grass is raster-bound by design: effective blades reached about 1.95
million and the last measured grass chunk represented about 9.74 million
triangles. It still held p95 below 13 ms on this adapter, but it halves headroom
relative to standard. Treat the 2× profile as a stress ceiling, not a default
biome recommendation.

## Harness additions

- `npm run qa:perf -- --cpu-profile <path>` writes a Chrome `.cpuprofile`.
- Polling tolerates the brief `window.__perfQa` gap caused by page/Vite reloads.
- `npm run qa:perf:parse -- <report>` now honors the explicit report path.
- `npm run qa:perf:matrix` covers standard, three vegetation envelopes,
  construction walls, and water acceptance.
- `--water-only` refreshes the water result while preserving existing matrix
  cases.
- The matrix writes `tmp/perf-matrix-latest.json`; individual cases live under
  `tmp/perf-matrix/`.

## Rejected or inconclusive experiments

- Distance-affine terrain slot pairing did not reduce grass allocations in the
  measured boundary and was reverted.
- Grass allocation itself was only about 5 ms total for five slots; the adjacent
  renderer texture work, not JavaScript allocation, was the large cost.
- Warming every refractive water slot reduced maximum dt but multiplied texture
  residency and was rejected.
- One-chunk-ahead rock prefetch showed no builds because the wider tree blocker
  window had already populated those manifests; it was removed.

## Remaining work

1. Make one stable-scatter rock manifest resumable below the candidate/cluster
   loop so a single cold chunk cannot exceed the frame budget.
2. Share or pool refractive water material bindings across terrain slots. This
   requires careful integration with the currently edited water material and
   should be validated visually above and below the surface.
3. Add adapter-specific budget baselines rather than one absolute FPS gate;
   retain p95/p99/max and hitch-rate gates as the portable signals.
4. Repeat matrix cases at least three times for release decisions. GPU process
   scheduling and asset-cache state still produce isolated maximum-dt variance.
