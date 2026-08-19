# Workshop geometry framework

Status: Proposed architecture  
Scope: `src/editor/workshop/` and derived workshop runtime data  
Reference behavior: Tiny Glade-style gridless, context-sensitive building editing

## Core decision

The workshop document stores construction intent. Generated geometry is disposable derived data.

Persist semantic entities such as footprints, walls, roofs, openings, slabs, stairs, supports, materials, attachments, and their relationships. Do not persist Three.js meshes, vertex buffers, scene groups, selection helpers, renderer caches, or other presentation state as the authoritative representation of a workshop asset.

The required dependency direction is:

```text
WorkshopDocument
    -> semantic planners
    -> constraints and reactions
    -> geometry plans
    -> generated geometry
    -> derived gameplay data
    -> render/cache state
```

Never make generated geometry the source from which the editor must infer the canonical workshop model.

## Goals

- Provide a stable framework for walls, buildings, roofs, openings, stairs, bridges, castles, ruins, interiors, and future construction systems.
- Support gridless edits where neighboring construction adapts naturally.
- Keep editing deterministic, serializable, undoable, testable, and versioned.
- Rebuild only the affected semantic and derived regions after an edit.
- Reuse the existing workshop investment instead of creating a second editor.
- Keep rendering, simulation, collision, navigation, materials, and editor interaction separated by responsibility.
- Allow presets such as manor, gatehouse, tower, cottage, inn, temple, or bridge to be compositions of reusable semantic entities instead of permanent geometry archetypes.
- Derive RPG information from the same semantic source as the visual geometry.

## Non-goals

- Reproduce Tiny Glade internals. Its source architecture is not assumed or required.
- Replace Three.js/WebGPU.
- Replace all existing workshop generators immediately.
- Add every future building primitive up front.
- Turn the workshop into a general-purpose CAD application.
- Store arbitrary generated mesh edits as canonical authoring state.

## Current foundation to preserve

The current workshop already contains useful pieces that should be migrated into the framework rather than discarded:

- `ProceduralAssetStore.js`: versioned procedural asset records and serialization.
- `ProceduralAssetManager.js`: generated parts, definition registration, footprint calculation, and LOD integration.
- `ProceduralWorkshopComposition.js`: semantic rectangles, circles, walls, material regions, collision slabs, walkable floors, room boundaries, foundation contacts, cover surfaces, and dirty primitive IDs.
- `ProceduralWorkshopArchitecturalSnapping.js`: architectural snapping and opening constraints.
- `ProceduralWorkshopBoundaryResize.js`: semantic-style boundary resize behavior.
- `ProceduralWorkshopOpeningAttachments.js`: opening attachment data.
- `ProceduralWorkshopOpeningAssemblies.js`: opening assembly data.
- `ProceduralStraightSkeleton.js`: a roof-solving building block.
- castle-wall and medieval workshop generators: reusable generators/preset implementation pieces.
- current material configuration and material-region systems.
- current LOD generation and validation.

The architecture should promote the strongest semantic parts of the existing composition system into the canonical workshop model.

## Problem with the current direction

The existing system mixes several different layers:

- recipe/archetype selection;
- generation;
- geometry inspection;
- inferred editable components;
- component transforms;
- snapping;
- opening editing;
- selection helpers;
- interaction history;
- material handling;
- render-state manipulation.

In particular, generated geometry is sometimes inspected by material slot, bounds, volume, and semantic hints to reconstruct editable component structure. That is acceptable as a migration or compatibility technique but must not remain the long-term authoring model.

Target direction:

```text
WorkshopDocument
    -> known semantic entities
    -> GeometryPlan
    -> BufferGeometry / meshes
```

Avoid:

```text
Recipe
    -> meshes
    -> inspect meshes
    -> guess editable components
    -> edit inferred components
```

## Canonical `WorkshopDocument`

Introduce one authoritative semantic document.

```text
WorkshopDocument
├── version
├── id
├── revision
├── entities
├── relationships
├── materials
├── metadata
└── extensionData
```

Minimum requirements:

- Stable entity IDs.
- Deterministic ordering during serialization.
- Explicit schema version.
- Document revision and optional per-entity revision.
- No Three.js classes in persisted data.
- No world-space renderer objects in persisted data.
- Normalized references by ID instead of object identity.
- Version-aware migrations.
- Validation before commit and after migration/load.

Example:

