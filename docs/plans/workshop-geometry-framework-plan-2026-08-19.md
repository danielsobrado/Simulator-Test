# Workshop geometry framework implementation plan

Status: Proposed  
Priority: High  
Architecture: `docs/architecture/workshop-geometry-framework.md`  
Scope: evolve the existing workshop in place; no parallel replacement editor

## Goal

Move the current procedural workshop toward a semantic, dependency-driven geometry framework suitable for Tiny Glade-style gridless editing and future RPG construction systems.

The canonical authoring model must become semantic construction intent. Three.js/WebGPU meshes, scene groups, LOD meshes, selection helpers, and caches remain derived data.

The migration must preserve existing working workshop functionality while reducing coupling and avoiding a big-bang rewrite.

## Current code to build on

The current repository already contains substantial workshop infrastructure:

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
- `src/editor/workshop/ProceduralCastleWallGenerator.js`
- `src/editor/workshop/ProceduralMedievalGenerator.js`
- `src/editor/workshop/ProceduralMedievalWorkshopGenerator.js`
- current workshop material, texture, LOD, composition, and lifecycle modules.

`ProceduralWorkshopComposition.js` is the strongest seed for the future canonical model because it already represents semantic rectangles/circles/walls and derives collision slabs, walkable floors, room boundaries, foundation contacts, cover surfaces, material regions, and dirty primitive IDs.

The migration should promote that direction instead of making geometry inference more sophisticated.

## Key architectural rules for implementation

- Persist semantic workshop entities, not generated meshes.
- Keep stable IDs for all authored entities.
- Use versioned migrations for persisted documents.
- Route edits through commands and immutable patches.
- Use preview transactions for drag/edit interaction.
- Resolve snapping and architectural validity through constraint providers.
- Derive geometry through planner -> builder stages.
- Derive collision/navigation/rooms/portals from semantics where possible.
- Use domain-specific dirty propagation.
- Use deterministic, bounded reaction rules for context-sensitive building chemistry.
- Treat user-facing archetypes as presets/templates that create semantic entities.
- Keep source files small and split responsibilities as large existing workshop files are decomposed.

## Phase 0 — Baseline and migration safety

### Objective

Establish behavioral baselines before changing ownership of workshop state.

### Work

- Catalogue current persisted workshop asset version and all normalized recipe fields.
- Catalogue current component IDs and opening/assembly IDs used by saved assets.
- Add fixture assets covering at least:
  - classic wall;
  - stepped/tapered castle wall;
  - gatehouse;
  - tower;
  - square tower;
  - manor;
  - openings and opening assemblies;
  - transformed components;
  - custom material regions;
  - composition primitives.
- Capture semantic and visual invariants for each fixture.
- Add deterministic serialization snapshots for legacy records.
- Add geometry envelope/statistics baselines where they already matter for compatibility.

### Acceptance criteria

- Existing saved workshop assets still load.
- Existing fixture recipes normalize deterministically.
- Existing generated object footprints and semantic outputs are captured before migration.
- No migration phase starts without a repeatable compatibility fixture set.

## Phase 1 — Semantic kernel

### Objective

Introduce the canonical workshop document without replacing current rendering.

### Proposed modules

```text
src/editor/workshop/document/
├── WorkshopDocument.js
├── WorkshopEntity.js
├── WorkshopPatch.js
├── WorkshopSerializer.js
├── WorkshopMigration.js
└── WorkshopValidation.js

src/editor/workshop/commands/
├── WorkshopCommandBus.js
├── CreateEntityCommand.js
├── UpdateEntityCommand.js
└── DeleteEntityCommand.js
```

### Work

- Define `WorkshopDocument` version 1.
- Define stable entity ID rules.
- Define deterministic serialization ordering.
- Define document revision and optional entity revision.
- Define `WorkshopPatch` with created/updated/deleted/relationship changes.
- Define command validation and commit flow.
- Define structured validation errors.
- Add document cloning/snapshot helpers that do not depend on Three.js.
- Add compatibility projection from existing normalized workshop recipes into an initial semantic document.
- Add unit tests for document validation, serialization, patches, IDs, and deterministic replay.

### Acceptance criteria

