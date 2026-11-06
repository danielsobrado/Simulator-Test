# Performance fixes from static review — 2026-11-06

These changes remove repeated CPU work and redundant upload requests without
changing geometry generation, visual settings, densities, distances, animation
frequency, or the configured texture upload cadence. Runtime performance and
visual parity have not been measured. The user requested static checks only;
another session will perform runtime validation.

| Area | Change | Regression coverage added for the later test pass |
| --- | --- | --- |
| Construction publication | Replace one module's statistics contribution directly. Subtract contributions on module and record retirement. Apply materials to the published module and use shell coverage established during residency reconciliation. Explicit decoration reconciliation and palette preview restoration retain their existing full-record behavior. | Local publication reads no unrelated module statistics; aggregate totals match resident modules after replacement and retirement; selected stone and dark mortar remain assigned; shells retain coverage. |
| Meadow interaction | Recovery, stamps and scrolling mark the texture dirty when they mutate pixel data. Slow-fading marks no longer request uploads merely because ink remains. Empty body stamps and empty press clears need no upload. | Slow-fade bytes and existing upload cadence; rejected airborne stamps; rebasing; complete window clears; existing final-recovery upload coverage. |
| Authored character rigs | Update ancestor transforms without traversing descendants before animation. Let foot placement propagate the post-mixer pose instead of doing that full pass twice. Rigs without foot placement retain their post-mixer propagation. | Ground samples, world matrices and footfalls compared with the former full-tree passes across movement, slopes, casts and swimming, with foot placement enabled and disabled. |
| Settlement variant queue | Sort only after insertion, queued priority changes, or worker-failure requeueing. Removal and pruning retain sorted order. | Nearest and equal-priority ordering; repeated ineligible requests; reprioritization; pruning; asynchronous worker failure. |
| Optional GPU occlusion | Retain indirect buffers while source meshes, geometries and groups remain live. A collection serial prevents inactive retained groups from supplying stale visibility. This feature remains disabled by default. | Buffer reuse while hidden; group, geometry and owner retirement; current-group selection; other-camera draws; restoration after render errors. |
| Lint | Remove the unused `If` import from `RippleField.js`. | ESLint. |

## Checks and handoff

Only ESLint, JavaScript syntax checks and Git whitespace checks are authorized in
this session. The new and existing regression tests have not been executed.
The later validation session should start with:

```powershell
node --test tests/ConstructionViewBuildQueue.test.js tests/ConstructionView.test.js tests/ConstructionShell.test.js tests/ConstructionDraftContinuity.test.js
node --test tests/meadowInteractionCadence.test.js tests/meadowGrass.test.js test/meadow-spell-marks.test.js test/meadow-interaction-press-disc.test.js
node --test test/character-glb-rig.test.js test/character-swim.test.js test/character-footsteps.test.js
node --test test/settlement-pool-queue.test.js test/settlement-rendering.test.js test/settlement-tier-publication.test.js tests/gpuOcclusion.test.js
```

Then use [the performance QA guide](perf-qa.md) for comparable frozen-source,
headed hardware WebGPU captures, retaining native foreground-focus evidence.
Compare the full matrix, construction approach, dense grass, settlement approach
and camera-turn revisit. Check collision readiness, scenery recovery and grass
coverage alongside frame timing. Exercise rig slope contact, casts, footsteps
and swimming, and compare pixels and uploads for stationary scorch marks.

The optional occlusion comparison needs a separate controlled pair with that
feature enabled in both arms. Rotate away and back repeatedly and check buffer
allocation counts, current-frame visibility and memory after mesh retirement.
The default-disabled matrix cannot establish a gain for this path.

These changes contain no accepted FPS, frame-time or visual-parity claim.
