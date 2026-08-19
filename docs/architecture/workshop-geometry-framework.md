# Workshop geometry framework

Status: Reviewed target architecture  
Scope: `src/editor/workshop/`, reusable workshop assets, workshop instances, and derived runtime data  
Reference behavior: Tiny Glade-style gridless/context-sensitive building interaction, extended for Simulator's huge-world RPG requirements  
Behavior review: `docs/research/tiny-glade-workshop-behavior-review-2026-08-19.md`

## Architectural goal

The workshop should feel like direct construction doodling rather than object placement: edits are gridless, neighboring geometry reacts naturally, details remain visually coherent, and the user can change their mind without fighting the system.

The core architectural rule is still:

> Canonical authoring state stores construction intent. Generated geometry is disposable derived data.

The stronger reviewed version adds a second equally important rule:

> Automatic building chemistry is resolved from authored intent; it must not silently become indistinguishable from authored intent.

The required ownership flow is:

```text
WorkshopDefinition / authored WorkshopDocument
    -> constraints + topology
    -> deterministic reaction/aesthetic resolution
    -> ResolvedWorkshopModel
    -> geometry/gameplay plans
    -> generated geometry + runtime derivations
    -> render/cache state

WorkshopInstance
    -> world transform + runtime state/overrides
    -> instance-specific derived products
```

Never make generated geometry the source from which normal workshop editing reconstructs canonical semantics.

## Product-quality target

Match the useful public behaviors that make Tiny Glade feel natural:

- gridless editing;
- curved/freeform structures;
- context-sensitive openings/supports;
- adaptive stairs/platforms/ladders/walkways;
- surface pieces that fit around openings and roof shapes;
- procedural clutter/vegetation that respects construction;
- style inheritance;
- stable-looking procedural detail through edits;
- easy undo/redo and direct manipulation.

Then exceed that behavior for Simulator with:

- huge-world reusable definitions and lightweight instances;
- deterministic replay/debugging;
- explicit rooms/portals/navigation/collision/cover;
- runtime door/window/lock/damage/destruction state;
- chunk/LOD/detail residency;
- stable auto-generated provenance and user pin/detach/suppress controls;
- extensible style/aesthetic resolution;
- local dependency/reaction evaluation rather than global rebuilding.

This document references Tiny Glade only as public product behavior. It does not assume or reproduce its private implementation.

## Non-goals

- Reproduce Tiny Glade internals.
- Replace Three.js/WebGPU.
- Build a general-purpose CAD package.
- Support arbitrary mesh sculpting as canonical workshop state.
- Rewrite all existing workshop systems at once.
- Add every future construction primitive up front.
- Couple workshop definition storage to current renderer classes.
- Require GitHub Actions; project validation remains runnable through local deterministic harnesses.

## Existing foundation to preserve

The current workshop already contains useful systems that should migrate into the framework:

- `ProceduralAssetStore.js`: versioned asset records and migration behavior;
- `ProceduralAssetManager.js`: generated parts, definition registration, footprint and LOD integration;
- `ProceduralWorkshopComposition.js`: semantic rectangles/circles/walls, material regions, collision slabs, floors, room boundaries, foundation contacts, cover surfaces, dirty primitive IDs;
- `ProceduralWorkshopArchitecturalSnapping.js`: snapping/opening constraints;
- `ProceduralWorkshopBoundaryResize.js`: semantic-style boundary resizing;
- `ProceduralWorkshopOpeningAttachments.js`: opening attachment state;
- `ProceduralWorkshopOpeningAssemblies.js`: opening assemblies;
- `ProceduralStraightSkeleton.js`: roof-solving building block;
- existing castle-wall/medieval generators;
- current workshop material and texture configuration;
- current LOD generation/validation.

The semantic direction already present in `ProceduralWorkshopComposition.js` should be promoted to the center of the system.

## Current architectural risk

The existing workshop mixes:

- recipe/archetype selection;
- generation;
- geometry inspection;
- inferred editable components;
- direct component transforms;
- snapping/opening editing;
- selection helpers and hit geometry;
- local history;
- material handling;
- render-state mutation.

Generated meshes are sometimes classified by material slot, bounds, volume and semantic hints to reconstruct editable components. Keep that only as a migration/compatibility adapter.