```yaml
version: 1
id: workshop:house-01
revision: 42
entities:
  house:
    type: building
  footprint-main:
    type: footprint
    parent: house
    shape:
      type: polygon
      points:
        - [-4, -3]
        - [4, -3]
        - [4, 3]
        - [-4, 3]
  wall-north:
    type: wall
    parent: footprint-main
    edge: 0
    height: 4.5
    thickness: 0.4
  door-main:
    type: opening
    host: wall-north
    openingType: door
    position: 0.45
    width: 1.2
    height: 2.3
  roof-main:
    type: roof
    host: footprint-main
    roofType: auto
    pitch: 38
```

The exact schema can evolve, but generated geometry must stay outside the canonical document.

## Small semantic primitive vocabulary

Keep the core vocabulary deliberately small and capability-oriented:

```text
Point
Path
ClosedPath
Footprint
Volume
Wall
Slab
Roof
Opening
Portal
Stair
Column
Beam
Attachment
DecorationRegion
```

Do not add a new core entity type merely because a new preset is added.

Examples:

```text
Cottage
= Footprint + Walls + Slab + Roof + Openings

Castle tower
= CircularFootprint + WallShell + Floors + Roof + Openings + BattlementModifier

Bridge
= Path + Deck + Supports + Railings

City wall
= Path + Wall + BattlementModifier + TowerAttachments + GateOpening
```

## Presets are templates, not geometry types

Current archetypes such as wall, gatehouse, tower, square-tower, and manor remain useful as user-facing presets and migration inputs, but they should produce semantic entities.

```text
Manor preset
    -> WorkshopDocument patch
       -> footprints
       -> walls
       -> slabs
       -> roofs
       -> openings
       -> attachments
```

Future presets such as cottage, tavern, temple, fortress, bridge, or ruin should not require central generator switch statements to understand those names.

## Entity relationship and dependency graph

Every semantic entity and every derived product must declare dependencies.

Example:

```text
footprint-main
├── wall-north
│   ├── window-1
│   ├── window-2
│   └── wall-north-geometry
├── wall-east
├── floor-0
├── roof-main
│   ├── chimney-1
│   └── roof-decoration
└── foundation
```

If one footprint corner moves, invalidate only the affected dependencies:

```text
control point changed
    -> footprint topology dirty
    -> affected walls dirty
    -> floor boundary dirty
    -> roof boundary dirty
    -> affected openings reprojected/validated
    -> affected foundation dirty
    -> dependent detail dirty
```

Unrelated entities must not rebuild.

## Dirty domains

Do not represent invalidation with one generic `dirty = true` flag. Track the domain of invalidation.

Recommended domains:

```text
TOPOLOGY
GEOMETRY
MATERIAL
COLLISION
NAVIGATION
ROOMS
PORTALS
DECORATION
LOD
BOUNDS
FOUNDATION
```

Examples:

```text
material change
    -> MATERIAL

window move
    -> TOPOLOGY, GEOMETRY, COLLISION, PORTALS, DECORATION

wall resize
    -> TOPOLOGY, GEOMETRY, COLLISION, NAVIGATION, ROOMS,
       PORTALS, FOUNDATION, DECORATION, LOD, BOUNDS
```

Dependencies decide the exact propagation. Callers should not manually enumerate every downstream renderer operation.

## Unified edit flow

Every workshop edit should travel through one logical pipeline:

```text
pointer/touch/tool input
    -> edit intent
    -> preview transaction
    -> constraint solver
    -> semantic patch
    -> dependency resolver
    -> geometry planners
    -> geometry builders
    -> derived gameplay systems
    -> scene diff
    -> render
```

Example wall drag:

```text
PointerMove
    -> MoveWallIntent
    -> SnapSolver
    -> ConstraintEngine
    -> PreviewPatch
    -> DependencyGraph
    -> affected plan rebuild
    -> preview scene diff
```

Pointer release commits the semantic patch. Escape/cancel discards the preview transaction.

## Preview transactions

Do not continuously mutate the committed document while a user is dragging.

```text
CommittedDocument + PreviewPatch = PreviewDocument
```

Rules:

- Preview changes are ephemeral.
- Preview changes use the same validators and planners as committed changes where practical.
- Pointer-up or explicit confirmation commits one logical command.
- Escape/cancel discards the patch with no inverse mutation required.
- Undo history records committed semantic commands, not pointer-move noise.

## Commands edit semantics

Command examples:

```text
CreateFootprint
MoveControlPoint
InsertPathPoint
RemovePathPoint
ResizeVolume
ChangeWallHeight
SetRoofPitch
AddOpening
MoveOpening
ResizeOpening
AttachStairs
ChangeMaterial
DuplicateEntity
DeleteEntity
```

Commands must not be named around Three.js implementation operations such as moving a mesh, scaling a scene group, or cutting an arbitrary `BufferGeometry`.

UI/controller code asks for semantic operations. The workshop domain decides how those operations affect topology, geometry, collision, navigation, and details.

## Immutable semantic patches

Commands should produce deterministic patches.

```text
WorkshopPatch
├── created[]
├── updated[]
├── deleted[]
└── relationshipChanges[]
```

Example:

```js
{
  updated: {
    'footprint-main': {
      points: [/* normalized points */],
    },
  },
}
```

Benefits:

- clean undo/redo;
- deterministic persistence;
- replay/debugging;
- easier tests;
- future collaborative/network editing if required;
- clear change sets for dependency invalidation.

## Constraint engine

Introduce a shared `ConstraintEngine` with provider-style constraints rather than embedding all architectural rules in interaction controllers.

Constraint families:

### Positional

- parallel;
- perpendicular;
- collinear;
- coincident control points;
- equal distance;
- equal height;
- center alignment;
- optional grid;
- terrain/foundation contact.

### Topological

- shared vertex/edge relationships;
- valid polygon winding;
- no zero-length segments;
- valid closed footprints;
- no illegal self-intersections;
- stable host references.

### Architectural

- opening remains within its host wall;
- minimum opening-to-corner distance;
- door reaches a valid floor/landing;
- stairs meet valid elevations;
- roof is supported by a valid boundary;
- window cannot exceed the host wall;
- support/foundation rules remain valid after elevation changes.

Existing architectural snapping should become one constraint provider rather than remain tightly coupled to a large component interaction controller.

## Reaction engine: building chemistry

Create a context-sensitive `WorkshopReactionEngine` that derives local adaptation from semantic relationships.

The reaction engine does not replace commands. A command changes canonical intent; reactions calculate deterministic dependent behavior or proposed semantic additions from the resulting context.

Examples:

### Path intersects wall

```text
Path + Wall
    -> wall/path reaction
    -> portal/opening candidate or automatic opening according to tool policy
```

### Stair reaches wall

```text
Stair landing + Wall
    -> landing reaction
    -> compatible opening/portal
```

### Two walls meet

```text
Wall A + Wall B
    -> corner reaction
    -> miter / pillar / masonry corner treatment
```

### Roof and chimney

```text
Roof + Chimney
    -> roof trim
    -> flashing/detail anchors
```

### Raised building

```text
building elevation changed
    -> foundation/support reaction
    -> columns / piers / stilts / foundation profile
```

### Window/opening

```text
Opening
    -> wall cut
    -> frame
    -> lintel
    -> sill
    -> optional shutters/assembly
    -> detail anchors
```

Reactions should be local, deterministic, ordered, bounded, and protected from recursive cycles.

## Geometry planning before geometry construction

Do not jump directly from an entity to triangles.

```text
Semantic entity
    -> GeometryPlanner
    -> GeometryPlan
    -> GeometryBuilder
    -> BufferGeometry / mesh parts
```

A wall plan can contain:

```text
WallGeometryPlan
├── path
├── elevation
├── height
├── thickness
├── visibleIntervals
├── openings
├── cornerJoins
├── topProfile
├── foundationProfile
├── materialRegions
└── detailAnchors
```

This separates semantic correctness from triangulation and material assignment, making debugging and caching substantially easier.

## Ordered geometry modifiers

Use deterministic modifier pipelines for local visual/structural adaptations.

Example:

```text
Base wall
    -> opening modifier
    -> intersection trimming
    -> corner joins
    -> roof clipping
    -> architectural detail
    -> surface breakup
    -> weathering
    -> decoration anchors
```

Potential modifiers:

```text
OpeningModifier
BattlementModifier
RoofIntersectionModifier
TimberFrameModifier
DamageModifier
WeatheringModifier
```

A modifier should declare inputs, outputs, dependencies, and dirty domains.

## Separate structural, visual, and micro-detail data

Maintain explicit layers.

```text
Structural
├── envelope
├── collision
├── portals
├── floors
├── supports
└── navigation semantics

Visual
├── stones
├── planks
├── beams
├── trim
├── tiles
├── shutters
└── decoration

Micro detail
├── cracks
├── moss
├── ivy
├── dirt
└── clutter
```

