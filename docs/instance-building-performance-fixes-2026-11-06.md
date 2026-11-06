# Instance and building performance fixes — 2026-11-06

Implements the five findings from the static review of `a34c4848`. The user
requested static checks only, including during implementation. Regression
tests were added for a later validation pass; none were executed in this pass.
No runtime, visual-parity, frame-time or FPS result is claimed.

| Finding | Implementation | Regression cases prepared |
| --- | --- | --- |
| Building setup computes tree morphology repeatedly | Non-tree renderers skip morphology bounds. Trees prepare each unique source geometry's bounds once and reuse a prototype centre across parts. | Zero building morphology scans; one scan per tree source geometry; existing pivots. |
| Object capacity growth clones immutable geometry | All object LOD tiers use the existing shared-CPU-array helper, with independent attribute wrappers and instance buffers. | Source-array identity, independent wrappers, capacity growth and disposal. Existing WebGPU/WebGL lifetime tests still apply. |
| Cached object preparation can exceed its scheduling slice | Yield after every 16 visited objects, including cache hits. Count visits with `objectPlacementRecordsVisited`. | A late edit in 1,000 cached objects, retaining unchanged placement records and visiting at most 16 per step. |
| Local non-LOD edits multiply every instance matrix | Separate dense row stores for objects and foundations retain stable slots. Removals swap in the tail. Only dirty rows are transformed, compared and uploaded; replacement buffers receive a full publication. | Exact matrices and picking IDs, a local edit, same-size removal/addition, foundations and capacity replacement. `objectInstanceRowsTransformed` exposes transformation work. |
| Construction revisits rebuild previously generated LODs | Cache detached masonry by build identity, authored revision and terrain revision. Restore geometry through the existing budgeted publication path and assign current materials. Growth remains owned by the live module and is retained or rebuilt under its existing validity rules. | Near/coarse revisits, hidden-tier visibility, growth retention, worker bypass, cancellation, terrain and authored invalidation, owner retirement and bounded disposal. |

The changes target redundant preparation and publication work while preserving
geometry generation, materials, density, LOD thresholds, shadows and authored
semantics. Runtime parity still requires the follow-up checks below.

## Resource policy

`ConstructionLodCache` defaults to 32 MiB of detached geometry arrays and 128
products. `ConstructionView.lodCacheOptions` can configure the allowance. Taking
a product transfers ownership to its build state, then to the resident module;
cancellation releases it. The cache owns geometry, while construction records
own materials. Eviction, edits, module retirement, record unload and view
disposal release cached geometry. Cache bytes estimate retained attribute and
index arrays; they are not a driver-memory or whole-process measurement. Live
and in-flight products are outside this detached-cache allowance.

Instance bounds expand conservatively for local writes. Full publications,
large removals and accumulated writes tighten them again. This avoids visiting
all matrices for each edit while keeping newly moved instances inside bounds.

## Static validation and follow-up

ESLint, JavaScript syntax checks and Git whitespace checks are the validation
for this pass. The tests below are authored but unexecuted:

```sh
node --test test/instance-setup-locality.test.js test/instance-geometry-capacity.test.js test/object-matrix-publication.test.js test/performance-publication-locality.test.js test/object-local-lod-publication.test.js test/object-view-lifecycle.test.js
node --test tests/ConstructionLodCache.test.js tests/ConstructionViewBuildQueue.test.js tests/ConstructionView.test.js tests/ConstructionShell.test.js tests/ConstructionDraftContinuity.test.js tests/treeVisualLodRegression.test.js
```

After those checks, follow [performance QA](perf-qa.md) using frozen source
snapshots for baseline/candidate captures. Compare the full matrix, 64/256-object
towns, construction approaches and repeated near/coarse/shell visits. Check
matrix/picking agreement after local edits, removals, foundation changes,
capacity growth and origin rebases. Include construction edits, terrain edits,
growth changes, cache eviction and unload/revisit. Retain foreground-focus
evidence, full scenery readiness and the existing visual/collision gates.
