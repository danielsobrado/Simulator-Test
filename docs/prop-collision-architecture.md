# Streamed prop collision architecture

Status: **Accepted design direction**  
Date: **2026-07-27**  
Scope: player collision with trees, rocks, placed objects, and procedural constructions

Related plan: [`plans/prop-collision-implementation-plan-2026-07-27.md`](plans/prop-collision-implementation-plan-2026-07-27.md)

## 1. Decision

Implement a small player-centred static collision world that is independent from render LOD.

Use:

- analytic primitive colliders for trees, walls, posts, foundations, simple buildings, fences, and non-walkable rocks;
- simplified triangle collision proxies with one reusable BVH per prototype for large rocks and other irregular surfaces the player must walk on;
- the existing kinematic player controller, upgraded from point height sampling to a capsule motor with slide, step-up, slope, support, and ground-snap queries;
- the same deterministic placement manifests and spatial indices already used by rendering and construction;
- canonical world coordinates for collider ownership and storage;
- a small collision residency ring around the player rather than collision for the whole visible world.

Do not add a full rigid-body physics engine in the first implementation.

The immediate requirement is a performant static world query system. Dynamic rigid bodies, moving platforms, vehicles, ragdolls, and physical destruction are separate requirements and can justify Rapier later.

## 2. Required gameplay result

The player must:

- stop at tree trunks, walls, buildings, fences, and blocking rocks;
- slide along obstacles instead of freezing on first contact;
- enter genuine openings such as doors and arches;
- step over low obstacles up to the configured step height;
- walk and jump onto large rocks when their upper surface is reachable and walkable;
- remain supported on irregular rock surfaces without snapping through them;
- slide or fall from surfaces that exceed the maximum walkable slope;
- keep identical collision while a prop changes visual LOD;
- cross world chunks and floating-origin rebases without collision gaps or jumps.

## 3. Current repository state

### 3.1 Player movement

`src/editor/player/PlayerPhysics.js` currently:

- computes horizontal movement from the camera basis;
- asks for one ground height at the proposed X/Z position;
- rejects an elevation increase above `player.stepHeight`;
- applies jumping, gravity, and `groundSnapDistance`;
- stores the camera/player Y as terrain ground height plus eye height.

`src/editor/player/PlayerController.js` provides only:

```js
getGroundHeight: (x, z) => this.terrainView.getWorldHeight(x, z)
```

This is sufficient for a heightfield but not for props. A single height query cannot represent vertical sides, ceilings, overhangs, door openings, rock ledges, or lateral collision.

### 3.2 Terrain and voxel surfaces

The authoritative CPU terrain heightfield is already readback-free and should remain the base terrain support provider.

GPU marching-cubes surfaces currently have no CPU collision representation. This design must not add GPU geometry readback. Voxel collision remains out of scope until the voxel system has a CPU-side SDF or another deterministic query representation.

### 3.3 Trees

`StylizedTreeView` and `TreeManifestStore` already produce deterministic placement records containing stable IDs, canonical X/Z, terrain height, scale, rotation, prototype index, species, and ecological metadata.

Collision must consume these placement records. It must not inspect instanced render meshes or depend on near/proxy/impostor/cluster visual bands.

### 3.4 Rocks

`StylizedRockView` already:

- creates stable per-chunk manifests;
- keeps placements by chunk;
- exposes the current placement set;
- records prototype index, canonical position, Y rotation, scalar scale, radius, and height;
- maintains prototype geometry and measured prototype height;
- rebuilds placement windows under an existing frame budget.

This is the correct source for rock collision placement. The visual mesh should not be duplicated per instance for collision.

### 3.5 Placed objects

`ObjectMap` stores placed objects and grid occupancy. `ObjectView` already resolves the final terrain-aware world transform, including footprint centre, foundation height, Y rotation, and optional terrain-normal alignment.

That transform calculation must be extracted into a renderer-independent placement service so rendering and collision cannot diverge.

The footprint is useful for placement and broadphase bounds, but it is not a sufficient final building collider. Treating the whole footprint as solid would block doors, arches, interiors, roof overhangs, and other intentional openings.

### 3.6 Procedural constructions

`ConstructionSpatialIndex` already maps Bézier construction records to world chunks using curve bounds and wall thickness.

The construction compiler should emit both:

```text
construction source
  -> render proxy
  -> collision proxy
```

