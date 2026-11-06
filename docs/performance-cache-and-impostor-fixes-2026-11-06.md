# Terrain cache and tree impostor performance fixes — 2026-11-06

The implementation is committed as `5fc67945` on `main`.
It keeps the existing geometry, materials, density, draw distances and animation
clock. The changes remove work when the underlying data is unchanged.

## Changes and deterministic checks

- GPU tree impostors compare the float32 values sent to the GPU and mark only
  changed attribute ranges. A single fade change among 1,000 records queues 16
  bytes instead of 48,000. Appearance and fade changes keep the existing visibility
  result; position, scale, radius, count, camera and origin changes invalidate it.
- CPU tree impostors retain their visibility result until records, the view and
  projection matrices, coordinate system or origin change. Their animation clock
  still advances every frame. A stationary frame queues no attribute uploads.
  Changed records use the same partial-upload writer as the GPU path.
- Terrain material descriptors reuse the existing material revision clock.
  Unchanged frames no longer scan neighboring revision maps or rebuild keys.
  Only slots needing a request enter the priority sort. Tests cover tile, height,
  water, canopy, world reset, chunk reassignment and quality invalidation.
- Exact terrain cache hits acquire the baked page without copying source arrays
  or requiring neighboring terrain pages. Fresh builds still capture their
  immutable source before the asynchronous request and require the complete halo.

Pending tree upload ranges survive subsequent unchanged updates. Regression tests
also cover empty batches, camera movement, projection changes, floating-origin
movement, reflection-camera restoration, lease retirement and concurrent bake limits.
A separate comparison against the previous implementation matched complete float32
record buffers and CPU visibility for 160 changing frames on each tree backend,
including reordered and empty batches, fades, morphology, camera and origin changes.
After warming 49 terrain slots, 100 unchanged frames perform zero material revision
scans, compared with 4,900 before.

## Validation

The 37 focused tests passed:

```powershell
node --test test/tree-impostor-empty-batch.test.js test/terrain-material-bake-runtime.test.js test/terrain-material-bake-runtime-halo.test.js test/terrain-material-bake-cache.test.js test/terrain-material-bake-cache-lifecycle.test.js test/stylized-material-revision-tracker.test.js tests/attributeUpload.test.js
```

Repository ESLint and the production build passed. The final full suite passed
all 4,137 tests. Its first run encountered another session's temporary tree-radius
configuration mismatch; the repeat passed after that unrelated edit was cleared.
The runtime captures use frozen revisions throughout.

## Hardware comparison

Captures use the existing immutable snapshot server and the headed WebGPU
movement harness described in [the performance QA guide](perf-qa.md). The arms
freeze `875c13f0` (baseline) and `eaeee370` (the original implementation commit,
whose eight changed files are identical to `5fc67945`). Both arms
use `chunk-cross` from `(2005, 2941)`, warmup 8 s, measurement 12 s, settling,
GPU timestamps, a 15 s recovery observation and a same-browser revisit with a
180° midpoint camera turn. Reports are retained in
`tmp/performance-review-2026-11-06/`.

Both arms completed on the NVIDIA Lovelace adapter with no browser errors.
Initial and return legs settled, passed collision readiness and reached scenery
readiness after stopping. The baseline exceeded the two-second recovery target
on both legs. Both captures failed the native foreground-focus gate and their
runners exited nonzero; frame pacing remains unverified. The apparent timing
difference is excluded as performance evidence. Full matrix and pixel comparisons
remain outstanding.
