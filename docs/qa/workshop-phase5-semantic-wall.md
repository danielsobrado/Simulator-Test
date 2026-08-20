# Workshop Phase 5 — Semantic wall vertical slice

Phase 5 makes walls the first workshop geometry family to run from semantic identity through curve topology, deterministic planning, renderable mesh data, RPG semantics, surface coordinates, locality, and legacy projection.

## Semantic ownership

A `composition-wall` entity now owns both:

- the legacy `primitive` record required by the existing renderer path;
- a versioned semantic `wall` definition whose shape is a Phase 2 `CurvePath`.

Legacy point walls are converted to stable line segments without changing their recipe. Curved semantic walls remain authoritative and are sampled only when projected into the old point-based recipe.

## Pipeline

`WallPath` validates wall semantics and provides the compatibility adapter.

`WallPlanner` samples by deterministic arc length and preserves every authored segment boundary. It produces stable cross-sections through `WallJoins` and creates a `WallGeometryPlan` before any triangulation happens.

The plan publishes:

- stable wall and path identity;
- side/top material surface domains;
- endpoint sockets and deterministic endpoint joins;
- collision slabs;
- foundation contacts;
- cover surfaces;
- bounds;
- legacy battlement modifier metadata.

`WallBuilder` converts the plan into renderer-neutral indexed mesh data. `buildWallBufferGeometry` is a thin async Three.js adapter and does not participate in planning.

`WallSurfaceProjection` maps points to stable segment-local coordinates and reconstructs points after compatible path edits without inspecting meshes.

## Live compatibility

`wall.set-definition` updates the semantic wall and its legacy projection atomically in one command. This keeps Phase 4 invalidation/locality exact while the existing runtime renderer continues to consume the legacy recipe representation.

Straight legacy walls therefore remain exact. Arc and quadratic walls become available semantically now and degrade deterministically to at most 64 legacy points until the live renderer is migrated to consume the wall plan directly.

## Battlements

`topFamily: battlements` remains present in the legacy projection, so existing castle-wall behavior is preserved. The semantic plan also emits a `legacy-battlements` modifier marker so a later native wall renderer can replace the adapter without changing authored wall semantics.

## Acceptance gates

`npm run qa:workshop:walls` verifies:

1. legacy wall recipe round trips remain exact;
2. wall identity exists before geometry generation;
3. line, arc and quadratic walls use the same planner and builder;
4. curved walls project deterministically to the legacy renderer format;
5. wall edits dirty only the targeted wall and required domains;
6. semantic spatial bounds include curved wall extents;
7. surface-local coordinates survive compatible path edits;
8. shared endpoint joins are deterministic;
9. mesh buffers are finite and a Three.js BufferGeometry can be produced;
10. battlement compatibility remains explicit.

No GitHub Actions are introduced.