Collision should reuse the existing construction chunk index and rebuild only affected collision chunks after an edit.

## 4. Non-goals

The first collision release does not include:

- general rigid-body simulation;
- dynamic prop-to-prop collision;
- moving platforms;
- physical debris or destruction;
- ragdolls;
- vehicle physics;
- collisions with leaves, grass, flowers, or ordinary bushes;
- full-resolution visual mesh collision;
- GPU collision queries or GPU-to-CPU geometry readback;
- navmesh generation;
- authoritative multiplayer reconciliation.

## 5. High-level design

```text
Deterministic world sources
  |- CPU terrain heightfield
  |- TreeManifestStore
  |- StylizedRockView manifests
  |- ObjectMap + shared placement resolver
  `- ConstructionStore + ConstructionSpatialIndex

            |
            v

CollisionResidency
  |- player-centred load/unload ring
  |- revision tracking
  |- budgeted chunk builds
  `- canonical collider records

            |
            v

CollisionWorld
  |- chunk ownership
  |- fine uniform spatial bins
  |- primitive queries
  `- reusable prototype BVH queries

            |
            v

CharacterMotor
  |- capsule movement
  |- slide
  |- step-up
  |- slope filtering
  |- support selection
  `- ground snap
```

## 6. Coordinate contract

Use three explicit coordinate domains:

| Domain | Meaning | Usage |
|---|---|---|
| Cell | integer logical tile coordinates | object placement and tile lookup |
| Canonical world | persistent metre coordinates independent of floating origin | collider records, chunk ownership, deterministic IDs |
| Render local | canonical coordinates minus the current floating origin | camera, visible meshes, debug geometry |

Rules:

1. Every collider record is stored in canonical world coordinates.
2. Broadphase keys are derived from canonical coordinates.
3. The current player state may remain render-local initially to avoid a large controller rewrite.
4. Before a collision query, convert the player capsule and swept bounds to canonical coordinates once.
5. Convert the resolved displacement/contact data back to render-local before updating player state.
6. Floating-origin rebasing must not rebuild collider records or prototype BVHs.
7. Debug collider meshes, when enabled, follow the floating origin like render geometry.

### 6.1 Required coordinate audit

Verify the placed-object blocker path before sharing it with collision.

`ObjectMap` stores object `x` and `z` as cell coordinates, while `ObjectView` converts bounds to world coordinates before rendering. `TreeManifestStore.context()` currently places `object.x` and `object.z` directly into a world-space blocker list.

This may be intentional through another convention, but it is ambiguous with `map.tileSize: 2`. Add a focused test proving the expected blocker location. Fix the existing blocker conversion if the test confirms a mismatch.

Do not let the new collision system depend on implicit coordinate conventions.

## 7. Collision residency

Collision residency follows the player, not the camera and not render LOD.

Recommended initial policy:

```text
resident radius: current chunk plus one chunk in every direction
unload radius:   one additional ring
prefetch:        predicted player position
```

These are initial design values and must remain configuration-driven.

### 7.1 Residency inputs

A collision chunk revision depends only on collision-authoritative data:

- terrain/document revision affecting prop placement;
- tree manifest signature;
- rock manifest signature and prototype revision;
- placed object changes;
- construction changes;
- collision schema/config revision.

Visual material changes, impostor changes, colour changes, animation, and visual LOD transitions must not rebuild collision.

### 7.2 Build behaviour

- Build at most the configured number of collision chunks per frame.
- Respect a collision build time budget.
- Prioritise the player's current chunk, then movement direction, then neighbouring chunks.
- Keep the previous valid chunk active until its replacement is complete.
- Never expose a half-built collision chunk.
- Unload with hysteresis to prevent border thrashing.

## 8. Broadphase

Use a two-level static broadphase.

### 8.1 Level one: collision chunks

Each collider has one owner chunk determined from its canonical anchor or AABB centre. Colliders crossing chunk edges are referenced by all overlapping chunks or by a compact halo index.

Chunk ownership keeps lifecycle, revision, and cache invalidation simple.

### 8.2 Level two: fixed-size spatial bins

A 128-metre terrain chunk may contain many trees and up to the configured rock candidate budget. Querying every collider in the current and adjacent chunks on every movement step is avoidable.

Inside each collision chunk, index collider IDs into fixed world-space bins. The bin size must be configuration-driven and measured; a starting range around 8-16 metres is reasonable but is not an accepted final value.