- The same legacy workshop recipe always projects to byte-equivalent normalized document data.
- Document code has no Three.js imports.
- Invalid patches are rejected before committed mutation.
- A committed patch increments the document revision exactly once.
- Undo data can be represented entirely with semantic before/after patches or command records.

## Phase 2 — Promote composition into the canonical model

### Objective

Make current composition primitives first-class workshop entities.

### Work

- Map current rectangle, circle, and wall composition primitives to document entities.
- Move composition-specific validation behind semantic entity validators where practical.
- Preserve current material region derivation.
- Preserve current collision slabs, walkable floors, room boundaries, foundation contacts, and cover surfaces.
- Introduce a relationship/topology graph for parent, host, adjacency, and dependency relationships.
- Add explicit dirty domains:
  - `TOPOLOGY`
  - `GEOMETRY`
  - `MATERIAL`
  - `COLLISION`
  - `NAVIGATION`
  - `ROOMS`
  - `PORTALS`
  - `DECORATION`
  - `LOD`
  - `BOUNDS`
  - `FOUNDATION`
- Replace generic dirty behavior in new code with graph-based invalidation.

### Acceptance criteria

- Existing composition assets produce equivalent geometry and current RPG semantics.
- A change to one primitive returns the exact affected semantic IDs and dirty domains.
- Unrelated composition primitives do not rebuild.
- Current serialized composition can be migrated without data loss.

## Phase 3 — Wall subsystem as the reference implementation

### Objective

Implement one complete semantic-to-geometry vertical slice using walls.

### Proposed modules

```text
src/editor/workshop/geometry/wall/
├── WallPlanner.js
├── WallBuilder.js
├── WallGeometryPlan.js
└── WallJoins.js

src/editor/workshop/topology/
├── TopologyGraph.js
├── FootprintTopology.js
└── RelationshipGraph.js
```

### Work

- Represent walls using semantic paths/edges, elevation, height, thickness, and top profile.
- Add stable control-point IDs where needed for shared geometry.
- Add wall planning before triangulation.
- Add deterministic corner joins.
- Preserve castle wall and battlement behavior through modifiers/preset adaptation rather than new core wall types.
- Introduce a geometry registry and register the wall planner/builder.
- Move direct wall manipulation away from arbitrary scene-group transforms.
- Use semantic patches for wall resize/move/edit operations.

### Acceptance criteria

- Wall geometry is generated only from wall semantic data plus declared dependencies.
- Editing one wall does not require geometry inspection to rediscover that wall.
- Shared corners remain stable through edits.
- Existing wall presets remain visually compatible within documented tolerances.
- The wall implementation becomes the pattern for subsequent roof/slab/stair systems.

## Phase 4 — Preview transactions and interaction decomposition

### Objective

Separate pointer interaction from persistent authoring state.

### Proposed modules

```text
src/editor/workshop/interaction/
├── WorkshopToolController.js
├── PreviewTransaction.js
├── SelectionController.js
└── HandleController.js
```

### Work

- Introduce `CommittedDocument + PreviewPatch = PreviewDocument`.
- Convert pointer-drag changes to preview semantic patches.
- Commit one logical command on pointer-up/confirm.
- Discard preview on cancel/Escape.
- Move selection helper ownership out of semantic controllers.
- Move handle rendering/hit targets out of command/domain code.
- Decompose `ProceduralWorkshopComponentController.js` as responsibilities migrate.
- Keep old component transform support behind a compatibility layer until equivalent semantic operations exist.

### Acceptance criteria

- Pointer movement does not create dozens of undo entries.
- Cancel restores the committed document without inverse mesh operations.
- Undo/redo works from semantic committed commands.
- Selection/handle rendering can be replaced without touching document logic.
- `ProceduralWorkshopComponentController.js` materially shrinks instead of becoming a forwarding facade of similar size.

## Phase 5 — Constraint engine and snapping providers

### Objective

Unify geometric and architectural constraints.

### Proposed modules

```text
src/editor/workshop/constraints/
├── ConstraintEngine.js
├── SnapSolver.js
├── TopologyConstraints.js
├── OpeningConstraints.js
└── IntersectionConstraints.js
```

### Work

