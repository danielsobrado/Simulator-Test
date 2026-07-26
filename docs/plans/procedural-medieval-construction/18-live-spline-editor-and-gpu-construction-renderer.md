# Live Spline Editor and GPU-Driven Construction Renderer

Status: **active implementation — first vertical slice available**

Implementation checkpoint (2026-07-26):

| Phase | State | Available now |
| --- | --- | --- |
| 1 | Complete | Versioned construction intent, transactional sparse store, reversible commands, world persistence, and chunk spatial index |
| 2 | First pass | Deterministic cubic Bézier fitting/evaluation/sampling, bounds, closest-point queries, anchor edits, and self-intersection checks |
| 3 | First pass | Build tool, drag-to-draw preview, selection, anchor dragging, deletion, undo/redo, and terrain-following semantic wall shell |
| 4 | Started | Stable segment/span module planner; junction ownership, openings, gates, and road chemistry remain |
| 5 | Started | Terrain-following shell and foundation overlap; stepped foundations, roofs, portals, collision, and navigation remain |
| 6 | Started | Revisioned worker planning with stale-result rejection and a CPU reference shell; masonry compilation, LOD 0–2, chunk residency, and upload budgeting remain |
| 7–11 | Not started | GPU arenas, compute culling, indirect commands, HZB, optional backend bridge, and far representations |

The current runtime deliberately stays on the CPU reference shell. Do not call it
the GPU-driven renderer until the Phase 7–9 evidence gates have passed.

## 1. Outcome

Build two connected capabilities:

1. a Tiny-Glade-style live editor for continuous curved walls and closed building
   outlines; and
2. a GPU-driven WebGPU renderer for the derived construction chunks.

The editor ships first against a CPU-managed reference renderer. The GPU path
must consume the same compiled chunk contract and remain optional until it beats
the reference path by more than measured run-to-run variance.

This extends the existing construction plans. It does not replace the bounded
procedural-object workshop or turn generated stones into saved entities.

## 2. Product boundary

### First complete vertical slice

- Draw, finish, cancel, select, and delete an open curved wall.
- Edit anchors and tangent handles without rebuilding unaffected segments.
- Close a curve into a building perimeter.
- Snap endpoints and curve segments into corners and T-junctions.
- Add, move, resize, duplicate, and delete doors, windows, arches, and gates.
- Regenerate real openings and surrounding masonry from semantic opening intent.
- Create terrain-following or stepped foundations.
- Save, reload, undo, redo, and survive floating-origin rebases.
- Compile near masonry, coarse masonry, and semantic-shell LODs in workers.
- Stream derived render chunks by camera residency.
- Render through the current CPU-managed path and the feature-flagged GPU path.

### Follow-up chemistry

- A road or path crossing a wall proposes or creates an arch/gate feature.
- Closed footprints synthesize floors and straight-skeleton roofs.
- Connected outlines resolve shared walls and roof groups.
- Tower sockets, retaining walls, bridges, damage, and wall-top navigation reuse
  the same construction graph.

### Non-goals

- Runtime Boolean/CSG over final triangle meshes.
- Per-stone scene objects, colliders, or save records.
- GPU-authoritative construction state.
- GPU masonry generation before worker compilation is measured as the bottleneck.
- Wave Function Collapse as structural authority.
- A mandatory custom renderer fork before the public Three.js path is measured.

## 3. Architectural invariants

1. **Intent is authoritative.** Curves, features, styles, dimensions, and gameplay
   state are saved. Samples, modules, stones, meshes, draw commands, collision,
   and navigation are derived.
2. **Curves are explicitly versioned.** Existing polyline records remain valid.
   Curves use a separate path type and generator version.
3. **Topology precedes detail.** Intersections, junctions, openings, foundations,
   roofs, and structural modules resolve before masonry.
4. **Local edits stay local.** A changed curve segment invalidates itself, its
   neighboring handshakes, and intersecting features—not the whole construction.
5. **Preview never waits for masonry.** Pointer movement updates a shell and
   semantic openings only.
6. **Workers produce plain data.** Worker output is typed arrays and serializable
   metadata; Three.js objects remain on the main thread.