A movement query:

1. computes the swept capsule AABB;
2. finds overlapping collision chunks;
3. finds overlapping bins;
4. deduplicates candidate collider IDs using a query stamp rather than allocating a `Set` every frame;
5. performs primitive or BVH narrow-phase tests only for those candidates.

### 8.3 Data representation

Prefer plain records and typed arrays over invisible Three.js meshes.

Example logical record:

```js
{
  id,
  sourceId,
  type,
  layerMask,
  bounds,
  transform,
  prototypeIndex,
  payload,
}
```

Prototype geometries and BVHs are shared. Instance records contain only transform, bounds, flags, and source identity.

## 9. Collision layers

Define explicit bitmasks from the first implementation:

- `PLAYER_SOLID`: blocks the player capsule;
- `WALKABLE`: may provide ground support when the normal is valid;
- `TRIGGER`: overlap only, no movement blocking;
- `PROJECTILE`: reserved for later projectile queries;
- `INTERACTION`: reserved for use/raycast selection;
- `NAV_BLOCKER`: reserved for later navigation generation.

A collider can belong to more than one layer. For example, a large rock is both `PLAYER_SOLID` and `WALKABLE`; a tree trunk is normally `PLAYER_SOLID` but not `WALKABLE`.

## 10. Character representation

Use an upright capsule rather than a point or box.

Separate:

- capsule foot/base position;
- capsule radius and body height;
- eye/camera offset;
- movement velocity;
- grounded/support state.

The camera remains at:

```text
capsule foot Y + configured eye height
```

Do not use eye height as the collision capsule height.

### 10.1 Movement query sequence

For each movement update:

1. Clamp the frame delta using the existing safety limit.
2. Compute the desired horizontal displacement.
3. Collect broadphase candidates for the entire swept capsule bounds.
4. Resolve horizontal motion with iterative collision and sliding.
5. If grounded and blocked, try step-up.
6. Apply jump/gravity vertical displacement.
7. Resolve vertical collision.
8. Query ground support below the capsule.
9. Apply slope rules.
10. Apply ground snap only when the controller was grounded and the support is within the configured snap distance.
11. Update camera position from the resolved capsule foot.

Use bounded iterations and no unbounded retry loops.

### 10.2 Sliding

When the capsule contacts a blocking surface:

- move it out by the penetration depth plus a small skin width;
- remove the inward component of the remaining displacement along the contact normal;
- continue with the tangential displacement;
- stop after the configured maximum contact iterations.

Handle multiple simultaneous contacts so the player cannot leak through corners.

### 10.3 Step-up

A valid step attempt requires:

1. the player was grounded before horizontal movement;
2. normal horizontal movement was blocked;
3. the obstacle height is within `stepHeight`;
4. moving the capsule upward does not hit a ceiling;
5. moving horizontally from the raised position is clear;
6. a downward support query finds a walkable surface;
7. the resulting capsule does not overlap another solid.

Do not teleport an airborne player onto a nearby ledge.

### 10.4 Slopes

A surface can support the player when:

```js
normal.y >= Math.cos(maxSlopeRadians)
```

Steeper surfaces still block penetration but do not become ground support. Depending on tuning, they either reject uphill movement or contribute a downhill slide.

### 10.5 Ground support

Combine support from:

- the authoritative CPU terrain heightfield;
- walkable rock proxy triangles;
- construction floors, bridges, ramps, and stairs;
- explicitly walkable building surfaces.

Choose the highest valid support below the feet that is:

- within the step/snap search interval;
- upward-facing enough;
- not an underside or ceiling;
- reachable without capsule overlap;
- associated with a currently resident collision chunk.

A terrain height query alone must never override a closer walkable prop surface above it.

## 11. Collider policy by prop type

### 11.1 Trees

Use one trunk collider per tree instance.

Default shape:

- capsule for irregular or tapered trunks;
- vertical cylinder is acceptable when it simplifies the narrow phase;
- optional second primitive only for a very wide split trunk.

Do not collide with:

- leaves;
- canopy lobes;
- ordinary branches;
- visual root collars unless they materially block movement.

Derive the default trunk collider from trunk-part geometry at prototype load time. Allow asset-level overrides for unusual trunks.

Example configuration metadata:

```yaml
collision:
  type: capsule
  radius: 0.42
  height: 5.8
  centerY: 2.9
```

