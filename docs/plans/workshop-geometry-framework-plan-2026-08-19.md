# Workshop geometry framework implementation plan

Status: Reviewed / recommended implementation sequence  
Priority: Highest for future workshop geometry work  
Architecture: `docs/architecture/workshop-geometry-framework.md`  
Behavior review: `docs/research/tiny-glade-workshop-behavior-review-2026-08-19.md`  
Scope: evolve the existing workshop in place; do not build a parallel replacement editor

## Goal

Evolve the current procedural workshop into a semantic, curve-aware, dependency-driven construction framework that can reach Tiny Glade's public quality bar for gridless building chemistry and exceed it for Simulator's huge-world RPG requirements.

The finished framework should support:

- freeform/curved walls and construction paths;
- direct manipulation with stable preview and undo/redo;
- context-sensitive openings, joins, roofs, foundations and supports;
- a generalized node-based traversal tool resolving into stairs, ramps, platforms, ladders, bridges and walkways;
- individual procedural bricks/planks/tiles that fit around openings/boundaries while remaining batched for rendering;
- stable procedural detail that does not reshuffle after small edits;
- generated detail that can be pinned, detached, suppressed or reset to automatic;
- explicit style inheritance/aesthetic resolution;
- collision/navigation/rooms/portals/cover/support semantics derived from the same construction model;
- reusable workshop definitions and lightweight huge-world instances;
- local invalidation, caching and LOD suitable for a large map.

The migration must preserve working workshop behavior and saved assets. This is an ownership refactor followed by capability expansion, not a big-bang rewrite.

## Core implementation rules

1. Authored construction intent is semantic data.
2. Automatic building chemistry resolves into `ResolvedWorkshopModel`; it does not silently become authored intent.
3. Three.js/WebGPU objects are derived state.
4. Workshop definitions use local coordinates and are separate from world instances.
5. Curves/topology are first-class before adding more freeform geometry features.
6. Commands and immutable patches own edits and history.
7. Preview uses the same semantic/resolution path as commit, at a reduced detail tier where necessary.
8. Hard constraints protect data; soft/adaptive constraints preserve creative flow.
9. Generated children have provenance, deterministic keys and pin/detach/suppress controls.
10. Randomness is domain-separated and temporally coherent.
11. Reactions and dependency invalidation are local/spatially bounded.
12. Repeated visual pieces are batched/instanced rather than individual scene objects.
13. RPG semantics never depend on decorative mesh classification when semantic data exists.
14. Existing compatible code is migrated/reused before replacement.
15. No GitHub Actions; all deterministic validation/performance harnesses must run locally.

## Current code to build on

Preserve and migrate useful behavior from:

- `src/editor/workshop/ProceduralAssetStore.js`
- `src/editor/workshop/ProceduralAssetManager.js`
- `src/editor/workshop/ProceduralWorkshopComposition.js`
- `src/editor/workshop/ProceduralWorkshopComponentController.js`
- `src/editor/workshop/ProceduralWorkshopComponentParts.js`
- `src/editor/workshop/ProceduralWorkshopArchitecturalSnapping.js`
- `src/editor/workshop/ProceduralWorkshopBoundaryResize.js`
- `src/editor/workshop/ProceduralWorkshopOpeningAttachments.js`
- `src/editor/workshop/ProceduralWorkshopOpeningAssemblies.js`
- `src/editor/workshop/ProceduralStraightSkeleton.js`
- current castle-wall/medieval generators;
- current material/texture/composition/lifecycle/LOD modules.

`ProceduralWorkshopComposition.js` remains the best semantic seed. Geometry-to-component inference remains compatibility-only and should shrink as capabilities migrate.

# Milestone strategy

Do not attempt every Tiny-Glade-like effect simultaneously. Establish vertical slices that prove the architecture in increasingly difficult cases.

Recommended milestone gates:

```text
A. semantic/curve kernel proven
B. wall/opening editing proven
C. surface-detail coherence proven
D. roof chemistry proven
E. traversal/stairs chemistry proven
F. huge-world runtime derivation/performance proven
G. legacy presets fully migrated
```

Each gate requires deterministic tests and at least one visual regression fixture before moving the same responsibility out of legacy code.

