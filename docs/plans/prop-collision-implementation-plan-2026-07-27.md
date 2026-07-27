# Prop collision implementation plan

Status: **Ready for implementation**  
Date: **2026-07-27**  
Architecture: [`../prop-collision-architecture.md`](../prop-collision-architecture.md)

## 1. Goal

Add cheap, deterministic, streamed player collision for trees, rocks, placed objects, and procedural constructions.

The release is complete when the player can:

- collide with tree trunks, walls, buildings, fences, and blocking rocks;
- slide along obstacles and corners;
- use real openings such as doors;
- step over low obstacles;
- walk and jump on selected large rocks;
- respect walkable slope limits;
- keep stable collision across render LOD changes, chunk streaming, save/load, and floating-origin rebases;
- complete the existing movement QA scenarios without material frame-time regression or collision readiness gaps.

## 2. Design constraints

- Keep collision readback-free.
- Keep the authoritative CPU terrain heightfield.
- Do not derive collision from visual LOD meshes.
- Do not add a full physics engine in this plan.
- Use primitives wherever they can represent gameplay accurately.
- Use simplified static triangle proxies only for irregular walkable surfaces.
- Reuse deterministic tree/rock placement manifests.
- Reuse the construction spatial index.
- Store collision records in canonical world coordinates.
- Build and unload collision by player-centred chunks.
- Keep configuration in `editor.config.yaml`.
- Keep source files small and responsibility-focused.
- Add instrumentation before tuning.

## 3. Planned source layout

```text
src/editor/collision/
  CollisionWorld.js
  CollisionResidency.js
  CollisionChunk.js
  CollisionSpatialBins.js
  CollisionLayers.js
  CollisionConfig.js
  CollisionIds.js

  character/
    CharacterMotor.js
    CharacterCapsule.js
    CharacterContacts.js
    CharacterSupport.js
    CharacterStep.js

  colliders/
    PrimitiveCollider.js
    CapsuleCollider.js
    BoxCollider.js
    SphereCollider.js
    MeshPrototypeCollider.js
    ColliderBounds.js

  providers/
    TerrainCollisionProvider.js
    TreeCollisionProvider.js
    RockCollisionProvider.js
    ObjectCollisionProvider.js
    ConstructionCollisionProvider.js

  queries/
    collectCandidates.js
    resolveCapsuleMotion.js
    findSupport.js
    queryPrototypeBvh.js

src/editor/placement/
  ObjectPlacementResolver.js

src/editor/ObjectColliderLibrary.js

tests/
  collision*.test.js
```

Names may change when implementation exposes a simpler split, but responsibilities must remain separated.

## 4. Phase summary

| Phase | Deliverable | Player-visible result |
|---|---|---|
| P0 | Baseline, contracts, coordinates, QA fixtures | No gameplay change |
| P1 | Collision world and broadphase | Debug colliders and deterministic residency |
| P2 | Capsule character motor and primitive resolution | Proper walls, sliding, slopes, step-up |
| P3 | Tree trunk collision | Trees block movement consistently |
| P4 | Primitive rock collision | Small clutter ignored; medium rocks block cheaply |
| P5 | Walkable rock proxies and BVHs | Player can walk and jump on large rocks |
| P6 | Placed object collision | Buildings, doors, fences, posts, foundations |
| P7 | Construction collision | Walls, platforms, bridges, ramps, stairs |
| P8 | Streaming, persistence, hardening, performance gates | Release-ready collision slice |

## 5. P0 — Baseline and contracts

### Objective

Establish measurable behaviour and remove coordinate ambiguity before adding collision.

### Tasks

