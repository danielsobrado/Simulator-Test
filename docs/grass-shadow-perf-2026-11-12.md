# Grass and shadow performance — 2026-11-12

Current target: `11484f90a352f4b2728514ddf9910c7d84c1f800`.
Morning control: `6f297b707501239013b5764c2ae5b219e56cb94a`.
Both are immutable snapshots served by `scripts/serve-world-visual-snapshot.mjs`
on ports 5187 and 5186 respectively. This is a cumulative comparison of the
changes since the morning capture handoff, including the new mixed grass
shapes, rainforest carpet and coverage, porous crown shadows, shadow strength
0.7, biome plant ramps and the accompanying HUD/coast changes. It does not
isolate individual commits. The morning baseline already includes the
`91298f26` near-band density and understory budget increases.

Raw reports, screenshots, logs, frozen source manifests and the exact commands
are in [`tmp/grass-shadow-perf-2026-11-12/`](../tmp/grass-shadow-perf-2026-11-12/).
These artifacts are local and ignored by Git. The resumable orchestration is
[`tmp/run-grass-shadow-perf-2026-11-12.mjs`](../tmp/run-grass-shadow-perf-2026-11-12.mjs).

## Method

Headed hardware NVIDIA WebGPU, 1280 × 720 at device scale 1. All movement
captures use `--warmup 8 --duration 12 --settle --gpuTimings 1 --hitchMs 16.667
--drain-seconds 15 --grass-diagnostics`. The hitch count therefore measures
frames slower than 60 FPS, rather than the usual 33.3 ms movement threshold.

Two baseline/current pairs are requested per route. Rejected attempts remain
in the evidence directory and are excluded from the comparison. Validity
requires native Windows foreground focus throughout capture, full scene
settling, complete loaded tree atlases, exclusive WebGPU rendering, measured
frames, GPU timestamps and zero browser errors. Collision and the existing
two-second scenery/grass recovery gate are reported separately.

| Route | Scenario / start |
| --- | --- |
| Grassland | `chunk-cross`, x −1869, z −4003, yaw 142.55359°, pitch −4.58366° |
| Closed rainforest | `chunk-cross`, x 12991, z −1419, yaw −44.97719°, pitch −4.58366°; the capture fixture has canopy coverage 0.9065 |
| Forest | Documented `chunk-cross` benchmark, x 2005, z 2941 |
| Town | Documented `settlement-approach`, imported Eldara burg 18 |

The +0.25 ms render CPU / +0.20 ms GPU stage budgets are compared with the
baseline mean, retaining both individual current samples. The user's 60 FPS
limit is reported as average FPS, frame p95, maximum frame time and the count
of frames over 16.667 ms; average FPS alone cannot establish an uninterrupted
60 FPS floor. No visual setting is tuned during this check.

## Asset and test state

All **4,313 tests pass** (`tmp/grass-shadow-perf-tests-2026-11-12.log`). The
offline impostor validation still fails because
`src/editor/stylized/AuthoredFoliageMaterial.js` changed. Both snapshots use
the same committed atlases and runtime asset manifest; runtime atlas loading
is checked per capture. These timings describe the current asset state;
the planned atlas rebake remains a separate visual acceptance step.

## Results

**16 accepted hardware captures**, two alternating A/B pairs on every route.
10 other attempts/probes remain in the directory and are excluded.
The early grassland controls lost foreground focus, so that route was recaptured
as complete alternating pairs. 7 foreground-rejected attempts
and 3 valid current-build probes replaced to preserve the paired
sequence remain available in the raw evidence.

Every current sample averages above 60 FPS and has frame p95 below 16.667 ms.
The normal GPU budget is exceeded in forest and rainforest. Town sample B1's
CPU delta against its baseline mean is +0.275 ms, 0.025 ms over the normal
CPU budget, while its two-sample mean delta is +0.144 ms. No visual setting
was reverted on these results.
Town B1 also has a 98.6 ms frame outlier versus 34.8 ms in the two baseline
town samples. That needs attribution before claiming a frame-pacing pass;
the average and p95 results do not erase it.

| Route | Avg FPS, baseline → current ranges | Render CPU mean ms (delta) | GPU mean ms (delta) | Worst current frame p95 ms | CPU / GPU stage budgets |
| --- | ---: | ---: | ---: | ---: | --- |
| grassland | 108.0–122.4 → 118.7–120.7 | 4.890 → 4.734 (-0.156) | 2.857 → 2.970 (+0.113) | 12.290 | Pass / Pass |
| rainforest | 109.1–112.5 → 109.9–110.5 | 5.550 → 5.581 (+0.032) | 2.997 → 3.688 (+0.691) | 12.815 | Pass / Over |
| forest | 103.9–108.5 → 103.7–105.7 | 6.244 → 6.319 (+0.075) | 2.906 → 3.458 (+0.551) | 13.185 | Pass / Over |
| town | 97.7–99.3 → 92.0–99.5 | 6.210 → 6.354 (+0.144) | 4.158 → 4.207 (+0.048) | 15.490 | Over / Pass |