7. **Simulation stays semantic.** Collision and navigation use structural modules
   and portals, never render stones.
8. **No GPU readbacks in the frame loop.** Counters used for diagnostics may be
   sampled asynchronously outside normal play.
9. **CPU fallback remains supported.** WebGL fallback, unsupported WebGPU
   features, and GPU-path failures use the reference chunk renderer.

## 4. End-to-end data flow

```text
pointer gesture
  -> canonical curve edit command
  -> ConstructionStore revision
  -> dirty segment/range calculation
  -> immediate semantic shell
  -> terrain samples
  -> worker structural plan
  -> worker masonry and typed-array compilation
  -> main-thread upload queue
  -> CPU chunk renderer or GPU geometry arena
  -> collision/navigation products
```

The same compiled construction chunk feeds both renderers:

```js
{
  constructionId,
  constructionRevision,
  chunkId,
  pathRange: [startDistance, endDistance],
  canonicalBounds,
  lods: {
    near: MaterialGeometrySet,
    coarse: MaterialGeometrySet,
    shell: MaterialGeometrySet,
  },
  pickVolumes,
  collisionProducts,
  navigationProducts,
  hashes,
}
```

## 5. Authoritative curve model

Add a new `path.type: "cubicBezier"` alongside `"polyline"`.

```yaml
path:
  version: 2
  type: cubicBezier
  closed: false
  anchors:
    - id: anchor_a
      position: [1032.5, -884.25]
    - id: anchor_b
      position: [1040.0, -878.0]
  segments:
    - id: segment_a
      startAnchorId: anchor_a
      endAnchorId: anchor_b
      startHandle: [2.5, 0.0]
      endHandle: [-1.5, -1.0]
  features:
    - id: opening_a
      kind: arch
      segmentId: segment_a
      arcFraction: 0.58
```

Rules:

- Anchor positions are canonical world X/Z coordinates.
- Handles are offsets from their owning anchors, not world positions.
- Segment IDs are explicit and stable.
- Feature positions use `segmentId + arcFraction`; unrelated segment edits cannot
  move them.
- Normal wall height follows terrain authority. Explicit height overrides remain
  separate semantic features.
- Closed paths must contain at least two curve segments and pass deterministic
  self-intersection validation.
- Canonical serialization sorts IDs and normalizes `-0`, rotations, and finite
  numeric values.

### Curve sampling

Use deterministic adaptive subdivision with:

- a generator-versioned chord-error tolerance;
- a generator-versioned maximum sample spacing;
- a hard subdivision-depth and sample-count guard;
- stable traversal order;
- an arc-length lookup table per segment;
- analytic tangent and normal evaluation from the cubic derivative.

Sampling density is derived, never saved. Structural module boundaries use
semantic events and arc distance, not incidental sample indices.

### Gesture fitting

Ship interaction in this order:

1. click-to-click anchors with drag-created handles;
2. smooth/corner/symmetric handle modes;
3. press-drag freehand capture;
4. deterministic point simplification and cubic fitting on commit.

Freehand input points are temporary. Only the fitted anchors and handles enter
the construction command.

## 6. Editor behavior

### Tool states

- Draw curve
- Draw closed footprint
- Edit anchors
- Edit handles
- Add opening/feature
- Select semantic span
- Delete construction

### Live preview

During pointer movement:

- evaluate the active cubic only;
- draw a ribbon/shell for width and height;
- display foundation and self-intersection warnings;
- show snap candidates and proposed junction ownership;
- show reserved opening intervals;
- do no masonry generation and no worker round trip.

The existing target remains under 1 ms CPU p95 for pointer preview.

### Commit behavior

A completed gesture emits one reversible command. The command returns:

- changed anchor and segment IDs;
- dirty arc ranges;
- affected intersections and junctions;
- canonical dirty bounds;
- old and new spatial-index coverage.

The previous valid shell remains visible until the new detailed chunks replace
it atomically.

### Architectural chemistry

Intersections are semantic events, not mesh Booleans:

- endpoint to endpoint: continuation or corner;
- endpoint to curve: T-junction;
- curve to curve: cross-junction or invalid overlap;
- road/path crossing wall: arch/gate proposal;
- closed wall: building footprint and roof request;
- feature moved across a junction: rehost or reject with visible feedback.

An accepted crossing owns an explicit feature record. The structural planner
reserves the void before field masonry, so the result is deterministic and
supports collision/navigation portals.

## 7. Structural and geometry pipeline

Create `src/editor/construction/` with these boundaries:

```text
domain/
  ConstructionSchema.js
  ConstructionStore.js
  ConstructionCommands.js
  ConstructionSpatialIndex.js
curve/
  CubicBezierPath.js
  CurveSampling.js
  CurveIntersections.js
editor/
  ConstructionTool.js
  ConstructionPreview.js
  ConstructionHandles.js
planning/
  ConstructionPlanner.js
  StructuralGrammar.js
  JunctionSolver.js
  OpeningPlanner.js
  FoundationSolver.js
compile/
  ConstructionCompilerClient.js
  constructionCompiler.worker.js
  ConstructionGeometryCompiler.js
render/
  ConstructionView.js
  ConstructionCpuChunkRenderer.js
  ConstructionGpuRenderer.js
  ConstructionGeometryArena.js
  ConstructionGpuCulling.js
  ConstructionHzb.js
simulation/
  ConstructionCollisionCompiler.js
  ConstructionNavigationCompiler.js
```

Refactor reusable workshop algorithms into Three.js-independent kernels:

- deterministic random forks;
- constrained course packing and forbidden-joint handshakes;
- opening profiles and voussoir layout;
- surface-relief metadata;
- footprint union and straight-skeleton adapter;
- material-family classification;
- LOD envelope validation.

Keep workshop-specific recipes and UI in `src/editor/workshop/`. Both systems may
call the shared kernels, but a live construction must not be baked into an
ordinary `ObjectMap` placement.

## 8. Scheduling, streaming, and persistence

### Worker scheduler

Adapt the existing revision/cancellation and priority-queue patterns:

- one request key per `(constructionId, revision, chunkId, lod)`;
- selected/visible chunks first;
- stale-revision cancellation;
- transferable typed-array output;
- queue byte limits and backpressure;
- fixed main-thread upload count and time budget per frame.

### Dirty-range rules

Expand the edited range only to include:

- both adjacent curve-segment handshakes;
- intersecting junction ownership;
- neighboring foundation steps;
- top-rhythm interval;
- overlapping feature clearance;
- affected render-chunk boundaries.

Unaffected chunk hashes and GPU allocations must remain unchanged.

### World integration

- Add sparse `constructions` records to `WorldDocument`.
- Rebuild the chunk-to-construction spatial index on load.
- Store one logical construction even when it touches many world chunks.
- Resolve render positions through `FloatingOrigin`.
- Keep the bounded workshop `proceduralAssets` collection unchanged.

## 9. Reference renderer first

Before GPU batching, implement `ConstructionCpuChunkRenderer`:

- one bounded merged geometry per material family and render chunk;
- shared `MeshStandardNodeMaterial`/TSL materials by style;
- projected-size LOD 0–2 with hysteresis;
- dithered transitions;
- coarse pick meshes and semantic selection;
- per-LOD shadow policy;
- explicit lifecycle and memory counters.

This path establishes correctness, provides the fallback, and supplies the A/B
baseline for GPU work.

## 10. GPU construction renderer

### 10.1 Unit of culling

Cull render chunks or semantic modules, never individual stones. Stones remain
merged into coherent chunk geometry.

### 10.2 Geometry arenas

Maintain paged arenas per vertex layout/material family:

- large position/normal/colour/UV vertex buffers;
- large index buffers;
- free-list allocations keyed by chunk revision and LOD;
- bounded page size and page count;
- deferred release after the last submitted frame;
- no in-place overwrite of an allocation still referenced by a draw.

Compaction is an off-frame rebuild into a second arena followed by an atomic
swap. Normal editing uses free-list reuse, not whole-arena compaction.

### 10.3 GPU records

Storage buffers contain:

```text
ChunkRecord
  canonical/render-relative bounds
  construction and chunk IDs
  revision
  flags: selected, edited, castsShadow
  draw-source range for each LOD/material
  previous LOD

DrawSource
  indexCount
  firstIndex
  baseVertex
  material/LOD bucket

VisibleRecord
  chunk index
  chosen LOD
  fade state

IndirectCommand
  indexCount
  instanceCount
  firstIndex
  baseVertex
  firstInstance
```

### 10.4 Compute passes

1. Reset per-bucket counters.
2. Frustum-test chunk bounds.
3. Select LOD from projected size with hysteresis; pin edited/selected chunks.
4. Optionally test conservative bounds against the previous-frame HZB.
5. Append visible records and indirect commands by material/LOD bucket.
6. Render near/coarse/shell buckets with shared node materials.

New or edited chunks bypass occlusion for at least two frames. Camera cuts,
floating-origin rebases, and invalid HZB history disable occlusion for the frame.

### 10.5 HZB

HZB is a separate measured phase:

- render terrain and large opaque construction shells into a depth prepass;
- build a mip pyramid with compute reduction;
- test projected conservative bounds against the previous valid pyramid;
- use a depth/size bias to avoid false occlusion;
- never occlusion-cull selected editor content;
- expose rejected/visible counts without synchronous readback.

Do not ship HZB merely because it works. It must improve the fortress and dense
town scenarios beyond variance without introducing visible popping.

### 10.6 Three.js r185 constraint

`BufferGeometry.setIndirect()` supports one or an array of indirect offsets, but
the current WebGPU backend loops and submits one `drawIndexedIndirect` command
for every offset. `BatchedMesh` likewise loops its draw list.

Therefore the public-API target is:

- one Three.js render object/pipeline per material/LOD arena page;
- GPU-authored visibility, LOD, and indirect arguments;
- bounded indirect command capacity;
- no per-frame CPU visibility walk and no GPU readback.

Do not promise one native draw call per material under this backend.

If command encoding is still a measured CPU bottleneck after GPU culling, evaluate
a small version-pinned render-bundle/backend bridge. That bridge must:

- live behind a feature flag;
- preserve the CPU/public-API fallback;
- have a narrow adapter and explicit Three.js-version tests;
- be justified by an A/B showing submission cost above variance.

## 11. Far representation

Ship LOD 0–2 before either option below:

- **LOD 3 construction proxy:** skyline ribbons and major gate/tower silhouettes,
  optionally baked to an impostor atlas.
- **Analytical brick bevel:** six-triangle or similarly reduced brick proxy with
  a shading-only chamfered-box intersection in TSL.

The analytical bevel is accepted only if LOD 1 vertex cost remains a measured
bottleneck. It must not change the outer silhouette or open mortar gaps.

## 12. Performance instrumentation

Add counters for:

- construction records and resident chunks;
- dirty arc length and unchanged-chunk reuse;
- planner, masonry, worker, upload, and main-thread commit milliseconds;
- worker queue depth, bytes, cancellations, and stale drops;
- CPU/GPU geometry bytes and arena fragmentation;
- visible/frustum-rejected/HZB-rejected chunks;
- chunks per LOD and transitions;
- indirect commands per material/page;
- draw calls, triangles, shadow triangles, and depth-prepass cost;
- CPU visibility/submission time;
- preview CPU p50/p95/max.

Use the real headed WebGPU harness. Run each candidate at least twice in the same
session and compare against a same-session reference-renderer A/B.

## 13. QA scenarios

Functional:

1. Draw and edit a 30 m S-curve wall.
2. Close a curved footprint and generate one coherent roof.
3. Snap a wall into a curved T-junction.
4. Cross a wall with a road/path and accept an arch.
5. Move an opening around a curve and across the radial seam.
6. Edit one anchor and prove unaffected chunk/module hashes are unchanged.
7. Cross terrain and render-chunk boundaries.
8. Rebase the floating origin while editing.
9. Save, reload, undo, and redo every edit type.
10. Cancel an invalid self-intersecting edit without changing authority.

