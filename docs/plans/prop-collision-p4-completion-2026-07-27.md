# Prop collision P4 completion

Date: **2026-07-27**  
Branch: `agent/prop-collision-p4-rocks`  
Base reviewed: `b4ac180ff40d0acc680977a2ae298aa35cfaa38f`  
Parent plan: [`prop-collision-implementation-plan-2026-07-27.md`](prop-collision-implementation-plan-2026-07-27.md)

## Delivered

### Canonical rock source

P4 reads deterministic rock manifests from `StylizedRockView.manifestForChunk()`.

Collision authority uses:

- stable placement ID;
- canonical X/Z and terrain height;
- owner chunk;
- prototype index after biome selection;
- authored scalar scale;
- Y rotation;
- the same burial fraction and prototype height used by rendering.

Collision does not use:

- rendered `InstancedMesh` matrices;
- near/proxy LOD selection;
- fades, dither, material state, or active render instance counts;
- GPU buffers or readbacks.

Rock variants stream by biome. `RockCollisionSource` therefore derives profiles lazily and invalidates loaded collision chunks when `prototypeRevision` changes.

### Prototype profiles

Each authored rock prototype receives one immutable primitive profile from its local geometry bounds.

Automatic shapes:

- near-uniform bounds: sphere;
- ordinary anisotropic bounds: ellipsoid;
- tall approximately radial bounds: vertical capsule;
- long horizontal bounds: two-ellipsoid compound.

Profiles retain local centre, width, height, depth, primitive parts, and stable asset key. Multi-prototype assets use `asset#0`, `asset#1`, and so on.

### Tier policy

Each placement is classified after applying its authored scale.

- `decorative`: below the configured collidable height **or** footprint threshold; no solid collider;
- `blocking`: medium rock represented by one or two primitive blockers;
- `walkable`: large rock identified for P5, but represented by an explicit blocking-only P4 fallback.

A walkable-class rock never silently presents its primitive as accurate walkable support. Its prototype ID is marked with `p4-fallback`, debug rendering is purple, and telemetry counts it as `walkablePending`.

Configuration supports stable asset overrides:

```yaml
rocks:
  prototypeOverrides:
    assets/rocks/ridge.glb:
      tier: walkable
      shape: compound
      collisionScale: 0.9
```

Supported tiers: `auto`, `decorative`, `blocking`, `walkable`.

Supported shapes: `auto`, `sphere`, `ellipsoid`, `capsule`, `compound`.

### Primitive records

Every non-decorative placement emits deterministic records:

```text
rock:<encoded stable placement id>:primitive-0
rock:<encoded stable placement id>:primitive-1
```

Records are blocking-only in P4. Scale, local centre offset, Y rotation, and burial are applied before canonical AABBs are calculated.

Ellipsoid contacts use all three radii and Y rotation. Compound parts are queried independently and deduplicated by stable source ID.

### Natural-provider ownership

P3 originally allowed one tree provider to own the complete collision chunk. P4 cannot add a second provider by replacing that same owner independently, because a rock refresh would delete tree records.

`NaturalCollisionProvider` now:

- builds tree and rock contributions independently;
- combines and sorts them deterministically;
- performs one atomic owner-chunk replacement;
- records provider state only after `CollisionWorld` accepts the swap;
- preserves previous valid tree-plus-rock data on failure;
- retries failed refresh work under the configured per-frame limit;
- removes provider bookkeeping when residency unloads an owner chunk.

### Runtime and QA

Normal worlds compose trees and rocks through the natural provider. P1/P2 retain their deterministic fixture provider.

P4 QA:

```text
http://localhost:5173/?qa=collision-p4&download=0
```

The QA route temporarily widens collision residency to two chunks, waits for a real non-decorative rock, positions the player south of it, and runs toward it.

Ready contract:

```js
window.__collisionP4Qa.status === 'ready'
window.__collisionP4Qa.target != null
window.__collisionP4Qa.collision.provider.components.rocks.colliders > 0
```

### Debug and telemetry

Debug colours:

- orange: blocking rock primitive;
- purple: walkable-class P4 fallback;
- deterministic prototype colours: tree trunks;
- no helper: decorative rock.

New or completed counters:

```text
collisionRockProfiles
collisionRockChunkBuilds
collisionRockChunkRefreshes
collisionRockRefreshMs
collisionRockChunks
collisionRockColliders
collisionRockRefreshQueueDepth
collisionRockDecorativeInstances
collisionRockBlockingInstances
collisionRockWalkablePendingInstances
collisionPrimitiveTests
collisionNaturalRefreshQueueDepth
```

## Automated coverage added

- deterministic prototype measurement and shape selection;
- height-plus-footprint tier classification;
- flat and narrow clutter suppression;
- stable asset overrides and immutable configuration;
- lazy biome-variant profile arrival;
- render-LOD-independent source epochs;
- burial, scale, local offset, and rotation parity;
- stable compound source IDs;
- decorative no-collider policy;
- explicit walkable fallback marking;
- rotated ellipsoid narrow phase;
- manifest-derived rock blocking and sliding through `CharacterMotor`;
- atomic tree-plus-rock contribution replacement;
- failed refresh retention and retry;
- provider unload cleanup;
- P3 composition compatibility;
- P4 QA registration.

## Required verification

This connected environment cannot resolve GitHub from the execution container, so it cannot clone the repository or execute the complete dependency graph.

Before marking the PR ready, run:

```bash
npm test
npm run build
```

Then complete the headed battery in [`../qa/prop-collision-p4-rock-primitives-2026-07-27.md`](../qa/prop-collision-p4-rock-primitives-2026-07-27.md).

## Explicitly deferred

P4 does **not** make irregular large rocks genuinely walkable. That requires P5:

- authored or generated simplified triangle proxies;
- one reusable BVH per prototype;
- transformed capsule/triangle queries;
- support-normal and underside filtering;
- jump landing and rock-to-terrain transitions.

Until P5 lands, large rocks are safe blockers rather than inaccurate primitive walkable surfaces.