Changing moss must not rebuild collision. Changing roof tile style must not recalculate rooms. Moving a window can legitimately affect wall geometry, collision, portals, visibility, and nearby decoration.

## Roof subsystem

Treat roofs as semantic entities with solver-based implementations.

```text
Roof
├── boundary
├── holes[]
├── elevation
├── pitch
├── family
├── ridgeHints[]
└── overhang
```

Proposed solver interface implementations:

```text
FlatRoofSolver
GableRoofSolver
HipRoofSolver
ConeRoofSolver
StraightSkeletonRoofSolver
ManualRoofSolver
```

`roofFamily: auto` selects a suitable solver based on footprint and hints. The existing straight-skeleton code becomes one solver, not the entire roof architecture.

This leaves a clean extension path for lean-to, gambrel, mansard, cross-gable, turret, dome, and fantasy curved roofs.

## Opening subsystem

Doors, windows, arches, gates, and similar cuts should share one semantic `Opening` model.

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

Opening assemblies may contain:

```text
frame
door leaf
window sash
shutters
lintel
sill
trim
bars/grille
```

Converting a window to a door should normally change the semantic opening role/assembly rather than delete one unrelated geometry object and create another.

## Attachment sockets

Semantic entities expose named attachment sockets or surfaces.

Examples:

```text
Wall
├── facade
├── top
├── corner
└── opening

Roof
├── ridge
├── slope
├── eave
└── valley

Floor
├── surface
└── edge
```

Attachments resolve against sockets rather than arbitrary world coordinates:

```text
chimney -> roof:slope
banner -> wall:facade
gutter -> roof:eave
stairs -> floor:edge
torch -> wall:facade
```

## RPG/gameplay derivation

The same canonical document must derive visual geometry and gameplay semantics.

```text
WorkshopDocument
├── RenderGeometry
├── CollisionGeometry
├── NavigationGeometry
├── RoomGraph
├── PortalGraph
├── CoverGraph
├── DestructionGraph
└── GameplaySockets
```

Door semantics may provide:

- navigation portal;
- interaction socket;
- lock socket;
- sound-occlusion portal;
- visibility portal;
- AI entry/exit.

Window semantics may provide:

- visibility portal;
- projectile opening;
- cover information;
- climbing possibility when allowed.

Existing composition-derived collision slabs, walkable floors, room boundaries, foundation contacts, and cover surfaces are the starting point for this layer.

## Render and derivation caches

Cache derived products by stable entity ID, revision, and plan hash.

```text
WorkshopRenderCache
entityId
├── documentRevision
├── geometryPlanHash
├── highGeometry
├── mediumGeometry
├── lowGeometry
├── bounds
└── materialBindings
```

Separate caches may exist for collision/navigation if their invalidation domains differ.

Requirements:

- unchanged hashes reuse derived geometry;
- undo/redo may reuse prior cached plans;
- cache eviction is bounded;
- cache data is never canonical persistence;
- disposing a cache entry disposes owned GPU resources safely;
- shared material/texture resources are reference-safe.

## Registries and extension points

Avoid central generator conditionals as the primary extension mechanism.

Proposed registries:

```text
GeometryRegistry
ModifierRegistry
ConstraintRegistry
ReactionRegistry
RoofSolverRegistry
DerivedSystemRegistry
PresetRegistry
```

Conceptual examples:

```js
geometryRegistry.register('wall', wallGenerator);
geometryRegistry.register('roof', roofGenerator);
geometryRegistry.register('slab', slabGenerator);

modifierRegistry.register('battlements', battlementModifier);
modifierRegistry.register('damage', damageModifier);

reactionRegistry.register('wall+wall', wallCornerReaction);
reactionRegistry.register('wall+path', wallPathReaction);
reactionRegistry.register('roof+chimney', roofChimneyReaction);
```

Registrations must be deterministic and validated for duplicate IDs.

## Proposed source structure