Target:

```text
semantic model
    -> resolved model
    -> GeometryPlan
    -> BufferGeometry / render batches
```

Avoid as normal authoring architecture:

```text
recipe
    -> mesh
    -> inspect mesh
    -> guess editable component
    -> manipulate guessed component
```

# 1. Canonical model layers

A single `WorkshopDocument` is not enough once context-sensitive automatic generation, huge-world instancing and runtime RPG state are considered. Use four explicit layers.

## 1.1 `WorkshopDefinition`

Reusable authored asset definition.

```text
WorkshopDefinition
├── schemaVersion
├── id
├── revision
├── seed
├── entities
├── relationships
├── styleProfile
├── materialLibrary
├── authoredOverrides
├── suppressionRules
├── metadata
└── extensionData
```

Requirements:

- pure serializable data;
- stable IDs;
- deterministic serialization order;
- explicit schema/generator versions;
- no Three.js objects;
- definition-local coordinates;
- normalized ID references;
- migration/validation support.

This is the long-lived workshop asset authored by the user.

## 1.2 `ResolvedWorkshopModel`

Deterministically generated semantic resolution of the authored definition.

Examples of data that normally belongs here rather than in authored state:

- automatically created wall/path doorway;
- automatically selected corner treatment;
- derived support column;
- generated trim;
- auto railing gaps around traversal paths;
- generated clutter anchors;
- generated masonry/plank layout cells;
- inferred style inheritance;
- roof intersection trims.

```text
ResolvedWorkshopModel
├── definitionRevision
├── resolutionVersion
├── resolvedEntities
├── reactionOutputs
├── styleResolution
├── surfaceDomains
├── topology
├── provenance
└── diagnostics
```

This layer is rebuildable. It is not persisted as authoritative geometry state.

## 1.3 Derived products

```text
ResolvedWorkshopModel
├── RenderPlans
├── CollisionPlans
├── NavigationPlan
├── RoomGraph
├── PortalGraph
├── CoverGraph
├── SupportGraph
├── DestructionGraph
├── GameplaySockets
└── Bounds/LOD plans
```

Derived products may be cached but remain disposable.

## 1.4 `WorkshopInstance`

World placement/runtime state is separate from the reusable definition.

```text
WorkshopInstance
├── id
├── definitionId
├── transform
├── variationSeed
├── runtimeState
│   ├── door/window state
│   ├── lock state
│   ├── damage/repair
│   ├── ownership
│   └── interaction state
├── instanceOverrides
└── revision
```

Do not duplicate the complete semantic definition for each repeated house, wall tower or prop in the huge world.

Instance runtime state must not mutate the shared workshop definition.

# 2. Stable identity and provenance

Every authored semantic entity has a stable ID. Every generated/resolved child has a deterministic derivation key.

Suggested generated key structure:

```text
<rule-id>:<source-entity-id(s)>:<local-role-or-cell>
```

Generated provenance records at least:

```text
source = auto | authored | promoted
ruleId
generatorVersion
sourceEntityIds[]
derivationKey
seedDomain
```

## User control over automatic output

Automatic output must support:

- **pin/promote**: convert a generated result into explicit authored intent;
- **detach**: remove an attachment relationship but preserve the object as authored;
- **suppress**: persist that a particular generated result/rule key should not appear here;
- **reset to auto**: remove the authored override and return control to resolution.

This is required for Tiny-Glade-like automatic richness without taking control away from the user.

# 3. Coordinate contract

## 3.1 Definition-local coordinates

Workshop geometry is authored in definition-local coordinates. World placement is applied only through `WorkshopInstance`.

Benefits:

- precision is stable on huge maps;
- reusable definitions remain portable;
- geometry planners do not depend on world-origin/floating-origin state;
- cache keys remain reusable between instances.

## 3.2 Local surface frames

Every hostable surface exposes a stable local frame:

```text
origin
u-axis
v-axis
normal
parameter domain
```

Openings, trim, material layout, ivy masks, clutter and attachments use host-local coordinates rather than arbitrary world positions.

# 4. Curve and topology kernel

The previous proposal was too polyline-oriented. Freeform/gridless construction requires first-class curves.

## 4.1 `CurvePath`

A path is an ordered set of stable segments:

```text
CurvePath
├── id
├── controlPoints[]
├── segments[]
└── closed

CurveSegment
├── id
├── type: line | arc | quadratic | cubic
├── controlPointIds[]
└── metadata
```

Start with only the segment types current tools need. Do not add NURBS/general CAD surfaces unless a real requirement appears.

## 4.2 Arc-length parameterization

Host positions on curves should use stable distance/normalized-distance semantics rather than raw spline implementation parameters.

For example an opening on a curved wall stores:

```text
hostPathId
segmentAnchor
arcLengthPosition
verticalPosition
```

Reprojection rules preserve identity when a host path is edited.

## 4.3 Stable topology through split/merge

Path edits need identity mapping:

```text
split edge A
    -> A-left preserves A lineage
    -> A-right gets deterministic child ID
    -> hosted openings/attachments reproject
```

Merging/splitting must emit explicit topology remap data for dependents and undo/redo.

## 4.4 Robust geometry tolerance policy

Centralize tolerances:

```text
GeometryTolerancePolicy
├── pointCoincidence
├── zeroLength
├── angularEquality
├── intersectionEpsilon
├── surfaceDistance
└── curveProjectionTolerance
```

Do not scatter magic epsilon values across snapping, roofs, openings and generators.

Degenerate preview states may temporarily exist while dragging, but committed canonical topology must satisfy invariants.

# 5. Semantic entity vocabulary

Keep core entities capability-oriented, not preset-oriented.

Recommended initial vocabulary:

```text
Structure
Footprint
CurvePath
Wall
Slab
Roof
Opening
TraversalPath
Support
Column
Beam
Attachment
TerrainContact
StyleRegion
DecorationAnchor
```

Optional future entities should be added only when behavior cannot be represented cleanly by composition.

Examples:

```text
Cottage
= Footprint + Walls + Slab + Roof + Openings

Castle tower
= Footprint(circle) + Wall shell + Floors + Roof + Openings + Battlement modifier

Bridge
= TraversalPath + Deck style + Supports + Railings

City wall
= CurvePath + Wall + Battlement modifier + tower/gate attachments
```

Presets such as manor/gatehouse/tower/cottage/inn/temple remain templates that create semantic patches.

# 6. Relationship graph

Use explicit typed relationships rather than implicit proximity whenever a meaningful semantic relationship exists.

Minimum relationship kinds:

```text
parent-of
hosted-by
attached-to
constrained-to
inherits-style-from
depends-on
adjacent-to
supports
supported-by
connects-to
```

Spatial contact/intersection relationships may be derived and cached rather than persisted.

The relationship graph feeds dependency invalidation, style inheritance, gameplay derivation and reaction scope.

# 7. Spatial index and locality contract

Building chemistry must not scan the whole workshop for every pointer move.

Maintain a semantic/local spatial index of:

- path bounds;
- wall envelopes;
- roof bounds;
- traversal segments;
- openings;
- terrain contacts;
- attachment surfaces.

Reaction/constraint evaluation uses:

```text
changed entity
    -> dependency neighbors
    + spatial neighborhood
    -> candidate rules only
```

The architecture should guarantee that a local edit is normally proportional to the affected neighborhood, not total document size.

# 8. Commands, preview and history

Every authoring edit follows:

```text
input gesture
    -> semantic intent
    -> preview transaction
    -> constraint/adaptation solve
    -> authored patch
    -> resolved preview
    -> derived preview scene diff
```

On commit:

```text
validated authored patch
    -> definition revision +1
    -> deterministic resolution
    -> dirty propagation
    -> derived scene diff
    -> one history command
```

Escape/cancel drops the preview patch.

Commands remain semantic:

```text
CreatePath
MoveControlPoint
InsertControlPoint
DeleteControlPoint
ResizeWall
SetWallHeight
AddOpening
MoveOpening
SetRoofPitch
CreateTraversalPath
MoveTraversalNode
ChangeStyle
PinGeneratedEntity
SuppressReactionOutput
DeleteEntity
```

No canonical command should mean `MoveMesh`, `ScaleGroup` or arbitrary `BufferGeometry` mutation.

# 9. Immutable authored patches

```text
WorkshopPatch
├── created[]
├── updated[]
├── deleted[]
├── relationshipChanges[]
├── overrideChanges[]
└── suppressionChanges[]
```