- [ ] Add a collision section to `editor.config.yaml`, disabled by default until P2 is integrated.
- [ ] Add `CollisionConfig.js` validation and immutable defaults.
- [ ] Define explicit cell, canonical-world, and render-local naming conventions.
- [ ] Add conversion tests around `tileSize`, chunk size, negative coordinates, and floating origin.
- [ ] Audit `TreeManifestStore.context()` placed-object blockers.
- [ ] Add a test proving whether `ObjectMap` cell coordinates are converted correctly before world-space blocker use.
- [ ] Fix the existing blocker path if the test confirms a mismatch.
- [ ] Extract the object placement transform from `ObjectView` into `ObjectPlacementResolver`.
- [ ] Keep `ObjectView` behaviour unchanged and add render-placement parity tests.
- [ ] Record current no-collision movement QA baselines.
- [ ] Add a deterministic headed test scene with:
  - [ ] one tree;
  - [ ] one medium rock;
  - [ ] one large walkable rock;
  - [ ] a wall corner;
  - [ ] a doorway;
  - [ ] a step below `stepHeight`;
  - [ ] a step above `stepHeight`;
  - [ ] a ramp with a valid slope;
  - [ ] a ramp above the valid slope;
  - [ ] a construction crossing a chunk boundary.
- [ ] Add debug URL/config switches for collider, broadphase, support, and contact visualisation.

### Acceptance

- Existing tests and build remain green.
- Object rendering is unchanged.
- Coordinate tests cover positive and negative chunks.
- The QA fixture is deterministic across reloads.
- A baseline report exists before collision is enabled.

## 6. P1 — Collision world and broadphase

### Objective

Create a deterministic static collision store with player-centred residency and cheap candidate collection.

### Tasks

#### Core records

- [ ] Define stable collision source IDs.
- [ ] Define collision type and layer constants.
- [ ] Implement immutable primitive and mesh-instance collider records.
- [ ] Store canonical AABBs for every collider.
- [ ] Separate prototype resources from instance records.

#### Chunk ownership

- [ ] Implement `CollisionChunk` with revision and readiness state.
- [ ] Assign colliders to all overlapping chunk references while keeping one canonical owner.
- [ ] Ensure large colliders crossing chunk boundaries are discoverable from either side.
- [ ] Add atomic chunk replacement.
- [ ] Retain previous valid data until replacement is ready.

#### Fine broadphase

- [ ] Implement fixed-size spatial bins inside each collision chunk.
- [ ] Make bin size configurable.
- [ ] Add query-stamp deduplication without steady-state `Set` allocation.
- [ ] Reuse candidate arrays.
- [ ] Query from a swept capsule AABB rather than only the final position.
- [ ] Add large-collider fallback references when a collider spans many bins.

#### Residency

- [ ] Implement player-centred resident and unload radii.
- [ ] Add movement-direction prefetch.
- [ ] Prioritise current chunk and predicted route.
- [ ] Add budgeted build scheduling.
- [ ] Add readiness status to the editor debug API.
- [ ] Define safe movement behaviour when the destination collision chunk is not ready.

#### Debug and counters

- [ ] Draw active collision chunks and bins when debug is enabled.
- [ ] Draw canonical colliders in render-local space.
- [ ] Add active chunk, bin, collider, build, and candidate counters.

### Unit tests

- [ ] chunk ownership at boundaries;
- [ ] negative canonical coordinates;
- [ ] overlapping-chunk references;
- [ ] bin insertion and removal;
- [ ] swept AABB bin selection;
- [ ] candidate deduplication;
- [ ] atomic chunk swap;
- [ ] unload hysteresis;
- [ ] floating-origin invariance.

### Acceptance

- Debug colliders remain fixed in canonical position through a floating-origin rebase.
- Crossing a chunk edge never produces an empty active collision window.
- Candidate collection returns only nearby records in the QA scene.
- Steady-state candidate collection does not allocate per collider or per bin.

## 7. P2 — Capsule character motor

### Objective

Replace point-style prop movement with capsule collision while retaining existing controls, jump feel, and terrain support.

### Tasks

#### State model

- [ ] Add capsule radius and body height to player configuration.
- [ ] Separate capsule foot Y from camera eye Y.
- [ ] Preserve existing `eyeHeight`, jump speed, gravity, walk speed, and run multiplier semantics.
- [ ] Track grounded state, support source ID, support normal, and previous valid position.

#### Primitive collision

- [ ] Implement capsule-versus-sphere.
- [ ] Implement capsule-versus-vertical-capsule/cylinder.
- [ ] Implement capsule-versus-oriented-box.
- [ ] Implement penetration depth and world normal results.
- [ ] Add a skin width for numerical stability.
- [ ] Handle multiple contacts and corners.

