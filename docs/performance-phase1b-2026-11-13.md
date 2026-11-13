# Preparation-only re-test — 2026-11-13

**Not re-landed: valid change-arm captures fail the corrected hard limits.**
The exact preparation-only runtime from the earlier trial was restored and
verified by file hashes. Deferral and reflected-detail omission were absent.
The full candidate suite passed **4326 tests**, including target/shadow state
restoration and retention of ground detail and flowers. Runtime changes were
then reverted under the plan's failed-gate rule; the clean preparation-only
patch and its tests remain in the local evidence folder.

## Measurements

Headed NVIDIA Lovelace WebGPU, 1280 × 720, native foreground focus enforced,
8 s warmup, 12 s movement, `--settle --gpuTimings 1 --cpu-profile`.
Grassland uses (−1869, −4003), yaw 142.55359°, pitch −4.58366°; forest uses
(2005, 2941). Both arms use the same configs and offline atlases. No builds,
unit tests or other GPU probes overlapped a timed capture.

Corrected gate, **every change run**: capture maximum ≤6 ms; longest capture
callback ≤16.7 ms; capture p95 and average render CPU ≤ the mean of the two
baseline runs on that route. Callback cost is the sum of measured phases,
not RAF dt. Percentiles use the harness's interpolation.

| Route / arm | Capture updates | Capture p95 / max ms | Longest capture callback ms | Render CPU avg ms | GPU avg ms |
| --- | --- | --- | --- | --- | --- |
| grassland-a1 | 27 | 6.070 / 20.100 | 28.600 | 5.246 | 3.026 |
| grassland-b1 | 27 | 4.400 / 6.000 | 14.000 | 5.143 | 3.093 |
| grassland-a2 | 27 | 6.000 / 19.000 | 28.000 | 5.296 | 3.115 |
| grassland-b2 | 27 | 4.240 / 12.200 | 25.100 | 5.151 | 3.023 |
| forest-a1 | 53 | 5.500 / 20.900 | 28.400 | 6.743 | 3.490 |
| forest-b1 | 53 | 5.400 / 9.300 | 22.100 | 6.898 | 3.512 |

grassland baseline means: capture p95 **6.035 ms**,
render CPU **5.271 ms**.

forest: the second accepted pair is incomplete; no baseline mean or
relative p95/CPU acceptance is claimed.

Grassland B1 passes the four timing criteria. **Grassland B2 does not:**
12.2 ms worst capture and 25.1 ms capture callback, even though p95 4.24 ms
and render CPU 5.151 ms are lower than the baseline means. **Forest B1 also
fails** with a 9.3 ms capture and 22.1 ms callback. These valid-focus failures
already rule out promotion; a faster mean cannot override the hard limits.

## What the failing frames show

- Grassland B2 frame 386: cube face 0 costs 10.8 ms within a 12.2 ms capture
  update and 25.1 ms callback. No render objects, pipelines or bind groups are
  created in the frame. Three GPU buffers / 1,239,040 bytes are created, and
  the sliced initial-upload counter advances 786,432 bytes. Those creation
  counters cover the whole frame, so they do not establish that the capture
  itself allocated or uploaded those buffers.
- Forest B1 frame 1103: cube face 4 costs 8.8 ms within a 9.3 ms capture
  update and 22.1 ms callback. All four resource-creation counts are zero.

This is not another rejection on the old 4 ms p95 ceiling. The corrected
maximum/callback limits fail on fresh accepted measurements. Preparation
removes much of the observed first-use cost, but these results do not prove
that it bounds every capture. The remaining stall causes are not established
by the creation counters alone; phase 2's upload/refresh diagnosis remains
separate work. No new optimization, deferral or layer omission was added.

## Validity, source identity and remaining checks

All rows above pass native focus, settled scenery, loaded-tree integrity and
zero-browser-error checks. Two attempted forest A2 runs were rejected after
Search/Explorer/Snipping Tool or another window took focus. Their unaltered
reports, profiles, screenshots and logs are preserved as
`forest-a2-focus-rejected*` and excluded from the table.

The final forest pair and candidate water acceptance are pending an
uninterrupted foreground window. No matching-visual acceptance or full stress
matrix is claimed. These missing checks cannot turn the valid failures above
into a pass.

Baseline commit: `410ff1785c3ba7673d8fb3a476f32fdc63de48b8`. Frozen manifests:

| Arm | Manifest SHA-256 |
| --- | --- |
| Baseline | `fca395c76c68270f98036d7250e10853f82eda4c6b17861440a5b39a494eba74` |
| Preparation only | `95be59119182ab7da5bb9cfdead8d170e3d57e69a7eb358a795487d74cceb597` |

The manifests differ only in `src/main.js`,
`src/render/preparation/StreamedDrawPreparation.js` and
`src/render/reflections/WaterReflectionController.js`. The preparation hash
exactly matches the earlier preparation-only trial. The shared stale-tree-atlas
limitation remains; no atlas was rebaked.

Local evidence: `tmp/perf-phase1b-2026-11-13/` contains the perf reports, profiles, screenshots,
source manifests, logs, `gates.json`, `preparation-only.patch` and the six
regression tests. The existing user-owned `.gitignore` edit is preserved.