# Phase 0 — Research snapshot, baselines and migration safety

## Objective

Freeze the current behavior and define the external quality target before state ownership changes.

## Work

- Keep `docs/research/tiny-glade-workshop-behavior-review-2026-08-19.md` as the public-behavior reference.
- Catalogue the current persisted workshop asset schema/version and normalized fields.
- Catalogue current component/opening/assembly IDs relied upon by saves.
- Add deterministic fixture assets covering:
  - classic wall;
  - freeform/stepped/tapered wall where supported;
  - gatehouse;
  - tower;
  - square tower;
  - manor;
  - openings/assemblies;
  - transformed components;
  - materials/surface textures;
  - composition primitives;
  - straight-skeleton roof cases;
  - LOD near/coarse/shell behavior.
- Capture current semantic outputs, bounds, triangle/batch statistics and visual reference captures.
- Record known current limitations rather than accidentally preserving bugs as requirements.
- Add a local script that runs compatibility fixtures deterministically.

## Acceptance criteria

- Existing saved workshop assets still load before/after baseline harness addition.
- Fixture normalization/serialization is deterministic.
- Geometry/RPG outputs that matter for compatibility are captured.
- Visual reference captures exist for representative presets.
- The harness runs locally without GitHub Actions.

# Phase 1 — Model layers: definition, resolved state and instance

## Objective

Create the correct ownership model before moving geometry.

## Proposed modules

```text
src/editor/workshop/model/
├── definition/
│   ├── WorkshopDefinition.js
│   ├── WorkshopSerializer.js
│   ├── WorkshopValidation.js
│   └── WorkshopMigration.js
├── resolved/
│   ├── ResolvedWorkshopModel.js
│   └── WorkshopProvenance.js
├── instance/
│   └── WorkshopInstance.js
└── ids/
    └── WorkshopIds.js

src/editor/workshop/commands/
├── WorkshopCommandBus.js
├── WorkshopPatch.js
└── handlers/
```

## Work

- Define `WorkshopDefinition` schema v1.
- Define stable authored entity ID rules.
- Define deterministic derived/reaction keys.
- Define deterministic serialization and normalized ordering.
- Add definition revision and optional entity revisions.
- Define authored overrides and reaction suppression records.
- Define `ResolvedWorkshopModel` as disposable deterministic resolution.
- Define provenance for automatic children.
- Define `WorkshopInstance` separately from the reusable definition.
- Keep all model code free of Three.js imports.
- Add compatibility projection from current normalized workshop records.
- Add schema migration/version hooks.

## Acceptance criteria

- Same legacy recipe -> byte-equivalent normalized definition.
- Same definition/config/versions/seed -> equivalent resolved-model skeleton.
- Definition code contains no renderer objects/classes.
- Instance transform/runtime state does not mutate definition data.
- Invalid authored patches cannot partially commit.

# Phase 2 — Curve, tolerance and topology kernel

## Objective

Build the geometric language needed by gridless/freeform walls, fences, paths and traversal before extending those systems.

## Proposed modules

```text
src/editor/workshop/curves/
├── CurvePath.js
├── CurveSegment.js
├── CurveProjection.js
├── CurveIntersections.js
├── CurveSampling.js
└── GeometryTolerancePolicy.js

src/editor/workshop/topology/
├── TopologyGraph.js
├── PathTopology.js
├── FootprintTopology.js
└── TopologyRemap.js
```

## Work

- Support minimum segment families required by tools: line, arc and limited Bezier support as needed.
- Use stable control-point and segment IDs.
- Implement deterministic arc-length evaluation/projection.
- Implement point/curve and curve/curve nearest/intersection operations used by snapping/reactions.
- Add central tolerance policy.
- Handle near-zero/degenerate preview curves safely.
- Define committed topology invariants.
- Implement split/merge remap output for hosted dependents.
- Add definition-local/local-surface coordinate helpers.
- Do not add general NURBS/CAD complexity without a real use case.

## Acceptance criteria

- Curves serialize deterministically without Three.js.
- Repeated projection gives stable results within the defined tolerance policy.
- Split/merge emits deterministic remap data.
- Hosted test objects survive compatible split/merge/path edits.
- Fuzzed curve edits do not produce NaN/Infinity/corrupt references.
- No workshop tool needs its own private epsilon policy for these operations.