- Move architectural snapping behind a provider interface.
- Support positional constraints such as parallel, perpendicular, collinear, coincident, center, optional grid, and terrain contact.
- Support topological constraints such as valid closed polygons, stable shared vertices, no zero-length edges, and no illegal self-intersection.
- Support architectural constraints such as opening bounds, corner clearances, valid door landings, stair elevations, and roof-support validity.
- Return structured candidate/violation information for UI previews.
- Keep snap thresholds in YAML configuration.

### Acceptance criteria

- Editing tools do not contain architecture-specific snap math beyond invoking providers.
- Invalid committed geometry is rejected with a user-readable reason.
- Preview can visualize valid snap targets and invalid constraints.
- Existing opening constraint behavior remains available through the new engine.

## Phase 6 — Opening subsystem

### Objective

Make doors, windows, arches, and gates semantic openings hosted by structural surfaces.

### Proposed model

```text
Opening
├── hostSurfaceId
├── u
├── v
├── width
├── height
├── shape
├── depth
├── role
└── assemblyId
```

### Work

- Normalize current opening attachment/assembly data into the new model.
- Store opening coordinates relative to their host surface.
- Reproject/validate openings when host geometry changes.
- Add an opening modifier to wall geometry plans.
- Derive frame/lintel/sill/leaf/shutter detail from opening assemblies.
- Derive portal semantics from opening role and state.
- Preserve deterministic IDs when openings are copied/duplicated.

### Acceptance criteria

- Moving/resizing a wall keeps compatible openings attached to the same semantic wall.
- Invalid openings are not silently dropped.
- Converting a window assembly to a door assembly does not require replacing the host entity.
- Wall collision and portal data reflect opening changes without inspecting decorative meshes.

## Phase 7 — Roof framework and solvers

### Objective

Turn roofs into semantic entities with pluggable solver implementations.

### Proposed modules

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

### Work

- Define roof boundary, holes, elevation, pitch, family, ridge hints, and overhang.
- Wrap existing straight-skeleton logic as one solver.
- Implement/port flat, gable, hip, and cone solver behavior needed by current presets.
- Keep `auto` roof selection deterministic.
- Add roof dependency invalidation from footprint/wall changes.
- Expose semantic roof sockets: ridge, slope, eave, valley.
- Preserve current roof material regions and LOD behavior.

### Acceptance criteria

- Existing supported roof families remain available.
- A footprint edit rebuilds only affected roof plans.
- Straight-skeleton code is not imported directly by unrelated editor controllers.
- New roof solvers can be registered without editing a central archetype switch.

## Phase 8 — Building chemistry / reaction engine

### Objective

Add Tiny Glade-style context-sensitive adaptation as deterministic local reactions.

### Proposed modules

```text
src/editor/workshop/reactions/
├── ReactionEngine.js
├── WallCornerReaction.js
├── WallPathReaction.js
├── RoofChimneyReaction.js
└── SupportReaction.js
```

### Initial reactions

- wall + wall -> corner treatment;
- path + wall -> portal/opening candidate or automatic operation according to active tool policy;
- stair landing + wall -> compatible portal/opening;
- roof + chimney -> roof trim and flashing/detail anchors;
- raised building + terrain/foundation -> support/foundation adaptation;
- opening + wall -> cut, frame, lintel, sill, assembly anchors.

### Requirements

- deterministic ordering;
- local dependency scope;
- bounded pass count;
- cycle detection/prevention;
- no unbounded recursive spawning;
- clear distinction between canonical user intent and derived reactions;
- reaction outputs must declare dirty domains.

### Acceptance criteria

- Reactions produce identical results for identical document state/config/seed.
- A local wall interaction does not traverse the whole workshop document unnecessarily.
- Reaction cycles fail safely with a logged diagnostic and no document corruption.
- Disabling a reaction policy is possible through configuration where appropriate.

## Phase 9 — Planner/modifier framework for remaining geometry

### Objective

Generalize the wall approach to reusable geometry systems.

### Work

- Introduce/complete `GeometryPlanner` and `GeometryRegistry`.
- Introduce `ModifierRegistry` and deterministic modifier ordering.
- Move remaining procedural geometry into semantic planners/builders gradually.
- Initial modifier families:
  - openings;
  - battlements;
  - intersection trimming;
  - roof clipping;
  - timber frame;
  - damage;
  - weathering;
  - detail anchor generation.
- Add slab/floor, stair, support/column, beam, and attachment planners as required by current/future workshop features.

