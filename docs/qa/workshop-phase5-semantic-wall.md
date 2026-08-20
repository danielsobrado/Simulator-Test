# Workshop Phase 5 — Semantic wall vertical slice

Phase 5 makes walls the first workshop geometry family to run from semantic identity through curve topology, deterministic planning, renderable mesh data, RPG semantics, surface coordinates, locality, and legacy projection.

## Semantic ownership

A `composition-wall` entity owns both:

- the legacy `primitive` record required by recipe-only compatibility callers;
- a versioned semantic `wall` definition whose shape is a Phase 2 `CurvePath`.

Legacy point walls are promoted to stable line segments without changing their serialized recipe. Consecutive duplicate legacy points are ignored by the semantic planner but preserved by the compatibility projection, so old records remain lossless without introducing committed zero-length curve segments.

## Pipeline

`WallPath` validates wall semantics and provides the compatibility adapter.

`WallPlanner` samples by deterministic arc length and preserves every authored segment boundary. It produces stable cross-sections through `WallJoins` and creates a `WallGeometryPlan` before triangulation.

The plan publishes:

- stable wall and path identity;
- side/top/bottom surface domains and local frames;
- endpoint sockets and deterministic endpoint joins;
- collision slabs;
- foundation contacts;
- cover surfaces;
- bounds;
- legacy battlement modifier metadata.

Straight authored segments keep one collision/foundation/cover span per authored segment. Curved segments use deterministic slices. Render tessellation therefore does not multiply straight-wall RPG products.

`WallBuilder` converts the plan into a closed renderer-neutral indexed mesh. UV coordinates are distance-based and remain stable when wall sampling density changes. `buildWallBufferGeometry` is a thin async Three.js adapter and does not participate in planning.

`WallSurfaceProjection` maps side, top and bottom points to stable segment-local coordinates and reconstructs points after compatible path edits without inspecting meshes.

## Renderer bridge

`createWorkshopCompositionParts(recipe, { wallPlans })` consumes semantic wall plans directly when a semantic composition projection is available. Line, arc and quadratic wall geometry therefore share the same `WallPlanner -> WallGeometryPlan -> WallBuilder` path at the composition-render boundary.

Recipe-only callers still use the existing point-wall adapter. This keeps persisted workshop assets and older presets compatible while semantic document callers avoid a curve -> sampled points -> geometry round trip.

`wall.set-definition` updates the semantic wall and its legacy projection atomically in one command. Direct legacy primitive edits are still detected and promoted so older editor code cannot be silently shadowed by stale semantic state.

## RPG projection

The composition projection replaces legacy wall RPG products with the products derived from each semantic wall plan while preserving the existing public `primitiveId` shape. Its revision key includes semantic wall revision keys, so semantic-only changes such as wall style cannot leave the projection revision stale.

## Battlements

`topFamily: battlements` remains present in the legacy projection, preserving the current castle-wall compatibility path. The semantic plan also emits a `legacy-battlements` modifier marker so battlement generation can migrate independently without changing authored wall semantics.

## Acceptance gates

`npm run qa:workshop:walls` verifies:

1. legacy wall recipe round trips remain exact, including redundant consecutive legacy points;
2. wall identity exists before geometry generation;
3. line, arc and quadratic walls use the same planner and builder;
4. curved walls project deterministically to the legacy renderer format when compatibility projection is required;
5. semantic wall plans render directly through the composition renderer bridge;
6. wall edits dirty only the targeted wall and required domains;
7. semantic spatial bounds include curved wall extents;
8. side/top surface-local coordinates survive compatible path edits;
9. shared endpoint joins are deterministic and cluster transitively;
10. mesh buffers are finite, closed on the bottom and produce a Three.js `BufferGeometry`;
11. wall UV scale is invariant to planning sample spacing;
12. straight-wall RPG products remain one span per authored segment;
13. semantic projection revision keys change for semantic-only wall changes;
14. battlement compatibility remains explicit.

No GitHub Actions are introduced.
