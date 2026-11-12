# Performance phases 0 and 1 — 2026-11-12

**Phase 0 landed as `5d2798c2`; phase 1 was rejected and fully reverted.**
The plan requires a failed phase to be reverted. No capture timing, resolution,
grass density, understory budget, shadow setting or reflected-detail omission
from the trials remains in production.

The [phase 0 record](perf-qa.md#critical-path-baseline--2026-11-12-phase-0)
contains the four fresh route profiles, all town/construction spike rows, six
census/uniform probes and the valid-focus two-cascade repeat. Town and
construction attribution is 11/11 and 17/17; all 4320 retained tests pass.
The two-cascade repeat fails both old ceilings, so one cascade remains.

## Phase 1 measurements

Same grassland route, current visual settings, headed NVIDIA Lovelace WebGPU
at 1280 × 720, 8 s warmup, 12 s motion, settled scenery/collision, native
foreground focus held, zero browser errors, `--cpu-profile --gpuTimings 1`.
Each capture uses a frozen runtime, the same offline atlases and the exclusive
perf lock. These are ordered rejection trials, not an accepted A/B/A/B.

Gate: capture maximum ≤6 ms, capture p95 ≤4 ms, no capture callback or recorded
frame interval >16.667 ms, unchanged reflections, and water acceptance.
Percentiles use the harness's interpolation, rather than nearest rank.

| Trial | Captures | Capture avg / p95 / max ms | Longest capture callback ms | Render CPU avg ms | GPU avg ms | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Retained phase 0 | 27 | 3.967 / 5.850 / 18.200 | 28.000 | 5.024 | 3.166 | Baseline |
| Prepare capture context | 27 | 3.300 / 4.600 / 5.400 | 14.300 | 4.880 | 3.147 | p95 fails |
| Preparation + bounded deferral | 27 | 3.648 / 5.780 / 7.200 | 19.000 | 5.103 | 3.145 | p95 and frame gate fail |
| Preparation + deferral + omission | 27 | 2.681 / 5.040 / 6.000 | 25.400 | 5.082 | 3.154 | p95 and frame gate fail |

1. **Preparation alone removes the observed first-capture stall, but misses
   p95 by 0.6 ms.** Capture resources were prepared through the existing staged
   draw path before publication. The empty pass reused Three r187's attachment
   layout/camera-type context, disabled clearing and background drawing, froze
   shadow updates, and restored renderer/scene state even on failure. The
   pinned cache contract and perspective/orthographic restoration were tested.
   This run's worst capture fell 18.2 → 5.4 ms; it is not a repeated acceptance
   result and no portion was promoted.
2. **Bounded deferral does not pass.** The trial tracked actual terrain commits
   and staged draws, retained a pending face across unavailable reservations,
   and forced it by one stride. It recorded 7 deferred frames, 2 forced turns
   and maximum delay 4 frames. All 27 captures remained. A capture callback
   reached 19 ms; the deadline can force work into an already busy frame.
3. **Omission does not rescue the gate.** Only ground-detail roots and flower
   meshes were hidden during auxiliary captures, with main-view visibility
   restored. All 27 captures remained; mean capture cost fell to 2.681 ms, but
   p95 was 5.040 ms and callbacks reached 25.4 ms. It also fails visual review
   below. A smaller preparation-plus-omission combination was considered, then
   abandoned when the image pair exposed the visible difference; it has no
   fourth measurement.

The baseline capture at frame 415 has a 28 ms callback but only 7.5 ms recorded
dt: dt describes the interval *before* that callback. Checking dt alone would
wrongly accept the stall. The trial tables therefore include callback cost
(the sum of measured phases), along with the original frame intervals. The
following RAF interval is retained in `gates.json` as additional evidence.

## Reflection images: omission rejected

Both pairs use noon lighting, the same camera and a fixed water time of 123.4 s
at 1600 × 900. Coast uses the previous plan's coast pose; river uses its low
bank at (−6524373.395575998, −1768732.198768486), yaw −0.7548266756385945,
pitch −0.08, 1.7 m above ground. Assets and scenery are ready, hardware WebGPU
is active, cube reflections are valid in both arms and errors are zero.
Planar reflection is valid at the coast; the river uses its cube path.

The river baseline has a visible blue-green near-bank plant/reflection around
x≈650, y≈700 that is absent in the omission image. This does not establish
unchanged reflected detail and rules out treating all ground cover as invisible
at capture resolution. Cloud/wind phases also differ, so the pair is not a
pixel-identical proof. The omission is **rejected**, not called a free quality
win. Full PNGs, source manifests and diagnostics are kept in the local artifact
folders; the JPEGs below are local review previews under the intentionally
ignored `docs/qa/` directory. The handover ZIP carries them with this report.

| Pose | Retained baseline | Rejected omission |
| --- | --- | --- |
| Coast noon | [baseline](qa/perf-phase1-2026-11-12/baseline-coast.jpg) | [omission](qa/perf-phase1-2026-11-12/omission-coast.jpg) |
| River bank | [baseline](qa/perf-phase1-2026-11-12/baseline-river.jpg) | [omission](qa/perf-phase1-2026-11-12/omission-river.jpg) |

## Source identity and validation

| Runtime | Frozen manifest SHA-256 |
| --- | --- |
| Phase 0 | `75173a7592a2f357aa932df70c63842e3cb89a36f9c6a34153d19c7a61b7656b` |
| Preparation | `95be59119182ab7da5bb9cfdead8d170e3d57e69a7eb358a795487d74cceb597` |
| Deferral | `a01d812b83e3a81873283ae846cfa2894477aa43845b2fb4e43cbab4336b5cc1` |
| Omission | `634ca52067cfed5597a8d36c0a42cedc9aaabf217c125c2d7ba74622fd2f44dc` |

Phase 0's working-file hashes were verified against the retained commit. Its
manifest base is `6abc7f8e` plus the recorded diagnostic overrides. The three
phase 1 snapshots are based on `5d2798c2` plus their recorded trial overrides.
The shared stale-tree-atlas limitation remains; none were rebaked.

- Preparation-only full suite: **4325 passed**. Deferral full suite: **4327
  passed**. Final omission change: **10 focused tests passed**. These tests and
  all phase 1 production changes were removed with the rejected phase.
- Retained runtime: identical source/config/scripts/tests to phase 0; **4320
  tests passed** before its commit. No duplicate full-suite run was needed
  after restoring those exact bytes.
- Retained `qa:water:acceptance --headed`: **all gates pass**, native focus
  passes, NVIDIA hardware WebGPU, high quality, zero browser/GPU validation
  errors, frame p95 **7.9 ms**. Report:
  `tmp/perf-phase1-2026-11-12/water-retained.json`. This is not a claim that a rejected phase 1
  trial passed final acceptance.
- Phase 1 forest/town A/B/A/B and the full stress matrix were not run after the
  grassland/visual gates failed. No phase 1 acceptance or 60 FPS tail fix is
  claimed. Existing long frames remain for phase 2's diagnosis.

Local evidence: `tmp/perf-phase1-2026-11-12/` contains the three profiles, perf reports,
screenshots, frozen manifests, matched visual reports, `gates.json`, test
logs, PNG hashes, and an explicitly unretained preparation/omission patch.
No trial code is left on a side branch or in the working tree.