# Phase 3 — Commands, preview transactions, history and replay

## Objective

Make every direct manipulation edit transactional before deeper geometry migration.

## Proposed modules

```text
src/editor/workshop/interaction/
├── WorkshopToolController.js
├── PreviewTransaction.js
├── SelectionController.js
└── HandleController.js

src/editor/workshop/history/
├── WorkshopHistory.js
└── WorkshopReplay.js
```

## Work

- Use `CommittedDefinition + PreviewPatch = PreviewDefinition`.
- Route drag gestures to semantic command candidates.
- Keep pointer-move noise out of history.
- Commit one logical command on pointer-up/confirm.
- Cancel by dropping preview, not inverse mesh mutation.
- Move selection helper/hit geometry ownership out of semantic/domain controllers.
- Add deterministic command replay.
- Add semantic pin/detach/suppress/reset-to-auto commands.
- Keep old component transforms behind an adapter until equivalent semantic commands exist.

## Acceptance criteria

- Drag/cancel returns exactly to committed semantic state.
- Commit/undo/redo produces exact semantic round trips.
- Replay reproduces the same definition/resolved state.
- Selection/handle rendering can change without domain changes.
- `ProceduralWorkshopComponentController.js` starts shrinking instead of becoming a new facade.

# Phase 4 — Promote composition and build dependency/spatial graphs

## Objective

Move existing semantic composition into the new model and establish locality/invalidation infrastructure.

## Work

- Map existing rectangle/circle/wall composition primitives into definition entities.
- Preserve current material regions and RPG semantics.
- Add typed relationship graph.
- Add semantic spatial index.
- Add domain-specific dirty propagation:
  - `TOPOLOGY`
  - `GEOMETRY`
  - `SURFACE_LAYOUT`
  - `STYLE`
  - `MATERIAL`
  - `COLLISION`
  - `NAVIGATION`
  - `ROOMS`
  - `PORTALS`
  - `SUPPORTS`
  - `FOUNDATION`
  - `DECORATION`
  - `LOD`
  - `BOUNDS`
  - `SPATIAL_INDEX`
- Ensure changes produce exact affected entity/domain sets.

## Acceptance criteria

- Existing composition semantics remain compatible.
- Unrelated entities do not invalidate/rebuild.
- Spatial neighborhood queries are deterministic.
- Local edits do not require whole-document reaction candidate scans.

# Phase 5 — Semantic wall vertical slice

## Objective

Use walls to prove curve -> topology -> plan -> render -> RPG derivation end to end.

## Proposed modules

```text
src/editor/workshop/geometry/wall/
├── WallPlanner.js
├── WallGeometryPlan.js
├── WallBuilder.js
├── WallJoins.js
└── WallSurfaceProjection.js
```

## Work

- Represent wall shape using semantic curve/path references.
- Store elevation/height/thickness/profile/top/style semantics.
- Plan before triangulation.
- Add deterministic corner/endpoint joins.
- Publish wall surface domains/local frames.
- Publish collision slab/cover semantics directly from plan.
- Preserve battlements/castle-wall behavior through modifiers/adapters.
- Move wall edits off arbitrary scene-group transforms.
- Keep curve-host projection stable through edits.

## Acceptance criteria

- Wall identity is known before geometry exists.
- Straight and curved walls generate through one semantic pipeline.
- Editing one wall does not inspect meshes to rediscover components.
- Shared/joined corners remain stable through edits.
- Existing wall presets remain within documented compatibility tolerances.
- Wall surface local coordinates are stable enough to host openings/details.

## Milestone A gate

At this point the architecture must prove:

- semantic ownership;
- curve editing;
- transactional preview/history;
- local dirty propagation;
- geometry planning.

Do not add a new complex workshop archetype before this gate passes.

# Phase 6 — Constraint engine, snapping and adaptive morphs

## Objective

Create a direct-manipulation solver that prefers good adaptive results over unnecessary rejection.

## Proposed modules