Patches are normalized and deterministic.

Benefits:

- clean undo/redo;
- replay/debugging;
- exact dependency invalidation;
- future collaborative editing if needed;
- stable test fixtures.

# 10. Constraint and adaptation engine

A Tiny-Glade-like editor should avoid saying "invalid" for normal creative edits.

Split constraints into three classes.

## 10.1 Hard invariants

Must be true to commit canonical data:

- finite coordinates;
- valid references;
- valid canonical path structure;
- no unsupported zero-length committed segments;
- no corrupt polygon topology;
- no duplicate stable IDs.

Hard failures reject commit with structured diagnostics.

## 10.2 Soft constraints/preferences

Examples:

- parallel/perpendicular alignment;
- endpoint coincidence;
- center alignment;
- equal height;
- preferred opening clearance;
- preferred stair landing alignment;
- style/proportion preferences.

Soft constraints influence snapping/resolution but do not make the user's edit impossible.

## 10.3 Adaptive constraints/morphs

Context may morph the resolved result:

- low window -> door role when tool policy allows;
- traversal segment -> walkway/stair/ramp/ladder according to slope/context;
- raised floor -> supports/foundation;
- wall/path crossing -> opening/portal;
- unsupported traversal -> alternative support policy;
- roof intersection -> trim/valley/reprojection.

The constraint engine should return candidate solutions with reasons/scores rather than hiding all decision logic inside tools.

# 11. Deterministic building chemistry

`WorkshopReactionEngine` operates on authored semantics and candidate spatial relationships.

A reaction is evaluated in explicit stages:

```text
Detect
    -> propose reaction outputs
Resolve conflicts/priorities
    -> build ResolvedWorkshopModel
Validate
    -> publish dirty domains/products
```

Rules must not directly mutate the committed document.

## Reaction properties

Every reaction declares:

- ID/version;
- input entity/relationship kinds;
- spatial scope;
- priority;
- deterministic key strategy;
- outputs;
- dirty domains;
- suppression/promotion policy;
- bounded recursion/pass behavior.

## Initial reactions

```text
Wall + Wall
    -> corner join/treatment

Path + Wall
    -> portal/opening candidate

Opening + Wall
    -> wall cut + frame/lintel/sill anchors

Roof + Chimney
    -> roof trim + flashing anchor

Raised Structure + Terrain
    -> foundation/support resolution

Traversal + Wall/Roof
    -> host-follow/landing/corner platform adaptation

Traversal crossing railing/battlement
    -> railing/battlement gap
```

# 12. Reaction conflict resolution

Multiple rules may target the same local region. Resolve proposals deterministically instead of depending on execution order.

Example ordering dimensions:

1. explicit authored override;
2. hard architectural safety/topology;
3. explicit tool intent;
4. host/attachment reaction;
5. style/aesthetic reaction;
6. decorative reaction.

Conflicts that cannot be combined produce diagnostics and a stable fallback, not nondeterministic output.

# 13. Stable procedural randomness and temporal coherence

This is a first-class requirement.

Do not seed one generator and then consume random values sequentially for an entire building. Small structural edits would reshuffle unrelated detail.

Use domain-separated deterministic streams:

```text
random(definitionSeed, entityId, domainId, localKey)
```

Example domains:

```text
masonry-layout
plank-layout
roof-tiles
weathering
ivy
clutter
support-variation
trim-variation
```

Each generated child has a stable local key based on semantic position/cell/role.

Requirements:

- local edits preserve unrelated details;
- adding a chimney must not reroll all windows;
- changing ivy intensity must not reroll brick arrangement;
- moving one stair node must not reshuffle unrelated stair decoration;
- undo/redo restores identical resolved detail.

# 14. Style and aesthetic resolution

Procedural richness should not be random noise. Introduce an explicit `StyleProfile` and deterministic `AestheticResolver`.

`StyleProfile` may include:

```text
architecture family
material families
roof preferences
trim family
opening proportion family
support family
surface layout rules
weathering range
clutter family/density
irregularity profile
color/pattern inheritance
```

The `AestheticResolver` chooses among valid generated variants using:

- explicit user choices first;
- inherited style;
- local geometry/proportions;
- curvature;
- neighboring repetition;
- semantic context;
- stable random stream.