```text
src/editor/workshop/
├── document/
│   ├── WorkshopDocument.js
│   ├── WorkshopEntity.js
│   ├── WorkshopPatch.js
│   ├── WorkshopMigration.js
│   └── WorkshopSerializer.js
├── commands/
│   ├── WorkshopCommandBus.js
│   ├── CreateEntityCommand.js
│   ├── UpdateEntityCommand.js
│   └── DeleteEntityCommand.js
├── topology/
│   ├── TopologyGraph.js
│   ├── FootprintTopology.js
│   └── RelationshipGraph.js
├── constraints/
│   ├── ConstraintEngine.js
│   ├── SnapSolver.js
│   ├── OpeningConstraints.js
│   └── IntersectionConstraints.js
├── reactions/
│   ├── ReactionEngine.js
│   ├── WallCornerReaction.js
│   ├── WallPathReaction.js
│   └── SupportReaction.js
├── geometry/
│   ├── GeometryPlanner.js
│   ├── GeometryRegistry.js
│   ├── wall/
│   ├── roof/
│   ├── slab/
│   ├── opening/
│   ├── stair/
│   └── support/
├── modifiers/
│   ├── ModifierPipeline.js
│   ├── OpeningModifier.js
│   ├── DamageModifier.js
│   └── BattlementModifier.js
├── derived/
│   ├── CollisionDeriver.js
│   ├── RoomGraphDeriver.js
│   ├── NavigationDeriver.js
│   └── CoverDeriver.js
├── rendering/
│   ├── WorkshopRenderer.js
│   ├── WorkshopRenderCache.js
│   ├── WorkshopSceneDiff.js
│   └── WorkshopLodBuilder.js
├── interaction/
│   ├── WorkshopToolController.js
│   ├── SelectionController.js
│   ├── HandleController.js
│   └── PreviewTransaction.js
├── presets/
│   ├── CottagePreset.js
│   ├── ManorPreset.js
│   ├── CastleWallPreset.js
│   └── GatehousePreset.js
└── config/
    └── workshop.yaml
```

Paths are proposed. Keep files small and split by responsibility; do not replace current large files with new large facade/controller files.

## Configuration

Prefer YAML for tunable policy and limits. Keep algorithms and invariants in code.

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
  cache:
    maxGeometryEntries: 512
  reactions:
    enabled: true
    maxPasses: 8
```

Do not hardcode user-tunable thresholds throughout controllers/generators.

## Determinism contract

Given the same canonical document, configuration, generator versions, and seed, semantic plans and geometry plans must be deterministic.

Rules:

- no `Math.random()` in deterministic workshop generation;
- stable iteration order;
- seeded random services for aesthetic variation;
- no timestamps in canonical IDs;
- stable generated child IDs derived from semantic parents and deterministic ordinals/roles;
- plan hashes use normalized data;
- version changes that intentionally alter output are explicit.

## Error handling and validation

- Reject invalid semantic commands before committed mutation.
- Return structured validation errors suitable for UI feedback.
- Log unexpected planner/generator failures with semantic entity ID, document revision, subsystem, and generator version.
- Do not silently drop invalid openings, roofs, portals, or supports from committed documents.
- Preview may show an invalid state visually, but it must indicate why it cannot be committed.
- Derived render failure must not corrupt the canonical document.

## Migration policy

Migration should be incremental, not a rewrite.

Existing versioned procedural recipes remain loadable during the migration window. A compatibility adapter projects legacy records into `WorkshopDocument` entities. New authoring should increasingly write semantic entities directly.

Once a legacy archetype has a stable semantic projection and round-trip acceptance tests, stop adding new feature-specific state to its legacy recipe representation.

## Architectural invariants

The following rules are non-negotiable for new workshop work:

1. Canonical authoring state is semantic, serializable data.
2. Three.js objects are derived presentation state.
3. Commands mutate semantics through validated patches.
4. Preview edits do not pollute committed history.
5. Geometry generation does not own gameplay truth.
6. Gameplay derivation does not inspect decorative meshes when semantic data exists.
7. Presets compose primitives; they do not define permanent engine branches.
8. Reactions are deterministic, local, bounded, and cycle-safe.
9. Dirty propagation is domain-specific and dependency-driven.
10. Existing compatible workshop systems are migrated/reused before replacements are written.
11. Rendering and cache failures cannot corrupt the document.
12. Large controllers/generators must be split as responsibilities migrate.

## End-to-end target flow

```text
USER
  -> Tool Intent
  -> Preview Transaction
  -> Constraint Engine
  -> Semantic Patch
  -> WorkshopDocument
  -> Dependency Graph
       ├── Geometry Planner -> Geometry Builder -> Render Cache -> Three.js/WebGPU
       ├── Collision/Nav/Room/Portal Derivers -> RPG runtime data
       └── Material/Decoration Derivers
  -> Reaction Engine feeds deterministic dependent semantic/plan changes
```

The central long-term rule is therefore:

> `WorkshopDocument -> Geometry`; never `Geometry -> infer WorkshopDocument` as the normal editing architecture.