#### Motion solver

- [ ] Collect candidates once for the full swept displacement.
- [ ] Add bounded displacement substeps or continuous primitive sweeps where simpler.
- [ ] Resolve penetration iteratively.
- [ ] Project remaining displacement along contact planes.
- [ ] Stop after a configured maximum iteration count.
- [ ] Prevent tunnelling at maximum run speed and clamped frame delta.
- [ ] Preserve movement direction and speed on unobstructed terrain.

#### Terrain support

- [ ] Wrap the existing CPU heightfield as `TerrainCollisionProvider`.
- [ ] Keep terrain support authoritative for ordinary ground.
- [ ] Compute or sample terrain slope under the capsule footprint.
- [ ] Keep current ground-snap behaviour until prop support is added.

#### Slope and step

- [ ] Add maximum walkable slope.
- [ ] Reject uphill movement on overly steep surfaces.
- [ ] Add grounded-only step-up attempt.
- [ ] Check upward clearance, horizontal clearance, and downward support.
- [ ] Reject narrow, too-high, or unsupported steps.
- [ ] Keep airborne players from autostepping.

#### Integration

- [ ] Connect `PlayerController` to `CollisionWorld` and `CharacterMotor`.
- [ ] Convert render-local player capsule to canonical coordinates once per update.
- [ ] Convert resolved movement back to render-local state.
- [ ] Preserve harness control and `setPose` behaviour.
- [ ] Add collision state to `getStatus()` without exposing internal mutable objects.

### Unit tests

- [ ] wall stop;
- [ ] wall slide;
- [ ] inside-corner resolution;
- [ ] outside-corner movement;
- [ ] low-step acceptance;
- [ ] high-step rejection;
- [ ] airborne step rejection;
- [ ] valid-slope support;
- [ ] steep-slope rejection/slide;
- [ ] jump and landing;
- [ ] maximum-speed tunnelling fixture;
- [ ] zero-delta and clamped-delta behaviour.

### Acceptance

- Existing terrain walking still feels equivalent in the baseline route.
- The player capsule cannot cross primitive walls in the QA scene.
- The player slides along a long wall and around a corner.
- Low and high step fixtures behave according to configuration.
- No NaN or unbounded solver iteration is possible.

## 8. P3 — Tree trunk collision

### Objective

Make trees block the player with minimal memory and query cost.

### Tasks

- [ ] Expose read-only active tree manifest placements for collision residency.
- [ ] Derive one trunk collider profile per tree prototype from trunk-part geometry.
- [ ] Ignore leaf geometry and wind deformation.
- [ ] Support configuration overrides for unusual trunk assets.
- [ ] Scale radius and height with tree placement scale.
- [ ] Use the same canonical position and ground height as rendering.
- [ ] Use stable tree placement IDs as collider source IDs.
- [ ] Rebuild tree collision chunks only when manifest/prototype collision signatures change.
- [ ] Remove colliders for cut/edited trees.
- [ ] Add trunk collider debug rendering by prototype.

### Derivation rules

Initial automatic derivation should:

- inspect only parts classified as `trunk`;
- use lower trunk bounds rather than canopy/branch spread;
- reject implausible radius/height results;
- clamp to configured minimum radius;
- log the prototype and require an override when derivation is invalid.

Do not silently use the full tree bounding box.

### Tests

- [ ] prototype trunk extraction;
- [ ] authored scale handling;
- [ ] generated species handling;
- [ ] planted tree handling;
- [ ] cut-tree removal;
- [ ] deterministic source IDs;
- [ ] visual LOD independence;
- [ ] tree collision through a floating-origin rebase.

### Acceptance

- The player cannot pass through trunks.
- Canopies and branches do not create invisible walls.
- Tree impostor transitions do not change collision.
- Dense forest candidate counts remain bounded by spatial bins.

## 9. P4 — Primitive rock collision

### Objective

Classify rock instances cheaply before introducing walkable mesh queries.

### Tasks