Performance:

- one 20 m curved wall;
- one 200 m wall;
- closed castle perimeter;
- dense town at 64, 256, and a stress-count determined by hardware;
- rapid anchor-drag stress;
- camera fly-through with LOD crossings;
- HZB-heavy occluded fortress;
- worst-case open view where HZB rejects little;
- residency load/unload oscillation.

## 14. Delivery phases and pull requests

### Phase 0 — ADRs and evidence baseline

- Record the curve-authority and GPU-renderer decisions.
- Add construction QA scenario stubs and counters.
- Capture the current object-town and streaming baselines.

Gate: no runtime behavior changes; baseline artifacts are reproducible.

### Phase 1 — Domain, commands, and persistence

- Construction schema/store/spatial index.
- Polyline and cubic Bézier path versions.
- Immutable commands, revisioning, save/load, undo/redo.

Gate: exact round trip, floating-origin invariance, and no generated data in saves.

### Phase 2 — Curve kernel

- Cubic evaluation, derivative, arc-length lookup, deterministic subdivision.
- Intersections, bounds, closest-point queries, feature anchoring.

Gate: property-style deterministic tests and bounded malformed-input behavior.

### Phase 3 — Live editor and semantic shell

- Draw/edit handles, snapping, lightweight preview, selection, validation.
- Headed browser QA for pointer workflows.

Gate: preview under 1 ms CPU p95 and no command per pointer move.

### Phase 4 — Structural grammar and chemistry

- Curved spans, corners, T/cross junction ownership, openings, gates, top rhythm.
- Road/path crossing proposal.

Gate: shell-only output is structurally correct; local edits preserve unrelated IDs.

### Phase 5 — Terrain, foundations, roofs, and simulation products

- Curve terrain profile, stepped foundation solver, semantic portals.
- Closed-footprint polygonization and straight-skeleton roof integration.
- Coarse collision/navigation output.

Gate: no gaps at slopes, junctions, openings, or chunk boundaries.

### Phase 6 — Worker masonry and CPU reference renderer

- Extract reusable workshop kernels.
- Worker compilation, dirty-range scheduling, LOD 0–2, upload budgeting.
- CPU-managed chunk renderer and complete fallback.

Gate: deterministic hashes, bounded queues, no full-wall rebuild, headed visual QA.

### Phase 7 — GPU arena prototype

- Pack one material family and one LOD into an arena behind a feature flag.
- Match reference bounds, materials, picking, disposal, and floating-origin behavior.

Gate: exact structural parity and no memory growth across edit/rebuild loops.

### Phase 8 — GPU frustum, LOD, and indirect commands

- Storage records, compute selection, indirect buffers, per-material render objects.
- Selected-object pinning, transitions, counters, and CPU fallback on failure.

Gate: improvement above variance in a CPU-culling/submission-bound scene; no readback.

### Phase 9 — HZB occlusion

- Depth prepass, pyramid, conservative temporal occlusion, invalidation rules.

Gate: measurable fortress/town win, no camera-cut or edit popping, acceptable
worst-case open-view overhead.

### Phase 10 — Submission bridge, only if justified

- Profile indirect-command encoding under Three.js.
- Add a render-bundle/backend adapter only if it is the remaining measured bottleneck.

Gate: adapter A/B exceeds variance and version-pinned fallback tests pass.

### Phase 11 — Optional far techniques

- LOD 3 construction proxy and/or analytical shader bevel.

Gate: each feature independently pays for its memory, bake, and shader complexity.

## 15. Definition of done

The live editor is done when a user can draw, edit, connect, save, reload, and
undo curved constructions while previews remain immediate and unrelated spans
remain stable.

The GPU renderer is done when:

- the same compiled chunks can switch between CPU and GPU paths;
- visibility, LOD selection, and indirect arguments are GPU-generated;
- there are no synchronous readbacks;
- allocations, queues, and residency are bounded;
- edited content cannot display stale geometry;
- CPU fallback remains correct;
- headed real-WebGPU A/B results exceed run variance in the intended scenes;
- functional, visual, deterministic, streaming, and performance gates all pass.