### Acceptance criteria

- New geometry capabilities can be added through registries without extending large central switch statements.
- Modifiers operate on plans/declared geometry stages, not arbitrary scene graph searches.
- Structural and decorative modifiers have separate invalidation domains.

## Phase 10 — RPG semantic derivation

### Objective

Make workshop construction useful to the simulator without reading decorative meshes.

### Proposed modules

```text
src/editor/workshop/derived/
├── CollisionDeriver.js
├── NavigationDeriver.js
├── RoomGraphDeriver.js
├── PortalDeriver.js
├── CoverDeriver.js
└── FoundationDeriver.js
```

### Work

- Promote current collision slabs, floors, rooms, foundations, and cover semantics into explicit derived systems.
- Derive room adjacency from walls/openings/floors.
- Derive portals from doors, windows where applicable, arches, gates, and stairs.
- Derive walkable floor regions and stair connections.
- Derive cover surfaces and projectile/visibility openings.
- Define gameplay sockets for locks, interactions, AI entry, climbing, and destruction integration.

### Acceptance criteria

- Collision/navigation/room/portal derivation uses canonical semantic data or geometry plans, not decorative mesh classification.
- Material-only changes do not rebuild RPG graphs.
- Opening changes update the exact affected portals/collision regions.
- Existing composition semantics remain backward compatible during migration.

## Phase 11 — Derived caches, LOD, and scene diff

### Objective

Make the framework fast enough for interactive authoring and large-world placement.

### Proposed modules

```text
src/editor/workshop/rendering/
├── WorkshopRenderer.js
├── WorkshopRenderCache.js
├── WorkshopSceneDiff.js
└── WorkshopLodBuilder.js
```

### Work

- Cache geometry plans by normalized plan hash.
- Cache generated geometry by entity/revision/version key.
- Preserve and adapt current LOD envelope/savings validation.
- Rebuild only invalidated render entities.
- Apply scene diffs instead of replacing entire workshop groups where possible.
- Separate material-only updates from geometry rebuilds.
- Bound cache size through YAML config.
- Ensure safe GPU disposal and shared resource ownership.

### Acceptance criteria

- Unchanged semantic entities reuse cached geometry.
- Material-only edits do not rebuild vertex/index buffers when unnecessary.
- Undo/redo can reuse prior cached geometry when hashes match.
- Current near/coarse/shell LOD quality gates remain effective or are replaced by explicit equivalent tests.

## Phase 12 — Preset migration

### Objective

Make archetypes user-facing templates rather than permanent engine branches.

### Work

- Add `PresetRegistry`.
- Convert existing presets incrementally:
  - wall;
  - gatehouse;
  - tower;
  - square tower;
  - manor.
- Presets produce semantic document patches.
- Keep legacy recipe loader/migration support while saved assets still depend on it.
- Stop adding new persistent fields to migrated legacy archetype recipes unless required for compatibility.
- Add future presets only by composing stable semantic entities/modifiers/assemblies.

### Acceptance criteria

- Existing presets still create recognizable equivalent assets.
- A new cottage/inn/etc. preset can be implemented without adding a new branch to the core geometry dispatcher.
- Saved legacy workshop assets migrate deterministically.

## Phase 13 — Detail chemistry

### Objective

Move decorative richness onto stable structural semantics after the architecture is proven.

### Candidate derived/detail systems

- masonry breakup;
- stone/block courses;
- planks;
- beams/timber frame;
- roof tiles;
- trim;
- shutters;
- cracks/damage;
- moss;
- ivy;
- dirt/weathering;
- clutter anchors;
- banners/signs/torches;
- gutters/flashing.

### Acceptance criteria

- Decorative changes do not alter collision/navigation unless an explicit structural modifier says they should.
- Detail systems consume semantic sockets/surfaces instead of arbitrary world-space guesses.
- High-detail generation can be disabled or reduced independently of structural editing quality.

## Target source structure

The final structure should trend toward:

```text
src/editor/workshop/
├── document/
├── commands/
├── topology/
├── constraints/
├── reactions/
├── geometry/
│   ├── wall/
│   ├── roof/
│   ├── slab/
│   ├── opening/
│   ├── stair/
│   └── support/
├── modifiers/
├── derived/
├── rendering/
├── interaction/
├── presets/
└── config/
```