Stage budgets require **both** current samples to stay within baseline mean
+0.25 ms CPU / +0.20 ms GPU. The table's deltas use the two-sample means;
budget status still checks the individual current samples. Results over the
normal budget are recorded for visual tradeoff review, not silently accepted
under the user's exception for a significant visual gain.
CPU differences are small relative to sample spread: grassland's baseline
render CPU varies by 0.572 ms, so its −0.156 ms mean delta is not a claimed
speed improvement.

| Route | Shadow-map/depth GPU mean ms (delta) | Other render-pass GPU delta ms |
| --- | ---: | ---: |
| grassland | 0.018 → 0.017 (-0.001) | +0.114 |
| rainforest | 0.139 → 0.107 (-0.033) | +0.723 |
| forest | 0.158 → 0.135 (-0.023) | +0.574 |
| town | 0.315 → 0.327 (+0.013) | +0.036 |

This breakdown sums the harness's named ShadowMap and shadow/depth contexts per
sampled frame. It locates the pass-class cost within the cumulative change;
it is not an isolated per-commit attribution. GPU timestamps exclude CPU
submission, uploads and compute work.

| Route | Worst scenery recovery, baseline → current | Current grass/recovery gate | Current collision gate | Current frames >16.667 ms | Worst current frame |
| --- | ---: | --- | --- | ---: | ---: |
| grassland | 76.6 → 75.8 ms | Pass | Pass | 43 / 2869 | 47.7 ms |
| rainforest | 165.6 → 172.8 ms | Pass | Pass | 40 / 2642 | 35.2 ms |
| forest | 86.7 → 79.5 ms | Pass | Pass | 28 / 2512 | 36.0 ms |
| town | 89.6 → 82.8 ms | Pass | Pass | 67 / 2296 | 98.6 ms |

Average ≥60 FPS: **Pass**.
Frame p95 ≤16.667 ms: **Pass**.
Every measured current frame ≤16.667 ms: **Fail**.
The slow-frame counts above prevent an average-FPS result from being presented
as an uninterrupted 60 FPS floor. This check measures the combined current state;
it does not attribute every spike or delta to an individual grass/shadow commit.

### Accepted samples

All rows below retain native foreground focus, a settled scene, hardware WebGPU,
all 40 loaded atlases and zero browser errors. Grass/recovery and collision gates
are separate from capture validity.

| Route / sample | Avg FPS | Frame p95 / max ms | Render CPU ms | GPU ms | Frames >16.667 ms | Grass/recovery | Raw report |
| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |
| grassland A1 | 122.43 | 12.000 / 33.5 | 4.604 | 2.834 | 19 (1.29%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/grassland-a1-retry2.json) |
| grassland B1 | 118.67 | 12.290 / 34.5 | 4.779 | 2.965 | 21 (1.48%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/grassland-b1-retry1.json) |
| grassland A2 | 108.05 | 13.725 / 35.6 | 5.176 | 2.879 | 33 (2.55%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/grassland-a2-retry4.json) |
| grassland B2 | 120.65 | 12.100 / 47.7 | 4.689 | 2.975 | 22 (1.52%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/grassland-b2-retry3.json) |
| rainforest A1 | 112.53 | 12.200 / 35.3 | 5.436 | 2.989 | 28 (2.08%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/rainforest-a1.json) |
| rainforest B1 | 110.45 | 12.600 / 34.9 | 5.588 | 3.642 | 20 (1.51%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/rainforest-b1.json) |
| rainforest A2 | 109.08 | 12.600 / 36.2 | 5.663 | 3.005 | 26 (1.99%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/rainforest-a2.json) |
| rainforest B2 | 109.90 | 12.815 / 35.2 | 5.574 | 3.733 | 20 (1.52%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/rainforest-b2.json) |
| forest A1 | 103.90 | 13.275 / 34.5 | 6.373 | 2.922 | 13 (1.04%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/forest-a1.json) |
| forest B1 | 103.74 | 13.185 / 36.0 | 6.392 | 3.465 | 14 (1.13%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/forest-b1.json) |
| forest A2 | 108.47 | 12.700 / 33.5 | 6.115 | 2.891 | 13 (1.00%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/forest-a2.json) |
| forest B2 | 105.74 | 13.100 / 34.7 | 6.246 | 3.450 | 14 (1.10%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/forest-b2.json) |
| town A1 | 97.65 | 13.400 / 34.8 | 6.298 | 4.153 | 26 (2.22%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/town-a1.json) |
| town B1 | 91.99 | 15.490 / 98.6 | 6.485 | 4.208 | 44 (3.99%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/town-b1.json) |
| town A2 | 99.26 | 13.300 / 34.6 | 6.122 | 4.164 | 26 (2.18%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/town-a2.json) |
| town B2 | 99.49 | 13.100 / 35.8 | 6.223 | 4.206 | 23 (1.93%) | Pass | [JSON](../tmp/grass-shadow-perf-2026-11-12/town-b2.json) |

The complete inputs, actual commands, validity evidence and rejected attempts
are in [summary.json](../tmp/grass-shadow-perf-2026-11-12/summary.json); the compact comparison is
[comparison.json](../tmp/grass-shadow-perf-2026-11-12/comparison.json). Source hashes are checked again
after the batch. The full stress matrix, water/weather suites, an atlas rebake,
native-resolution measurements and isolated per-commit A/B tests were not run.
