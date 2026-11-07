# Settlement interior performance fixes — 2026-11-07

Implements the three review findings against `7f95b9b3` on `main`. The user
will run the tests later. This pass runs static checks only; the prepared
regression tests, browser checks and hardware comparisons remain unexecuted.

## Changes

| Finding | Implementation |
| --- | --- |
| Whole-attribute copies exceed preparation slices | `InteriorNumericBuffer` appends fixed typed-array pages without relocating previous values. Finalization copies at most one 48 KiB page per generator step and releases each source page after copying. Spatial batch capacity bounds a destination float3 allocation to less than 768 KiB. |
| Quad corners repeat vertex and baked-light work | Each tessellated quad cell emits four vertices and the same six triangle indices. Standalone triangles keep their previous winding and attributes. Indices use uint16, with at most 65,535 vertices per batch so WebGL's reserved `0xffff` index is never used. |
| Whole-town bounds keep all rooms in the draw | Rooms join their settlement-local 128 m spatial cell, then batch by material. Dense cells split at the vertex limit. Each batch has bounds from its actual emitted vertices and uses normal conservative frustum culling. |

The room planner, furniture, tessellation, baked light formula, vertex transform,
UV calculation, normals, colours, materials, flicker clock and collision remain
the existing ones. Cells select batches without clipping faces or moving vertex
positions. There are no distance cutoffs, lower-detail rooms or individual
furniture scene objects.

Installation reuses one material per role across all of a site's batches. The
existing explicit draw-preparation stage prepares the batches before publishing
the complete site. Unload and cancelled installation dispose shared materials
once and release staged geometry and preparation arrays.

Spatial batching adds draw calls while reducing vertices outside the frustum.
The 128 m cell size and capacity limit need hardware frame-pacing validation;
the review's work-count reduction is not an FPS result.

## Prepared regression checks

```sh
node --test test/interior-numeric-buffer.test.js test/settlement-interior-batches.test.js test/settlement-rendering.test.js test/staged-draw-publication.test.js test/settlement-tier-publication.test.js
```

The new tests cover bounded page copies and source-page release; exact expanded
float32 attributes against the former quad emitter; winding, rotated buildings,
negative cells and capacity splits; uint16 restart-index avoidance; conservative
culling after an origin translation; shared material identity; publication,
cancellation and disposal. The existing city-room checks now follow triangle
indices and validate every spatial batch.

The following cumulative counters are included in the existing performance
reports: `settlementInteriorBufferCopyBytes`,
`settlementInteriorBatchesGenerated`, `settlementInteriorVerticesGenerated` and
`settlementInteriorIndicesGenerated`. `settlementInteriorBufferMaxCopyBytes`
records the largest single page copy and should never exceed 49,152 bytes.
These are generation work counts, not current residency or GPU-memory figures.

## Runtime handoff

Follow [player movement performance QA](perf-qa.md) with frozen source captures
of `7f95b9b3` and this implementation. Include the full matrix and the settlement
approach with a camera-turn revisit:

```sh
npm run qa:perf -- --headed --qa settlement-approach --warmup 8 --duration 12 --settle --gpuTimings 1 --resources --revisit --turn-on-revisit --drain-seconds 15
npm run qa:perf:matrix -- --headed
```

Retain native foreground-focus evidence, successful initial/revisit settling,
collision readiness, scenery recovery, grass coverage and browser-error results.
Compare frame tails, settlement preparation, render CPU, GPU time, draw counts,
tracked resource bytes and the interior generation counters. Inspect open doors,
furnished rooms, window/daylight transitions and dusk flicker while moving and
turning across cell boundaries and origin rebases. No visual-parity, FPS or
frame-time improvement is claimed before those checks.