Style inheritance is explicit:

```text
new snapped/connected entity
    -> inherits style from host/parent according to policy
    -> stores only overrides that differ
```

# 15. Surface-domain system

Tiny-Glade-grade visual detail requires a reusable representation for repeated physical surface pieces.

Define a `SurfaceDomain` derived from structural semantics:

```text
SurfaceDomain
├── id
├── hostEntityId
├── localFrame
├── boundary2D
├── holes/exclusionMasks[]
├── curvatureInfo
├── material/style family
├── trimBoundaries[]
└── detailAnchors[]
```

Consumers include:

- brick/stone courses;
- planks;
- timber framing;
- roof tiles;
- plaster wear;
- ivy/moss/dirt;
- clutter anchoring;
- snow/wetness later.

## Exclusion masks

Publish shared masks for:

- openings;
- traversal contact;
- roof intersection;
- corners/trim;
- decoration clearance;
- gameplay interaction clearance.

This prevents independent systems from rediscovering door/window bounds from triangles.

# 16. Repeated-piece layout grammars

Use deterministic layout planners:

```text
MasonryLayoutPlanner
PlankLayoutPlanner
TimberFrameLayoutPlanner
RoofTileLayoutPlanner
```

They operate in host-local surface coordinates.

Required capabilities:

- crop/split pieces around openings;
- avoid tiny invalid fragments using deterministic merge/adjust policies;
- preserve course/plank continuity across small edits;
- handle curved surfaces according to supported layout policy;
- expose coarse shell equivalents for distance LOD;
- avoid one `Object3D` per brick/plank/tile.

For arbitrary curved surfaces, layout policy can intentionally restrict unsupported orientations rather than producing bad geometry.

# 17. Wall subsystem

Walls are semantic paths with profile data, not transformed generated groups.

```text
Wall
├── pathId / edge reference
├── elevation
├── height
├── thickness
├── profile
├── topFamily
├── styleRegionId
└── authored options
```

`WallPlanner` produces:

```text
WallGeometryPlan
├── sampled/analytic path
├── envelope
├── visible intervals
├── openings
├── joins
├── roof trims
├── foundation interface
├── surface domains
├── material regions
└── gameplay slabs
```

Corner joining is a reaction/planning concern with deterministic fallback modes.

# 18. Opening subsystem

Doors, windows, arches, gates and trapdoors share semantic opening behavior.

```text
Opening
├── hostSurfaceId
├── hostPosition
├── verticalPosition
├── width
├── height
├── shape
├── depth
├── role
├── assemblyId
└── authored overrides
```

Assemblies can contain:

```text
frame
leaf/sash
shutters
lintel
sill
trim
grille/bars
```

Opening roles may morph under adaptive tool policy, but explicit user choices win.

An opening publishes:

- render cut mask;
- collision gap;
- portal/visibility semantics;
- decoration/ivy exclusion;
- attachment sockets.

# 19. Roof subsystem

Roofs are semantic host surfaces with pluggable solvers.

```text
Roof
├── boundary
├── holes[]
├── elevation
├── pitch
├── family
├── ridgeHints[]
├── overhang
└── styleRegionId
```

Solvers:

```text
FlatRoofSolver
GableRoofSolver
HipRoofSolver
ConeRoofSolver
StraightSkeletonRoofSolver
ManualRoofSolver
```

`auto` selects deterministically using footprint/topology/style hints.

The existing straight-skeleton implementation becomes one solver.

Roof output publishes stable surfaces/sockets:

```text
ridge
slope
eave
valley
flat-walkable region
```

This supports chimneys, dormers, gutters, stairs/traversal attachment and RPG walkable roofs.

# 20. Traversal system: stairs, ramps, platforms, ladders, bridges and walkways

Do not create a narrow fixed `Stair` model. Use a generalized `TraversalPath`.

```text
TraversalPath
├── nodes[]
├── edges[]
├── width
├── clearance
├── style
├── railingPolicy
├── supportPolicy
├── attachmentPolicy
└── authored segment overrides
```

Each node has stable identity and 3D definition-local position or host-relative position.

Each edge is resolved into one of:

```text
walkway
platform
ramp
stairs
ladder
bridge span
```

based on:

- slope;
- length;
- vertical difference;
- host surface;
- curvature/path-follow relation;
- explicit user override.

## Host-follow behavior

Traversal can constrain nodes/segments to:

- wall facade;
- wall top;
- tower/curved wall offset;
- flat roof;
- floor/slab edge;
- another traversal network.

Corner transitions can insert resolved platform nodes without polluting authored state unless the user promotes them.

Traversal publishes:

- walkable/nav connectivity;
- supports;
- railing gaps;
- clutter surface sockets;
- collision;
- path/animation spline where required.

# 21. Supports and foundations

Treat support/foundation behavior as a semantic/derived system rather than decoration.

Inputs:

- terrain contact field;
- structure footprint;
- elevation;
- supported surfaces;
- traversal/support graph;
- style profile;
- authored suppress/override choices.

Outputs may include:

```text
continuous foundation
stone plinth
columns
piers
stilts
arches
beams
```

Support resolution also feeds gameplay/destruction semantics.

# 22. Attachment sockets

Semantic surfaces expose named sockets/regions rather than requiring world-space guessing.

Examples:

```text
Wall: facade, top, corner, opening
Roof: ridge, slope, eave, valley
Floor: surface, edge
Traversal: deck, rail, node, underside
Opening: frame, sill, lintel, leaf
```

Attachments use host-local coordinates and survive compatible host edits.

# 23. RPG/gameplay derivation

The workshop architecture should produce gameplay truth without decorative mesh inspection.

```text
ResolvedWorkshopModel
├── CollisionGraph
├── NavigationGraph
├── RoomGraph
├── PortalGraph
├── CoverGraph
├── SupportGraph
├── DestructionGraph
└── GameplaySockets
```

Door semantics can provide:

- nav portal;
- visibility/sound portal;
- lock socket;
- interaction state;
- AI entry/exit.

Window semantics can provide:

- visibility/projectile opening;
- cover edge;
- climb socket when allowed.

Traversal directly contributes navigation edges.

Structural support graph enables later damage/collapse logic without inferring structure from visual bricks.

# 24. Dirty domains and dependency graph

Use domain-specific invalidation:

```text
TOPOLOGY
GEOMETRY
SURFACE_LAYOUT
MATERIAL
STYLE
COLLISION
NAVIGATION
ROOMS
PORTALS
SUPPORTS
DECORATION
LOD
BOUNDS
FOUNDATION
SPATIAL_INDEX
```

Examples:

```text
material tint change
    -> MATERIAL

plaster wear change
    -> MATERIAL/DECORATION only

window move
    -> TOPOLOGY, GEOMETRY, SURFACE_LAYOUT,
       COLLISION, PORTALS, DECORATION

wall control-point drag
    -> TOPOLOGY, SPATIAL_INDEX, GEOMETRY,
       SURFACE_LAYOUT, ROOF dependencies,
       COLLISION, NAVIGATION, ROOMS, PORTALS,
       SUPPORTS, FOUNDATION, DECORATION, LOD, BOUNDS
```

Callers do not manually trigger each downstream operation; the dependency graph does.

# 25. Interactive evaluation tiers

Direct manipulation needs a stable latency budget. Use two resolution tiers without changing authored semantics.

## Interactive preview tier

During drag:

- resolve only local dependencies;
- use simplified repeated-piece detail where necessary;
- defer expensive decorative refinement;
- reuse cached unaffected products;
- preserve collision/selection proxy correctness needed for editing.

## Settled tier

After commit/idle frame budget allows:

- generate full near visual detail;
- refresh decorative fields;
- prepare LOD tiers;
- update expensive secondary caches.

Both tiers must resolve to semantically equivalent structure. Preview is not allowed to invent a different final topology.

# 26. Render/cache architecture

Cache by stable semantic/resolved identity and normalized plan hashes.

```text
WorkshopDerivedCache
├── geometryPlanCache
├── surfaceLayoutCache
├── renderBatchCache
├── collisionCache
├── navCache
├── roomPortalCache
└── lodCache
```

Requirements:

- unchanged plan hashes reuse output;
- undo/redo may reuse previous cache entries;
- cache ownership/disposal is explicit;
- shared textures/materials are reference-safe;
- cache eviction is bounded by memory policy, not canonical semantics.