```text
src/editor/workshop/constraints/
├── ConstraintEngine.js
├── SnapSolver.js
├── HardInvariantProvider.js
├── TopologyConstraintProvider.js
├── ArchitecturalConstraintProvider.js
└── AdaptiveMorphProvider.js
```

## Work

- Move existing architectural snapping behind providers.
- Add curve-follow/end/segment snapping.
- Add parallel/perpendicular/collinear/coincident/center/height preferences.
- Add explicit snap-disable tool policy.
- Distinguish hard, soft and adaptive constraints.
- Return candidate solutions, scores and diagnostics for UI.
- Add adaptive behaviors such as host clamping/reprojection rather than silent deletion.
- Keep thresholds/tunables in YAML, invariants in code.

## Acceptance criteria

- Tools invoke providers instead of embedding architecture-specific snap math.
- Curve snapping follows actual path shape.
- Invalid canonical data is rejected with reason.
- Normal creative edits use adaptation/morph/fallback when possible.
- Existing opening snapping behavior is preserved or improved.

# Phase 7 — Opening system and first chemistry rules

## Objective

Make openings semantic host features and prove automatic-vs-authored provenance.

## Proposed modules

```text
src/editor/workshop/geometry/opening/
├── OpeningModel.js
├── OpeningPlanner.js
├── OpeningAssemblyResolver.js
└── OpeningMasks.js

src/editor/workshop/reactions/
├── ReactionEngine.js
├── ReactionProposal.js
├── ReactionConflictResolver.js
├── WallPathReaction.js
└── OpeningWallReaction.js
```

## Work

- Normalize doors/windows/arches/gates/trapdoors into one opening model.
- Store host-local/arc-length position.
- Reproject when host changes.
- Publish wall cut mask, collision gap, portal and decoration exclusion.
- Migrate existing opening attachments/assemblies.
- Implement reaction engine as detect -> propose -> conflict-resolve -> resolved model.
- Implement path + wall -> auto opening/portal according to tool policy.
- Implement optional low-window -> door morph where desired by design policy.
- Add pin/promote/suppress/reset-to-auto behavior for automatic openings.

## Acceptance criteria

- Host resize/curve edit retains compatible opening identity.
- Invalid openings are not silently discarded.
- Auto openings have deterministic provenance keys.
- Suppressing one auto opening does not disable the rule elsewhere.
- Pinning an auto opening makes later edits respect it as authored intent.
- Collision/portal changes derive without decorative mesh inspection.

## Milestone B gate

A complete wall + opening edit/save/load/undo flow must work without mesh inference.

# Phase 8 — Surface domains, masks and temporal-coherent detail

## Objective

Create the visual-detail foundation required for Tiny-Glade-like tactile surfaces.

## Proposed modules

```text
src/editor/workshop/surfaces/
├── SurfaceDomain.js
├── SurfaceMasks.js
├── SurfaceLayoutRegistry.js
└── layouts/
    ├── MasonryLayoutPlanner.js
    ├── PlankLayoutPlanner.js
    ├── TimberFrameLayoutPlanner.js
    └── RoofTileLayoutPlanner.js

src/editor/workshop/random/
└── WorkshopRandom.js
```

## Work

- Publish stable local 2D surface domains from walls/roofs/slabs.
- Define shared exclusion/trim masks for openings/corners/roof/traversal/interaction clearance.
- Implement domain-separated deterministic random streams.
- Define stable generated-child keys by entity/domain/local cell.
- Implement masonry layout first using current stone behavior where possible.
- Implement plank layout that clips/splits around openings/boundaries.
- Support orientation policies by surface type/curvature.
- Preserve unaffected detail through local edits.
- Keep layout output logical/batched; do not create thousands of individual scene objects.

## Acceptance criteria

- Adding/moving one opening only changes affected surface pieces.
- Unrelated wall bricks/planks retain their derivation keys/appearance.
- Changing ivy/weathering does not reroll masonry layout.
- Planks/bricks do not cross openings/semantic exclusion masks.
- Curved-surface unsupported layouts degrade to an explicit supported mode rather than bad geometry.
- Undo restores identical detail.

## Milestone C gate

A deterministic curved/straight wall with openings must retain coherent bricks/planks through edits and render in batches.