Do not move files merely to match this tree. Move/split responsibilities when the corresponding phase is implemented and tested.

## Configuration plan

Add workshop framework policy to YAML rather than scattering thresholds through controllers.

Example direction:

```yaml
workshop:
  document:
    schemaVersion: 1
    maxEntities: 4096
  history:
    maxCommands: 200
  constraints:
    snapDistance: 0.08
    minimumWallLength: 0.20
    minimumOpeningCornerDistance: 0.10
  reactions:
    enabled: true
    maxPasses: 8
  cache:
    maxGeometryEntries: 512
```

Exact values should be tuned against current workshop behavior. Structural invariants remain code, not configuration.

## Testing strategy

### Semantic unit tests

Test without Three.js where possible:

- document validation;
- serialization/migration;
- command/patch behavior;
- topology;
- dependencies;
- constraints;
- reaction determinism;
- opening host coordinates;
- roof solver plan output;
- dirty-domain propagation.

### Geometry tests

- plan-to-geometry deterministic statistics;
- finite/non-NaN vertices;
- valid index ranges;
- expected bounds;
- opening cuts;
- corner joins;
- roof continuity;
- LOD envelope tolerances;
- geometry disposal ownership.

### Integration tests

- create preset -> edit -> save -> load -> equivalent document;
- drag preview -> cancel;
- drag preview -> commit -> undo -> redo;
- resize wall with opening;
- resize footprint with roof;
- raise building and update foundation/supports;
- add/remove door and update collision/portal data;
- material-only edit avoids geometry invalidation.

### Performance tests

Measure at least:

- edit latency for one wall in a complex asset;
- number of semantic entities invalidated;
- number of geometry plans rebuilt;
- CPU geometry time;
- GPU upload count;
- cache hit ratio;
- full preset generation time;
- LOD triangle counts.

The desired behavior is proportional to affected local geometry, not total asset complexity.

## Migration order and dependencies

Recommended strict order:

```text
0 baseline fixtures
1 semantic kernel
2 composition promotion
3 wall reference subsystem
4 preview/interaction split
5 constraint engine
6 openings
7 roofs
8 reaction engine
9 general planner/modifiers
10 RPG derivation
11 caches/LOD/scene diff
12 preset migration
13 detail chemistry
```

Some phases may overlap in implementation, but semantic ownership must precede additional complex visual features.

## What not to do during migration

- Do not create a second complete workshop beside the existing one.
- Do not rewrite all generators before the semantic kernel exists.
- Do not add more mesh-to-component inference for new features.
- Do not make `ProceduralWorkshopComponentController.js` the new central service for the framework.
- Do not persist `THREE.Object3D`, matrices, geometry buffers, or cache IDs as canonical entities.
- Do not make visual mesh classification the authoritative source for rooms, portals, stairs, collision, or supports.
- Do not put all constraints/reactions in one giant file.
- Do not introduce global rebuilds for local edits when dependencies are known.
- Do not add new archetype-specific branches when a preset can compose existing semantics.

## Completion criteria

The framework can be considered established when all of the following are true:

- New workshop assets can be authored from `WorkshopDocument` semantics.
- Existing workshop assets migrate/load through a deterministic compatibility path.
- Walls, openings, roofs, and at least one multi-part preset edit semantically without geometry inference.
- Preview transactions and command-based undo/redo are working.
- Constraint providers drive snapping/validity.
- At least the initial building-chemistry reactions work deterministically.
- Collision, rooms, floors, portals, foundations, and cover are derived from semantics/plans.
- Local edits rebuild only affected entities/domains.
- Presets can be added without core generator archetype branches.
- `ProceduralWorkshopComponentController.js` and other oversized mixed-responsibility modules have been reduced or retired as responsibilities migrate.
- Documentation and schema migration rules match the final implementation.

## Immediate next work

Start with Phases 0-3 before adding more workshop geometry features:

1. create baseline workshop fixtures and compatibility assertions;
2. implement the semantic document/patch kernel;
3. project current composition into that document;
4. implement semantic walls as the first full planner/builder path;
5. keep existing rendering operational through adapters while the new ownership model proves itself.

This order gives every later Tiny Glade-style feature a stable extension point instead of increasing coupling in the current controller/generator architecture.