# 27. Rendering repeated details

Do not create one Three.js scene object per brick/plank/tile.

Prefer:

- instanced/batched geometry;
- shared geometry/material resources;
- merged coarse shells for distance;
- GPU-driven/indirect approaches only where Three.js/WebGPU support and measured benefit justify complexity;
- per-structure/object culling boundaries;
- detail residency by distance/importance.

Current near/coarse/shell LOD validation remains useful and should evolve into the new render path.

# 28. Huge-world residency

Tiny Glade is a small diorama; Simulator is not.

Use separate residency levels:

```text
semantic definition: persistent/shared
instance runtime state: lightweight/persistent as needed
coarse collision/nav: loaded for simulation radius
coarse render shell: world streaming radius
near structural detail: visual radius
micro detail: close visual radius only
```

Repeated world instances share definition-level render products when instance-specific variation permits.

Avoid fixed architectural assumptions such as a low global `maxEntities: 4096`. Safety limits should be configurable/resource-based and scoped to the correct object/document, with diagnostics rather than arbitrary product ceilings.

# 29. Registries and extension points

Use validated deterministic registries:

```text
EntityValidatorRegistry
GeometryRegistry
ConstraintRegistry
ReactionRegistry
ModifierRegistry
RoofSolverRegistry
SurfaceLayoutRegistry
TraversalResolverRegistry
DerivedSystemRegistry
PresetRegistry
```

Registries must reject duplicate IDs and freeze ordering/priority rules.

Avoid central archetype `if/else` growth.

# 30. Suggested source structure

```text
src/editor/workshop/
├── model/
│   ├── definition/
│   ├── resolved/
│   ├── instance/
│   ├── ids/
│   └── provenance/
├── commands/
├── history/
├── curves/
│   ├── CurvePath.js
│   ├── CurveProjection.js
│   ├── CurveIntersections.js
│   └── GeometryTolerancePolicy.js
├── topology/
├── spatial/
├── constraints/
├── reactions/
├── style/
│   ├── StyleProfile.js
│   ├── StyleResolver.js
│   └── AestheticResolver.js
├── surfaces/
│   ├── SurfaceDomain.js
│   ├── SurfaceMasks.js
│   └── layouts/
├── geometry/
│   ├── wall/
│   ├── roof/
│   ├── slab/
│   ├── opening/
│   ├── support/
│   └── shared/
├── traversal/
├── modifiers/
├── derived/
├── rendering/
├── interaction/
├── presets/
├── migration/
└── config/
```

Paths are targets, not a reason to move files prematurely. Split responsibilities only as corresponding behavior migrates.

# 31. Configuration

Use YAML for tunable policy, not structural invariants.

Example direction:

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
    snappingEnabled: true
    snapDistance: 0.08
  reactions:
    enabled: true
    maxPasses: 8
  detail:
    previewQuality: reduced
  cache:
    memoryBudgetMb: 256