# Phase 9 — Style inheritance and aesthetic resolver

## Objective

Make automatic results look intentional rather than randomly decorated.

## Proposed modules

```text
src/editor/workshop/style/
├── StyleProfile.js
├── StyleResolver.js
├── AestheticResolver.js
└── StyleInheritance.js
```

## Work

- Define explicit architecture/material/trim/opening/support/detail style profile.
- Resolve inherited style for snapped/connected/generated entities.
- Persist only local overrides.
- Add deterministic variant scoring based on geometry/context/style/repetition avoidance.
- Ensure explicit user selections always override auto aesthetics.
- Route plaster wear, foundation style, opening trim, roof detail and clutter families through the resolver gradually.

## Acceptance criteria

- Connected/snapped construction inherits expected style.
- Local overrides do not break inheritance for unrelated properties.
- Repeated automatic details avoid obvious unnecessary repetition without nondeterministic rerolls.
- Identical state resolves to identical aesthetic choices.

# Phase 10 — Roof solver framework and roof chemistry

## Objective

Move roofs to semantic solver-driven construction.

## Proposed modules

```text
src/editor/workshop/geometry/roof/
├── RoofPlanner.js
├── RoofSolverRegistry.js
├── FlatRoofSolver.js
├── GableRoofSolver.js
├── HipRoofSolver.js
├── ConeRoofSolver.js
└── StraightSkeletonRoofSolver.js
```

## Work

- Define roof boundary/holes/elevation/pitch/family/ridge hints/overhang.
- Wrap existing straight skeleton as one solver.
- Implement current required flat/gable/hip/cone behavior.
- Make `auto` deterministic using topology/style hints.
- Publish ridge/slope/eave/valley/flat walkable sockets.
- Publish roof surface domains for tiles/materials.
- Implement wall/roof trim dependencies.
- Add roof + chimney trim/flashing reaction.
- Keep roof LOD/material behavior compatible.

## Acceptance criteria

- Footprint edits invalidate only affected roof regions/plans.
- Straight-skeleton code is not owned by unrelated controllers.
- Solver registration does not require archetype-switch growth.
- Roof detail respects openings/intersections and stable surface masks.

## Milestone D gate

Footprint/wall/opening/roof editing must remain semantic and local through save/load/undo.

# Phase 11 — Generalized traversal system

## Objective

Reach and exceed Tiny Glade's stairs behavior using one semantic traversal network.

## Proposed modules

```text
src/editor/workshop/traversal/
├── TraversalPath.js
├── TraversalResolver.js
├── TraversalHostProjection.js
├── TraversalSegmentClassifier.js
├── TraversalSupportPlanner.js
├── TraversalRailingPlanner.js
└── TraversalGeometryBuilder.js
```

## Work

- Add stable 3D traversal nodes/edges.
- Support free nodes and host-relative nodes.
- Resolve segment type from slope/context:
  - walkway;
  - platform;
  - ramp;
  - stair;
  - ladder;
  - bridge span.
- Support explicit user segment override.
- Attach to wall facades/tops, flat roofs, floors and other traversal structures.
- Implement host-following around curved walls/towers.
- Insert resolved corner platforms where required.
- Adapt railing/battlement gaps around connected traversal.
- Derive supports/grounding.
- Publish clutter/decorator sockets on walkable surfaces.
- Publish navigation edges directly.
- Keep auto corner/support children provenance-aware and suppressible/promotable.

## Acceptance criteria

- Same node tool creates stairs/platforms/ladders/walkways according to context.
- Traversal can follow curved walls without manual piece alignment.
- Wall/roof attachment survives compatible host edits.
- Corner platforms appear deterministically and can be promoted/suppressed where policy allows.
- Railings/supports update locally.
- Navigation follows resolved traversal without mesh analysis.
- Moving one node does not reshuffle unrelated traversal detail.

## Milestone E gate

Traversal must demonstrate the framework's hardest composition case: curves + host attachment + morphing + supports + railings + nav + stable detail.

# Phase 12 — Foundations, supports and terrain chemistry

## Objective

Make elevated structures adapt cleanly to terrain and supported construction.

## Proposed modules