The collider scales with the deterministic tree placement scale and follows its canonical position. Tree visual LOD and wind animation do not affect collision.

### 11.2 Rocks

Classify rocks into three collision tiers.

#### Decorative

Very small stones have no solid collider. Solid collision on ground clutter makes movement noisy and increases query load without useful gameplay.

#### Blocking primitive

Medium rocks that are not intended as traversal surfaces use one cheap primitive or a small compound:

- sphere or ellipsoid;
- capsule;
- two or three spheres for a long boulder.

These block movement but do not provide detailed walkable support.

#### Walkable mesh

Large boulders use a simplified triangle proxy and a reusable prototype BVH.

Requirements:

- collision proxy is independent from visual LOD;
- proxy retains the major top silhouette and ledges needed for traversal;
- proxy excludes small cracks and decorative noise;
- one BVH is built per prototype, not per placed rock;
- the player capsule is transformed into prototype-local space for queries;
- contact points and normals are transformed back to canonical world space;
- scalar instance scale and Y rotation use the same placement transform as rendering;
- rock burial is included consistently in collision placement.

This is the mechanism that makes rocks genuinely walkable rather than acting as a height teleport.

### 11.3 Placed buildings and objects

Use compound collision descriptions associated with the object definition or procedural model.

Examples:

- house walls: separate oriented boxes around door and window openings;
- foundation: box;
- tower: cylinder plus entrance opening primitives;
- wall segment: oriented box;
- fence: thin rail boxes plus post capsules;
- roof: ignored unless gameplay allows roof traversal;
- stairs: simple ramp support collider plus side blockers;
- bridge: walkable deck mesh/box plus rail blockers;
- lamp post: capsule;
- campfire and crops: normally trigger or no solid collision.

Create `ObjectColliderLibrary.js` parallel to `ObjectModelLibrary.js`. Share dimension constants and the final placement transform, but do not derive runtime collision by traversing rendered parts.

Add collision metadata to `config/objects.yaml` only when an object needs an override. Common model types should use defaults from the collision library.

### 11.4 Procedural constructions

The construction compiler emits simplified colliders from the same source path and dimensions as render geometry.

Recommended forms:

- straight wall: one oriented box;
- curved wall: chain of oriented boxes with overlap;
- fence: sparse post capsules and rail boxes;
- platform/floor: box or simplified walkable triangle mesh;
- bridge/deck: walkable mesh or boxes, with separate side blockers;
- stairs: ramp support collider;
- complex ruin: simplified authored/compiled collision mesh.

For large construction meshes, partition the proxy by collision chunk. Build one BVH per affected chunk after edits and swap it atomically when ready.

### 11.5 Bushes, flowers, grass, and aquatic plants

No solid collider by default.

Gameplay effects such as rustling, slowdown, harvesting, concealment, or damage use triggers or field sampling. They must not be represented by hundreds of solid leaf colliders.

## 12. Walkable mesh proxy authoring

Preferred source order:

1. an authored GLB node with a reserved name such as `COLLIDER` or `COLLIDER_WALKABLE`;
2. an offline-generated simplified proxy from the visual mesh;
3. a generated coarse fallback used only until the asset receives an authored proxy.

### 12.1 Proxy contract

A collision proxy must:

- use metres and the same local origin as the visual prototype;
- be closed only where solid volume matters;
- retain top surfaces and major ledges;
- remove sub-player-scale surface noise;
- have consistent winding and normals;
- avoid duplicate or degenerate triangles;
- avoid large numbers of disconnected fragments;
- be validated against the visual prototype bounds;
- have a documented triangle budget per asset category;
- pass traversal fixtures before production use.

Do not set one universal triangle limit without measurement. Record triangle count, BVH build cost, and collision query cost per prototype, then set category-specific validation limits.

### 12.2 Offline processing

Extend the existing asset preparation/optimisation pipeline to:

- preserve reserved collision nodes while extracting runtime visual prototypes;
- extract or generate collision geometry after all geometry-changing optimisation steps;
- validate proxy transforms and bounds;
- optionally serialise reusable BVH data only after the geometry ordering is final;
- emit a collision manifest mapping visual asset/prototype IDs to proxy records.

Runtime BVH generation is acceptable for early development and fallback assets, but production should prefer prepared proxies and avoid rebuilding the same prototype hierarchy on every launch when the measured startup cost is material.

## 13. BVH strategy

Use `three-mesh-bvh` for simplified triangle proxies only.