- [ ] Expose active rock manifest placements and prototype bounds to collision residency.
- [ ] Measure prototype local bounds and representative dimensions.
- [ ] Define configuration-driven decorative, blocking, and walkable classification.
- [ ] Give decorative stones no solid collider.
- [ ] Generate sphere/ellipsoid/capsule compounds for medium blockers.
- [ ] Include rock scalar scale, Y rotation where relevant, and burial offset.
- [ ] Use stable rock placement IDs.
- [ ] Share primitive profile by prototype.
- [ ] Add per-tier counts and debug colours.

### Classification cautions

- Height alone is not enough for final production classification.
- Asset-level overrides must be supported.
- A rock marked walkable must not fall back silently to a blocking sphere after P5.
- Decorative thresholds must be validated against player radius and movement feel.

### Tests

- [ ] decorative rocks do not block;
- [ ] medium rocks block and slide correctly;
- [ ] burial parity with rendering;
- [ ] rotation/scale parity;
- [ ] deterministic classification;
- [ ] removal and manifest revision handling.

### Acceptance

- Ground clutter does not make movement jittery.
- Medium boulders block without triangle queries.
- Candidate and primitive-test counters remain stable in scree clusters.

## 10. P5 — Walkable rock proxies and BVHs

### Objective

Allow the player to walk and jump on large irregular rocks using simplified reusable collision proxies.

### Dependency

- [ ] Add and exactly pin a `three-mesh-bvh` version compatible with the pinned Three.js release.
- [ ] Add licence/notice handling if required by repository policy.
- [ ] Add focused dependency integration tests before using it in the movement loop.

### Asset contract

- [ ] Reserve collision node names such as `COLLIDER` and `COLLIDER_WALKABLE`.
- [ ] Extend asset extraction to preserve/extract collision proxy nodes.
- [ ] Add a collision manifest keyed by asset and prototype.
- [ ] Validate local origin, units, transform, bounds, winding, degenerate triangles, and empty proxies.
- [ ] Validate that a walkable proxy overlaps the visual prototype bounds reasonably.
- [ ] Record proxy triangle counts.
- [ ] Fail production validation when a walkable asset has no valid proxy.

### Fallback generation

- [ ] Provide a development-only simplified proxy generator for assets without authored proxies.
- [ ] Run simplification after all geometry-changing operations.
- [ ] Mark generated fallback proxies in QA and the manifest.
- [ ] Do not treat fallback quality as production acceptance.

### Prototype resources

- [ ] Build one BVH per collision proxy prototype.
- [ ] Share it across all instances.
- [ ] Centre/normalise proxy geometry only when the visual/collision transform contract remains exact.
- [ ] Store inverse-transform scratch state without per-query allocation.
- [ ] Dispose prototype BVHs when their variant residency is released.
- [ ] Consider serialisation/offline preparation only after measuring startup build cost.

### Query implementation

- [ ] Transform the capsule/sweep into prototype-local space.
- [ ] Query candidate BVH nodes with `shapecast` or the smallest suitable direct query.
- [ ] Compute capsule-triangle closest points and penetration.
- [ ] Transform contact points and normals back to canonical world space.
- [ ] Filter support triangles by normal and vertical relation.
- [ ] Prevent undersides from becoming support.
- [ ] Combine rock support with terrain support and choose the highest valid surface.
- [ ] Reuse broadphase candidates across horizontal, vertical, and support subqueries where valid.

### Movement behaviour

- [ ] Walk onto a rock through a valid slope or step.
- [ ] Reject near-vertical sides.
- [ ] Land on rock surfaces after a jump.
- [ ] Walk down from rock to terrain using snap rules.
- [ ] Fall when no valid support remains.
- [ ] Avoid edge oscillation between terrain and rock support.
- [ ] Avoid snapping to an upper surface through the side or underside.

### Tests

- [ ] local/world transform round-trip;
- [ ] rotated and scaled instance queries;
- [ ] capsule-triangle penetration;
- [ ] support normal filtering;
- [ ] underside rejection;
- [ ] ledge and edge behaviour;
- [ ] jump landing;
- [ ] rock-to-terrain transition;
- [ ] shared BVH identity across instances;
- [ ] visual LOD independence;
- [ ] invalid/missing proxy validation.

### Headed acceptance battery

Use at least three representative rock prototypes:

1. rounded boulder with an accessible top;
2. long sloped rock with a ridge;
3. irregular scanned rock with concavity or ledges.

For each:

- [ ] approach from four directions;
- [ ] walk around the base;
- [ ] climb where valid;
- [ ] reject steep faces;
- [ ] jump onto the top;
- [ ] jump off and land on terrain;
- [ ] stand on it during a render LOD transition;
- [ ] stand on it during a floating-origin rebase where practical.

### Acceptance

- Selected large rocks are genuinely walkable.
- The player never teleports to a rock top from its side.
- Full visual rock meshes are not used as production colliders.
- BVH count equals active prototype resources, not rock instance count.

## 11. P6 — Placed object collision

### Objective

Add accurate cheap collision for procedural buildings and placeable props while preserving openings.

### Tasks

#### Collision library

- [ ] Add `ObjectColliderLibrary.js` parallel to `ObjectModelLibrary.js`.
- [ ] Share dimension constants/helpers where possible without coupling rendering to collision.
- [ ] Return primitive/compound collider descriptions in object-local coordinates.
- [ ] Support optional walkable surface records.
- [ ] Validate collider bounds against the reserved object footprint.

#### Catalog schema

- [ ] Extend `config/objects.yaml` schema with optional collision overrides.
- [ ] Define default behaviour per model/category.
- [ ] Add explicit `none`, `solid`, `trigger`, and `walkable` policy.
- [ ] Reject unknown collision types or invalid dimensions.

#### Initial model coverage

- [ ] cottages and inns: wall boxes with door openings;
- [ ] market stall: posts/counter, open walking space;
- [ ] blacksmith and chapel: walls and entrance openings;
- [ ] towers/keeps/watchtowers: outer blockers plus entrances;
- [ ] walls: oriented box;
- [ ] fences: rails and posts;
- [ ] wells/fountains/statues: simple compounds;
- [ ] lamp posts: capsules;
- [ ] campfire/crop field/bush: no solid collision or trigger only;
- [ ] placeable tree/boulder definitions: use the same tree/rock collider policy rather than duplicate rules.

#### Runtime provider

- [ ] Subscribe to `ObjectMap` changes.
- [ ] Use `ObjectPlacementResolver` for exact world transforms.
- [ ] Update only overlapping collision chunks.
- [ ] Preserve stable IDs through transform, undo, redo, save, and load.
- [ ] Remove colliders immediately/atomically with object removal.

### Tests

- [ ] door opening remains passable;
- [ ] wall surfaces block and slide;
- [ ] foundation placement parity;
- [ ] normal-aligned object parity;
- [ ] rotation parity for all four quarter turns;
- [ ] transform/undo/redo collision update;
- [ ] save/load collider signature equality;
- [ ] collider bounds stay inside the authoring contract unless explicitly allowed.

### Acceptance

- Buildings no longer behave as one solid footprint.
- Doors and intended open spaces are usable.
- All currently placeable solid categories have a defined policy.
- Object edits do not force a global collision rebuild.

## 12. P7 — Procedural construction collision

### Objective

Compile cheap collision alongside construction render geometry.

### Tasks

#### Compiler output

- [ ] Add collision output to the construction compiler result.
- [ ] Use the same path, dimensions, and source revision as render output.
- [ ] Produce deterministic local/world IDs for collider segments.
- [ ] Keep render and collision compilation independently replaceable.

#### Shape policy

- [ ] straight wall: one oriented box where possible;
- [ ] curved wall: overlapping oriented boxes with configurable segment length;
- [ ] fence: sparse posts and rails;
- [ ] floor/platform: box or walkable mesh;
- [ ] bridge/deck: walkable top plus side blockers;
- [ ] ramp/stairs: ramp support shape plus side blockers;
- [ ] complex ruin: simplified triangle proxy only when primitives are inadequate.

#### Spatial rebuild

- [ ] Reuse `ConstructionSpatialIndex` to identify affected chunks.
- [ ] Partition long walkable meshes by collision chunk.
- [ ] Build/rebuild only affected chunk resources.
- [ ] Queue heavy construction BVH work outside the movement query.
- [ ] Swap new collision data atomically.
- [ ] Keep old valid collision until replacement is ready.