```text
src/editor/workshop/geometry/support/
├── FoundationResolver.js
├── SupportGraph.js
├── SupportPlanner.js
└── TerrainContactPlanner.js
```

## Work

- Derive terrain contact fields for structural footprints.
- Implement plinth/foundation/column/pier/stilt/arch support families.
- Add raised structure -> support reaction.
- Include traversal and supported-by-building relationships.
- Publish support graph for later damage/destruction.
- Respect style profile and explicit user suppression/override.
- Avoid visual supports where semantic contact already provides support.

## Acceptance criteria

- Raising/lowering structure updates only relevant support/foundation regions.
- Supports are deterministic and style-consistent.
- Support semantics exist independently from decorative meshes.
- Terrain changes can invalidate foundation/support domains without rebuilding unrelated surface detail.

# Phase 13 — Decoration chemistry: ivy, moss, clutter and detachability

## Objective

Build rich context detail on top of stable surface domains/provenance.

## Work

- Generate detail anchors from semantic surfaces/openings/traversal.
- Implement ivy/moss/dirt exclusion masks.
- Ensure ivy cannot cover semantic door/window interaction regions.
- Generate clutter families from local style/context.
- Give generated clutter provenance and stable keys.
- Support pin/promote/detach/duplicate/suppress.
- Preserve user-moved promoted clutter when source opening changes.
- Separate decoration dirty domains from structure/collision/nav.

## Acceptance criteria

- Decoration does not cover excluded semantic regions.
- Local structural edits do not reroll unrelated clutter.
- Generated clutter can become authored without copying internal renderer state.
- Decoration-only edits do not rebuild collision/navigation.

# Phase 14 — RPG derived systems

## Objective

Turn workshop semantics into simulator-ready gameplay data.

## Proposed modules

```text
src/editor/workshop/derived/
├── CollisionDeriver.js
├── NavigationDeriver.js
├── RoomGraphDeriver.js
├── PortalDeriver.js
├── CoverDeriver.js
├── SupportDeriver.js
├── DestructionDeriver.js
└── GameplaySocketDeriver.js
```

## Work

- Promote current collision slabs/floors/rooms/foundations/cover semantics.
- Derive room adjacency from structural topology/openings.
- Derive portals from openings/traversal.
- Derive walkable regions and traversal navigation links.
- Derive cover/projectile/visibility openings.
- Add lock/interact/climb/AI sockets.
- Define destruction/support graph interfaces without requiring full destruction gameplay immediately.
- Keep definition-level static semantics separate from instance runtime state.

## Acceptance criteria

- Decorative geometry is not classified to discover gameplay truth.
- Material-only/detail-only edits do not rebuild RPG graphs.
- Opening/traversal changes update exact affected portals/nav regions.
- Instance door/lock state overlays reusable definition semantics.

# Phase 15 — Caches, scene diff, batching and LOD

## Objective

Make the semantic framework fast enough for direct editing and huge-world placement.

## Proposed modules

```text
src/editor/workshop/rendering/
├── WorkshopRenderer.js
├── WorkshopDerivedCache.js
├── WorkshopSceneDiff.js
├── WorkshopBatchBuilder.js
└── WorkshopLodBuilder.js
```

## Work

- Cache plans by normalized hash/entity/revision/generator version.
- Add separate surface-layout cache.
- Rebuild only invalidated render batches.
- Separate material-only updates from geometry uploads.
- Batch/instance bricks/planks/tiles/repeated trim.
- Preserve/adapt near/coarse/shell LOD quality gates.
- Add coarse structural shells for far distance.
- Define close-only micro-detail residency.
- Share definition-level products across world instances when possible.
- Bound caches by memory policy/device profile.
- Ensure safe GPU disposal/reference ownership.

## Acceptance criteria

- Unchanged entities reuse plan/render products.
- One local edit does not recreate an entire building scene graph.
- Repeated pieces are not represented by one scene object each.
- Undo/redo reuses prior cached products when hashes match.
- LOD transitions preserve the structural silhouette within documented regression tolerances.
- Instance reuse materially reduces duplicate world geometry/resource work where applicable.

## Milestone F gate

Profile complex fixtures and repeated world instances. The cost of a local workshop edit must primarily follow the affected neighborhood, not total world/workshop size.