The library provides accelerated ray queries and direct spatial queries over static Three.js triangle geometry, including `shapecast`. Its bounds hierarchy is static; changed geometry must be rebuilt or refitted. This matches immutable rock prototypes and atomically replaced construction collision chunks.

### 13.1 Prototype-local queries

For a rock instance:

1. compute or reuse the inverse instance transform;
2. transform the capsule, sweep, or ray into prototype-local coordinates;
3. query the prototype BVH;
4. transform hit position and normal back to canonical world coordinates;
5. resolve movement in canonical/player space.

Do not clone collision geometry or BVHs per instance.

### 13.2 What does not use BVH

Do not use triangle BVHs for:

- tree trunks;
- ordinary wall boxes;
- posts;
- simple foundations;
- small rocks;
- grass, flowers, or bushes.

Primitive tests are cheaper, easier to debug, and more stable for these shapes.

## 14. Render LOD independence

Collision has no near/proxy/impostor/cluster bands.

A collider exists when its collision chunk is resident. Its shape is stable for the lifetime of its source record. Render LOD transitions can occur without collision revision changes.

Consequences:

- a tree impostor still has the same trunk capsule when the player approaches it;
- a rock changing visual representation keeps the same primitive or walkable proxy;
- collision does not pop with screen-size thresholds;
- visual culling cannot create an invisible wall inside the player collision ring; therefore collision residency must ensure the corresponding object is visible or about to become visible near the player.

## 15. Dependency decision

### 15.1 Adopt now

Add `three-mesh-bvh` when the walkable rock phase starts. Pin an exact compatible version in `package.json` after verifying it against the repository's pinned Three.js release.

Use it only for static simplified triangle proxies and related support/raycast queries.

### 15.2 Do not adopt now

Do not add Rapier for the first static-collision implementation.

Rapier's character controller supports move-and-slide, slope limits, autostep, snap-to-ground, filtering, and moving-platform interaction. It becomes attractive when the game needs a real physics world with dynamic colliders.

At present it would add a WASM lifecycle, another world representation, static collider synchronisation, chunk residency integration, and floating-origin handling before those capabilities are required.

### 15.3 Revisit trigger

Reconsider Rapier when at least one of these becomes committed scope:

- moving platforms;
- dynamic rigid bodies the player can push;
- physical projectiles requiring continuous collision;
- vehicles;
- ragdolls;
- physics-driven destruction;
- authoritative physics replication.

## 16. Alternatives rejected

### 16.1 Footprint-only collision

Rejected because it blocks doorways and interiors, cannot represent curved or irregular props, and cannot make rocks walkable.

### 16.2 Full visual mesh collision

Rejected because it couples gameplay to render LOD and asset detail, duplicates heavy geometry work, and pays for triangles that have no gameplay value.

### 16.3 One scene-wide Three.js Octree

The Three.js Octree addon supports capsule, sphere, and ray intersection against triangles and is useful for small mostly static scenes.

A single scene octree is a poor match here because the world is chunk-streamed, props are heavily instanced, visual LOD changes independently, and construction regions can be edited. Per-chunk rebuilding or explicit instance support would still need a custom ownership layer.

### 16.4 Collision from GPU marching-cubes output

Rejected because normal gameplay must remain readback-free. Add voxel collision only when a CPU query representation exists.

### 16.5 Full physics engine immediately

Rejected under YAGNI. The current requirement is static environment collision and walkable surfaces, not rigid-body simulation.

## 17. Configuration contract

Initial schema shape:

```yaml
collision:
  enabled: true

  streaming:
    residentRadius: 1
    unloadRadius: 2
    prefetchSeconds: 0.5
    chunkBuildsPerFrame: 1
    buildBudgetMs: 2
    spatialBinSize: 12

  player:
    radius: 0.35
    bodyHeight: 1.8
    skinWidth: 0.03
    maxSlopeDegrees: 50
    maxContactIterations: 4
    maxSubstepDistance: 0.35

  trees:
    enabled: true
    trunkOnly: true
    minimumRadius: 0.16

  rocks:
    enabled: true
    decorativeMaximumHeight: 0.3
    walkableMinimumHeight: 0.7

  objects:
    enabled: true

  constructions:
    enabled: true
    curveSegmentLength: 1.25

  debug:
    drawColliders: false
    drawBroadphase: false
    drawContacts: false
    freezeResidency: false
```

