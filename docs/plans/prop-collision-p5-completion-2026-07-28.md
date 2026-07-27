# Prop collision P5 completion

Date: **2026-07-28**  
Branch: `agent/prop-collision-p5-walkable-rocks`  
Parent plan: [`prop-collision-implementation-plan-2026-07-27.md`](prop-collision-implementation-plan-2026-07-27.md)

## Delivered

P5 replaces the P4 blocking-only fallback for large rocks with reusable simplified
triangle proxies and one static BVH per rock prototype.

### Asset contract

Rock GLBs may contain collision-only mesh nodes named:

```text
COLLIDER
COLLIDER_WALKABLE
COLLIDER_WALKABLE_<visual-node-name>
COLLIDER_WALKABLE_<prototype-index>
```

Reserved collider nodes:

- never become render prototypes;
- are transformed into the same grounded, centred local frame as their visual rock;
- are validated as real mesh nodes by `validate:assets`;
- can be made mandatory through `collision.rocks.requireAuthoredProxy`.

When an authored proxy is unavailable and generated fallback is enabled, P5 creates
a deterministic bounded convex proxy from the visual geometry. Generated proxies
are reported explicitly in status and counters; they are not silently treated as
authored assets.

### Prototype resources

Each walkable rock prototype owns one immutable collision descriptor with:

- simplified `BufferGeometry`;
- validated finite, non-degenerate triangles;
- a hard `maximumProxyTriangles` limit;
- one `three-mesh-bvh` hierarchy;
- local canonical bounds;
- authored/generated metadata;
- explicit disposal.

All world placements reference that prototype by ID. BVHs are never duplicated per
rock instance.

### Instance transforms

Walkable rock placements preserve the P4 canonical transform contract:

- canonical X/Z;
- terrain ground height;
- visual burial amount;
- authored scalar scale;
- Y rotation;
- canonical owner chunk.

Mesh instances require positive uniform scale. Their canonical AABB is transformed
from the prototype bounds and participates in the existing chunk/bin broadphase.

### Character queries

The character motor now dispatches mesh-instance candidates through BVH queries.

Side collision:

1. Transform the character capsule into prototype-local space.
2. Shape-cast the local capsule bounds through the prototype BVH.
3. Compute capsule-segment to triangle distance.
4. Select the deepest deterministic horizontal push-out.
5. Transform the contact normal back to canonical world space.

Support collision:

1. Query only triangles inside the capsule support window.
2. Reject vertical, underside, and over-slope triangles.
3. Sample the centre and four footprint offsets.
4. Choose the highest valid support within the configured up/down window.
5. Return the real triangle normal and canonical support height.

This prevents side-to-top teleporting while allowing stable movement across valid
rock surfaces.

### Jump landing

Airborne movement widens support search only by the predicted downward travel for
the current fixed/clamped frame. This allows landing on a rock during a fall without
turning distant upper surfaces into ground snap targets.

### P4 compatibility

- Decorative stones still produce no collider.
- Medium rocks still use cheap primitive blockers.
- Only walkable-class rocks use mesh-instance collision.
- Tree and rock contributions still replace owner chunks atomically through
  `NaturalCollisionProvider`.
- Render LOD, fades, dither, materials, and GPU state remain outside collision
  authority.

### Configuration

```yaml
rocks:
  maximumProxyTriangles: 96
  bvhMaxLeafTriangles: 4
  minimumProxyOverlapRatio: 0.35
  allowGeneratedProxyFallback: true
  requireAuthoredProxy: false
```

For a production authored-only asset gate:

```yaml
rocks:
  allowGeneratedProxyFallback: false
  requireAuthoredProxy: true
```

### Telemetry

P5 adds or completes:

```text
collisionRockMeshPrototypes
collisionRockMeshTriangles
collisionRockGeneratedPrototypes
collisionRockWalkableInstances
collisionRockGeneratedProxyInstances
collisionMeshQueries
collisionMeshTriangleTests
collisionMeshContacts
collisionMeshSupportQueries
collisionMeshSupportTriangleTests
collisionMeshSupportHits
```

## Automated coverage

Focused tests cover:

- BVH prototype validation and sharing;
- rotated/scaled mesh instances;
- side contacts and deterministic push-out;
- top support and underside rejection;
- tall-side blocking without top teleport;
- stable walking across the top;
- airborne landing support;
- generated proxy limits and overlap;
- authored-only failure behaviour;
- collision-only node extraction and grounding parity;
- P5 configuration validation;
- replacement of the P4 walkable fallback while preserving P4 medium/decorative
  contracts.

## Dependency

`three-mesh-bvh` is pinned exactly to `0.9.13`. See
[`../licenses/three-mesh-bvh.md`](../licenses/three-mesh-bvh.md).

## Required verification

```bash
npm test
npm run build
npm run validate:assets
```

Then complete the headed battery in
[`../qa/prop-collision-p5-walkable-rocks-2026-07-28.md`](../qa/prop-collision-p5-walkable-rocks-2026-07-28.md).

## Deferred

- Placed object and building collision: P6.
- Procedural construction collision: P7.
- Final persistence, stress and release hardening: P8.