# Phase 16 — Preset migration and legacy branch retirement

## Objective

Make archetypes templates over the semantic framework.

## Work

- Add `PresetRegistry`.
- Convert existing presets:
  - wall;
  - gatehouse;
  - tower;
  - square tower;
  - manor.
- Presets emit semantic authored patches/style profiles.
- Keep deterministic legacy recipe migration.
- Stop adding feature fields to migrated legacy archetypes.
- Retire geometry-to-component inference capability by capability.
- Add new cottage/inn/temple/fortress/bridge presets only as compositions.

## Acceptance criteria

- Existing presets remain recognizable/compatible within documented tolerances.
- A new preset does not require a new core geometry dispatcher branch.
- Legacy saves project deterministically.
- Oversized mixed legacy controllers/generators have materially reduced ownership.

## Milestone G gate

The framework is the normal authoring path; legacy recipe/generator inference is compatibility-only.

# Phase 17 — Advanced chemistry and RPG-specific extensions

Only after the framework is proven, add as separate capabilities:

- dormers/bay windows;
- curved/fantasy roofs;
- balconies;
- fences/gates sharing curve kernel;
- wall damage/ruins;
- structural destruction/collapse;
- repair/rebuild state;
- snow/wetness/exposure surface fields;
- magical architecture/support styles;
- modular interiors/furniture sockets;
- settlement-scale connected construction tooling.

Each extension must reuse semantic hosts, provenance, masks, style resolution, dirty domains and batching rather than create another special-case pipeline.

# Configuration plan

Keep user/device tunables in YAML.

Example direction only:

```yaml
workshop:
  document:
    schemaVersion: 1
  history:
    maxCommands: 200
  tolerances:
    pointCoincidence: 0.01
    zeroLength: 0.001
  constraints:
    snapDistance: 0.08
    snappingEnabled: true
  reactions:
    enabled: true
    maxPasses: 8
  detail:
    previewQuality: reduced
  cache:
    memoryBudgetMb: 256
```

Do not treat example values as final targets. Tune from measured behavior/device profiles. Structural invariants stay in code.

Avoid arbitrary architectural caps such as a globally assumed 4,096-entity limit. Safety limits must be resource-aware, scoped and observable.

# Testing strategy

## Semantic/model tests

- definition validation/serialization/migration;
- resolved model determinism;
- definition/instance separation;
- provenance/pin/detach/suppress/reset;
- command/patch/replay/undo;
- relationship/dependency graphs;
- style inheritance.

## Curve/topology property tests

Deterministically fuzz:

- node dragging;
- segment split/merge;
- curve conversion;
- opening attachment/reprojection;
- wall join creation/removal;
- traversal host attachment;
- undo/redo/save/load.

Assert no invalid references, NaN/Infinity, illegal committed zero-length segments, unstable serialization or unbounded loops.

## Reaction tests

- identical state -> identical proposals/resolution;
- conflict ordering deterministic;
- local rules query bounded spatial neighborhoods;
- suppression removes only the intended derived output;
- pin/promote changes ownership predictably;
- cycle/maximum-pass failures leave authored state intact.

## Surface-detail tests

- bricks/planks/tiles respect masks;
- small edits preserve unaffected derivation keys;
- opening changes affect only local layout cells;
- curved-surface layout follows supported policy;
- detail quality changes do not alter structure/gameplay truth.

## Geometry tests

- finite vertices;
- valid indices;
- expected bounds;
- curve continuity;
- corner joins;
- opening cuts;
- roof continuity;
- traversal continuity;
- support contact;
- valid disposal/resource ownership.

## RPG tests

- room/portal adjacency;
- door/window collision gaps;
- traversal nav links;
- cover/visibility openings;
- instance runtime door/lock overlays;
- support/destruction graph consistency.

## Visual regression

Local deterministic captures for:

- straight/curved walls;
- corners/intersections;
- windows/doors/arches;
- roof families;
- masonry/plank layouts;
- foundation/support variants;
- traversal stairs/ramp/platform/ladder/wall wrap;
- ivy/clutter exclusions;
- near/coarse/shell LOD.

No GitHub Actions.