These numbers are provisional implementation defaults, not measured final tuning. Each must be validated by movement QA and performance captures.

## 18. Performance rules

1. Collision is CPU-only and local to the player.
2. No collision work is performed for distant render LOD rings.
3. Broadphase queries must not allocate in the steady-state movement loop.
4. Prototype geometry and BVHs are shared.
5. Primitive colliders remain primitives.
6. Collision chunks rebuild only when collision-authoritative revisions change.
7. Construction edits rebuild only overlapping collision chunks.
8. Heavy proxy/BVH preparation is offline or budgeted outside the movement step.
9. Candidate lists are reused between substeps of the same swept movement.
10. Debug visualisation is disabled by default and excluded from production performance results.

### 18.1 Initial frame budget target

Use the 16.67 ms 60-FPS frame as the reference. The provisional collision p95 goal is at most five per cent of that frame, approximately 0.83 ms, in the representative walking scenarios.

This is a design target, not a measured claim. Establish a no-collision baseline and tune or revise the target after the first instrumented implementation.

## 19. Instrumentation

Add counters/timers:

```text
collisionStepMs
collisionBroadphaseMs
collisionNarrowPhaseMs
collisionSupportMs
collisionCandidates
collisionPrimitiveTests
collisionBvhQueries
collisionTriangleTests
collisionContacts
collisionStepAttempts
collisionStepSuccesses
collisionActiveChunks
collisionActiveBins
collisionActivePrimitiveColliders
collisionActiveMeshInstances
collisionPrototypeBvhs
collisionChunkBuilds
collisionChunkBuildMs
collisionBvhBuildMs
collisionResidencyMisses
```

Integrate these into the existing performance QA report.

## 20. Failure and safety behaviour

- If a collision chunk is not ready, do not silently treat it as empty when the player can enter it.
- Hold the player at the readiness boundary or retain the previous valid collision data until the required chunk is ready.
- A missing optional visual asset must not leave stale colliders.
- A missing required collision proxy for an asset marked `walkable` fails validation.
- Invalid collision metadata fails asset validation rather than falling back to an unpredictable shape.
- Collision provider exceptions are logged with source ID, chunk, and prototype.
- The movement loop catches provider failure, prevents unsafe movement for that update, and reports the error through QA/debug status.

## 21. Tests required by the architecture

### Unit

- coordinate conversions;
- chunk and spatial-bin overlap;
- primitive capsule intersections;
- contact sliding;
- slope classification;
- support ordering;
- step-up acceptance and rejection;
- stable collision IDs;
- rock instance local/world transform round-trips;
- floating-origin invariant queries;
- object placement transform parity between render and collision;
- construction curve segmentation.

### Integration

- tree manifests produce trunk colliders at matching positions;
- rock manifests produce deterministic collision records;
- a large rock proxy supports walking and jumping;
- visual LOD transitions do not alter collision;
- placed doors remain passable;
- edited/removed props update collision;
- chunk crossing retains continuous collision;
- collision residency follows player movement and unloads with hysteresis;
- map save/load reproduces identical collider signatures.

### Headed acceptance

- walk into and slide around tree trunks;
- climb a selected large rock from multiple sides;
- reject a near-vertical rock face;
- jump from terrain to rock and rock to terrain;
- walk along a wall and through a doorway;
- walk across a bridge or platform construction;
- cross a collision chunk border while touching an obstacle;
- trigger a floating-origin rebase while standing on a walkable prop;
- repeat the movement QA route with collision counters enabled.

## 22. Source references

Repository sources reviewed:

- `README.md`
- `editor.config.yaml`
- `config/objects.yaml`
- `src/editor/player/PlayerController.js`
- `src/editor/player/PlayerPhysics.js`
- `src/editor/ObjectMap.js`
- `src/editor/ObjectView.js`
- `src/editor/stylized/StylizedRockView.js`
- `src/editor/stylized/StylizedTreeView.js`
- `src/editor/stylized/TreeManifestStore.js`
- `src/editor/construction/ConstructionSpatialIndex.js`
- `docs/object-pipeline.md`

External primary references:

- three-mesh-bvh: <https://github.com/gkjohnson/three-mesh-bvh>
- Three.js Octree addon: <https://threejs.org/docs/pages/Octree.html>
- Rapier JavaScript character controller: <https://rapier.rs/docs/user_guides/javascript/character_controller/>