### Tests

- [ ] straight and curved wall blocking;
- [ ] no gaps at segment joins;
- [ ] construction crossing a chunk edge;
- [ ] edited curve rebuild scope;
- [ ] deletion cleanup;
- [ ] platform support;
- [ ] bridge traversal;
- [ ] stair/ramp step and slope behaviour;
- [ ] floating-origin invariance.

### Acceptance

- Curved walls have no player-sized collision gaps.
- Walkable construction surfaces support the player.
- Editing one construction does not rebuild unrelated collision chunks.
- Construction rendering and collision remain aligned after repeated edits.

## 13. P8 — Streaming, persistence, QA, and hardening

### Objective

Turn the feature set into a release-ready, measured system.

### Streaming and readiness

- [ ] Integrate collision prefetch with player velocity.
- [ ] Add readiness to walk-mode loading status.
- [ ] Block unsafe entry into an unready collision chunk.
- [ ] Test rapid direction reversal at chunk borders.
- [ ] Test teleport/map travel into an unloaded region.
- [ ] Test save/load while standing on a walkable prop.

### Floating origin

- [ ] Rebase while touching a wall.
- [ ] Rebase while standing on a rock.
- [ ] Rebase while inside a construction.
- [ ] Prove collider signatures and canonical bounds do not change on rebase.
- [ ] Prove debug geometry is the only collision-related representation shifted.

### Persistence

- [ ] Keep generated natural collision deterministic and derived, not separately saved.
- [ ] Persist only authored object/construction source state and asset collision metadata.
- [ ] Reproduce identical collision IDs/signatures after reload.
- [ ] Version collision-affecting document schema changes explicitly.

### Error handling

- [ ] Log provider failures with source, prototype, and chunk context.
- [ ] Fail validation for required missing walkable proxies.
- [ ] Avoid movement into unknown/failed collision space.
- [ ] Expose collision readiness/failure in the dev API and QA report.
- [ ] Add cleanup tests for asset load failure and disposal.

### Performance QA

Add scenarios:

- [ ] open-ground run baseline;
- [ ] dense forest run;
- [ ] scree field traversal;
- [ ] walkable rock climb loop;
- [ ] dense object town;
- [ ] long curved wall traversal;
- [ ] repeated collision chunk crossing;
- [ ] floating-origin rebase during movement;
- [ ] construction edit/rebuild while nearby.

Capture:

- frame p50/p95/p99/max;
- movement/player phase time;
- collision total/broadphase/narrow-phase/support times;
- candidate and narrow-phase counts;
- primitive and BVH query counts;
- collision chunk build time and queue depth;
- active colliders and prototype BVHs;
- collision readiness misses;
- hitches with phase attribution.

### Performance gate

The provisional p95 collision target is no more than five per cent of a 16.67 ms frame, approximately 0.83 ms, in representative steady-state walking scenarios.

This is a target, not a current measurement. The final gate must be based on repeated A/B captures against the P0 baseline and may be revised with documented evidence.

No acceptance run may hide collision cost inside an unlabelled player phase.

## 14. Acceptance matrix

| Behaviour | Unit | Integration | Headed |
|---|---:|---:|---:|
| Tree trunk blocking | yes | yes | yes |
| Wall slide | yes | yes | yes |
| Door opening | no | yes | yes |
| Low/high step | yes | yes | yes |
| Walkable slope | yes | yes | yes |
| Steep slope rejection | yes | yes | yes |
| Walkable rock | yes | yes | yes |
| Rock underside rejection | yes | yes | yes |
| Jump landing on rock | yes | yes | yes |
| Construction platform | yes | yes | yes |
| Chunk-border continuity | yes | yes | yes |
| Floating-origin invariance | yes | yes | yes |
| LOD independence | yes | yes | yes |
| Save/load determinism | yes | yes | optional |
| Removal/edit cleanup | yes | yes | yes |
| Readiness boundary | yes | yes | yes |
| Performance budget | no | report | report |

## 15. Required QA report additions

Add a collision section to movement QA JSON:

```json
{
  "collision": {
    "enabled": true,
    "timingsMs": {
      "total": {},
      "broadphase": {},
      "narrowPhase": {},
      "support": {},
      "chunkBuild": {}
    },
    "counts": {
      "candidates": 0,
      "primitiveTests": 0,
      "bvhQueries": 0,
      "triangleTests": 0,
      "contacts": 0,
      "stepAttempts": 0,
      "stepSuccesses": 0,
      "activeChunks": 0,
      "activePrimitiveColliders": 0,
      "activeMeshInstances": 0,
      "prototypeBvhs": 0,
      "readinessMisses": 0
    }
  }
}
```

Use the existing histogram/report conventions instead of introducing another statistics implementation.

## 16. Test and implementation rules

- Add tests with each phase, not after all phases.
- Keep no-collision and collision-enabled movement fixtures comparable.
- Avoid random tests unless their seed and failing case are printed.
- All world placements used by tests must be deterministic.
- Do not test private render mesh internals as collision authority.
- Do not add visual meshes solely to make tests pass.
- Do not mock away coordinate transforms in integration tests.
- Do not accept a phase with debug-only manual evidence when deterministic automation is possible.
- Keep fallback proxy usage visible in reports.
- Mark unfinished required work with `TODO` in code and unchecked items here.

## 17. Rollout

### Development switches

Support:

```text
?collision=0|1
?collisionDebug=colliders|bins|contacts|support
?collisionFreeze=1
```

Exact query names may follow existing QA parameter conventions.

### Enablement order

1. Merge P0/P1 with collision disabled by default.
2. Enable primitive collision in targeted QA.
3. Enable tree and primitive rock collision in normal walk mode after P3/P4 acceptance.
4. Add walkable rocks after proxy validation and P5 headed evidence.
5. Add objects and constructions incrementally by category.
6. Make collision default-on only after P8 performance and readiness gates pass.

### Fallback behaviour

- `collision.enabled: false` restores current heightfield-only player movement for A/B testing.
- A collider category may be disabled independently during development.
- An asset marked production-walkable cannot silently fall back to no collider or a sphere.

## 18. Deferred work

Explicitly deferred:

- GPU voxel collision;
- dynamic rigid bodies;
- moving platforms;
- pushable props;
- physical destruction and debris;
- vehicles;
- ragdolls;
- multiplayer prediction/reconciliation;
- navmesh or crowd collision;
- projectile collision beyond reserved layers;
- physics-based foliage.

Each deferred item requires a separate design decision. Do not expand this plan during implementation without updating the architecture document.

## 19. Definition of done

All of the following must be true:

- [ ] P0-P8 required tasks are complete or explicitly removed with documented rationale.
- [ ] Trees, blocking rocks, placed objects, and constructions have defined collision policies.
- [ ] Representative large rocks are walkable through simplified proxies.
- [ ] Doors and intentional openings remain passable.
- [ ] Collision is independent from visual LOD.
- [ ] Collision remains correct across chunk boundaries and floating-origin rebases.
- [ ] Save/load reproduces stable authored collision state.
- [ ] No GPU geometry readback was introduced.
- [ ] No full visual mesh is used as a production collider without a documented exception and measured evidence.
- [ ] Movement QA includes collision timings and counts.
- [ ] Performance A/B evidence passes the agreed gate.
- [ ] Asset validation fails invalid required proxies.
- [ ] All automated tests, asset validation, build, and headed acceptance are green.
- [ ] The architecture document reflects the final implementation rather than an obsolete proposal.

## 20. Primary references

Repository:

- [`../prop-collision-architecture.md`](../prop-collision-architecture.md)
- `src/editor/player/PlayerController.js`
- `src/editor/player/PlayerPhysics.js`
- `src/editor/stylized/StylizedRockView.js`
- `src/editor/stylized/StylizedTreeView.js`
- `src/editor/stylized/TreeManifestStore.js`
- `src/editor/ObjectMap.js`
- `src/editor/ObjectView.js`
- `src/editor/construction/ConstructionSpatialIndex.js`
- `docs/object-pipeline.md`

External primary documentation:

- <https://github.com/gkjohnson/three-mesh-bvh>
- <https://threejs.org/docs/pages/Octree.html>
- <https://rapier.rs/docs/user_guides/javascript/character_controller/>