# Performance validation

Measure deterministic fixture baselines for:

- pointer/preview evaluation time;
- reaction candidate count;
- invalidated entity/domain count;
- geometry plan count;
- surface-layout cells rebuilt;
- CPU generation time;
- GPU upload count/bytes;
- render batch count;
- cache hit ratio;
- near/coarse/shell geometry counts;
- repeated-instance memory/resource reuse.

Prefer regression ratios and locality checks over invented absolute numbers until device-specific budgets are measured.

The key performance contract is:

> A local semantic edit should normally cause local semantic resolution and local derived rebuilds.

# Review checklist for every new workshop feature

Before merging/accepting a workshop feature, ask:

- Is the user's intent semantic or is this storing renderer state?
- Does it need a new entity type, or can existing entities/modifiers compose it?
- Does it work on curves/local surface coordinates where relevant?
- What are its hard, soft and adaptive constraints?
- What dependencies/dirty domains does it declare?
- Is automatic output authored or resolved, and can the user pin/suppress/detach it?
- Are generated IDs/randomness stable through nearby edits?
- Does it publish/consume semantic masks instead of inspecting triangles?
- Does it change RPG semantics? If yes, are those derived explicitly?
- Does a local edit rebuild only a local neighborhood?
- Are repeated details batched/instanced?
- Is the behavior covered by deterministic semantic/geometry/visual tests?
- Can it load/migrate existing workshop saves?

# What not to do

- Do not build a second workshop beside the existing one.
- Do not add more mesh-to-component inference for new features.
- Do not make a giant new `WorkshopManager`/controller own everything.
- Do not use world-space positions as the canonical location for hosted details.
- Do not implement curved/freeform behavior as a pile of endpoint special cases.
- Do not let reaction rules mutate authored documents directly.
- Do not persist every generated brick/plank/support/clutter item as authored state.
- Do not use one sequential RNG stream whose consumption order changes after edits.
- Do not reject ordinary creative edits when an adaptive valid result is available.
- Do not let ivy/clutter/material systems rediscover doors/windows by scanning meshes.
- Do not create one `Object3D` for every procedural brick/plank/tile.
- Do not rebuild complete assets/world chunks for known local changes.
- Do not add new archetype-specific core branches when a preset/modifier/registry suffices.
- Do not add GitHub Actions.

# Completion criteria

The reviewed framework is established when:

- new assets author through `WorkshopDefinition` semantics;
- automatic chemistry resolves through `ResolvedWorkshopModel` with provenance;
- definitions and world instances are separate;
- freeform curves/topology are stable and deterministic;
- semantic commands/preview/undo/redo are the normal edit path;
- walls/openings/roofs/traversal/supports edit without geometry inference;
- generated details can be pin/detach/suppress/reset-to-auto;
- procedural detail stays visually coherent through local edits;
- bricks/planks/tiles use shared surface domains/masks and batched rendering;
- stairs/ramps/platforms/ladders/bridges/walkways share one traversal framework;
- context reactions are deterministic/local/conflict-resolved;
- style inheritance/aesthetic resolution is explicit;
- collision/nav/rooms/portals/cover/support semantics derive from construction intent/plans;
- local edits rebuild only affected neighborhoods/domains;
- repeated world instances share definition-level products where possible;
- current presets migrate deterministically;
- large mixed-responsibility legacy workshop modules are reduced/retired by capability;
- deterministic local test/performance/visual harnesses cover the architecture.

# Immediate next work

Do **not** start with more decorative geometry. Start with the foundation that every later Tiny-Glade-like feature needs:

1. finish Phase 0 baselines;
2. implement Phase 1 model layers/provenance;
3. implement Phase 2 curve/tolerance/topology kernel;
4. implement Phase 3 preview/command/history path;
5. promote composition and dependency/spatial graphs;
6. implement semantic walls as the first full vertical slice;
7. only then migrate openings and surface-detail chemistry.

The most important change from the previous plan is moving **curves, resolved automatic state, provenance and temporal coherence** into the foundation. Without those, later walls, stairs, planks, clutter and supports would reproduce visible Tiny Glade features through brittle special cases instead of giving Simulator a framework capable of surpassing them.