```

Values above are configuration examples, not established performance targets. Tune them from measured workshop behavior and device profiles.

# 32. Determinism contract

Given the same:

- authored definition;
- instance state/overrides;
- configuration;
- generator/resolver versions;
- seeds;

the resolved model and plans must be deterministic.

Rules:

- no `Math.random()` in deterministic workshop resolution;
- stable iteration order;
- domain-separated seeded random streams;
- no timestamp/UUID randomness in canonical generated IDs;
- stable derived child keys;
- normalized plan hashes;
- explicit version changes when output intentionally changes;
- deterministic conflict resolution.

# 33. Failure handling

- Reject corrupt hard-invariant changes before commit.
- Prefer adaptive repair/morph over rejection for normal creative edits.
- Return structured diagnostics that tools can visualize.
- Derived failures cannot corrupt authored data.
- A failed reaction uses a deterministic fallback or suppresses only that output.
- A failed surface-detail planner may fall back to simpler surface geometry while retaining structural correctness.
- Log entity IDs, definition revision, rule/planner version and local context for unexpected failures.

# 34. Testing contract

## Semantic tests

- definition validation/serialization/migration;
- patch/replay/undo determinism;
- relationship graph;
- curve split/merge/remap;
- topology;
- constraint candidates;
- reaction conflict resolution;
- provenance/pin/detach/suppress;
- style inheritance;
- domain-separated randomness.

## Property/fuzz tests

Generate deterministic edit sequences:

```text
create path
split edge
move node
attach opening
merge edge
raise structure
undo/redo
save/load
```

Assert:

- no NaN/Infinity;
- valid IDs/references;
- no illegal committed zero-length segments;
- deterministic serialization;
- no reaction cycles;
- exact semantic undo round-trip;
- unaffected procedural regions retain stable derivation keys.

## Geometry tests

- valid indices;
- expected bounds;
- opening cuts;
- curve continuity;
- corner joins;
- roof continuity;
- traversal continuity;
- surface layout excludes openings;
- piece clipping has no invalid tiny/negative geometry;
- safe resource disposal.

## Visual regression

Use deterministic scenes/cameras/seeds to capture local reference images for:

- wall joins;
- curved walls;
- doors/windows;
- roofs;
- masonry/planks;
- traversal wrapping;
- foundations/supports;
- ivy/clutter exclusion.

Keep this runnable locally; do not add GitHub Actions for this project.

## Performance regression

Track:

- preview edit latency;
- affected semantic count;
- reaction candidate count;
- geometry plan rebuild count;
- surface layout rebuild count;
- CPU generation time;
- GPU upload count;
- cache hit ratio;
- near/coarse/shell triangles/batches.

Compare against deterministic baselines rather than inventing unmeasured absolute targets.

# 35. Migration policy

Migration is incremental.

Legacy recipes remain readable while adapters project them into `WorkshopDefinition`.

As each legacy archetype is fully represented semantically:

1. add deterministic projection fixtures;
2. prove visual/semantic compatibility;
3. route new edits through semantic commands;
4. stop adding new feature-specific state to the old recipe representation;
5. retire mesh-to-component inference for that capability.

Existing generators may remain as builders behind semantic planners until replacement is justified.

# 36. Architectural invariants

New workshop code must obey these rules:

1. Authored construction intent is semantic and serializable.
2. Automatic chemistry lives in a deterministic resolved layer unless explicitly promoted.
3. Three.js objects are derived presentation state.
4. Definition-local geometry is separate from world instances.
5. Curves/topology are first-class; freeform behavior is not approximated by controller hacks.
6. Commands modify authored semantics through validated patches.
7. Preview edits do not pollute committed history.
8. Hard constraints protect data; soft/adaptive constraints preserve creative flow.
9. Reactions are deterministic, local, bounded, conflict-resolved and suppressible.
10. Generated children have provenance and stable derivation keys.
11. Procedural randomness is domain-separated and temporally coherent.
12. Surface detail consumes semantic masks/domains, not mesh classification.
13. Presets compose capabilities; they do not create permanent core branches.
14. Gameplay truth derives from semantics/plans, not decorative meshes.
15. Dirty propagation is domain-specific and dependency/spatially driven.
16. Local edits must not trigger avoidable whole-document rebuilds.
17. Repeated visual pieces are batched/instanced, not represented as thousands of scene objects.
18. Cache/render failures cannot corrupt authored documents.
19. Existing compatible workshop systems are reused/migrated before replacements are written.
20. Large mixed-responsibility controllers/generators shrink as ownership moves.

# 37. End-to-end target flow

```text
USER INPUT
    -> Tool/Gesture Intent
    -> Preview Authored Patch
    -> Curve/Topology + Constraint Solver
    -> Authored Preview Definition
    -> Spatial/Dependency Neighborhood
    -> Reaction + Style/Aesthetic Resolution
    -> ResolvedWorkshopModel
         ├── Structural Geometry Plans
         ├── Surface Domains/Layout Plans
         ├── Traversal/Support Plans
         └── RPG Derived Plans
    -> Cache-aware builders
    -> Scene Diff / Render Batches
```

World use:

```text
WorkshopDefinition
    -> shared resolved/derived definition products
    -> WorkshopInstance transform/runtime state
    -> instance-specific collision/nav/state/render overrides
    -> streamed huge-world runtime
```

The long-term rule is therefore stronger than the original proposal:

> `Authored intent -> deterministic resolved chemistry -> derived geometry/gameplay`.
>
> Never make final geometry the normal source of truth, and never allow automatic detail to erase the distinction between what the user asked for and what the system chose to add.
