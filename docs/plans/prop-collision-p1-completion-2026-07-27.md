# Prop collision P1 completion

Date: **2026-07-27**  
Branch: `agent/prop-collision-p1`  
Base: `main` at `85ecad4e24f812b6f0f68f4412bd8a79f2d48636`  
Parent plan: [`prop-collision-implementation-plan-2026-07-27.md`](prop-collision-implementation-plan-2026-07-27.md)

## Implemented

### Core records

- Stable collision source IDs, including encoded manifest IDs.
- Collision type and layer constants.
- Immutable primitive and mesh-instance records.
- Canonical AABBs on every collider.
- Separate immutable prototype descriptors.

### Collision chunks and ownership

- Canonical owner chunks with references in every overlapped chunk.
- Cross-boundary colliders are discoverable from either side.
- Owner readiness is separate from receiving a neighbour reference.
- Atomic owner-chunk replacement builds every affected chunk before committing.
- Failed replacement leaves the previous valid collision data untouched.
- Owner unload removes canonical records and all references.

### Fine broadphase

- Configurable fixed-size X/Z bins per collision chunk.
- Query-stamp deduplication without a per-query `Set`.
- Caller-owned and internal candidate arrays are reused.
- Queries consume a full swept capsule AABB.
- Large colliders use fallback references instead of occupying every bin.

### Residency

- Player-centred resident and unload radii.
- Movement-direction route prefetch.
- Current and predicted route priority.
- Build-count and time budgets.
- Ready, desired, queued, and loaded status.
- Explicit not-ready policy: retain the previous valid player position when P2 connects movement.

### Debug and QA

- Canonical collider, active chunk, and active bin visualisation.
- Debug root follows floating-origin translation without mutating collision records.
- Active chunk, ready chunk, collider, bin, candidate, queue, build, and timing counters.
- `?qa=collision-p1&download=0` deterministic fixture and browser status API.
- P1 QA enables collider and broadphase drawing automatically.

## Runtime scope

P1 does not change player movement. The runtime activates only when:

- `config.collision.enabled` is true;
- `qa=collision-p1`; or
- a collision debug flag is enabled.

`PlayerController` and the main animation loop remain unchanged. P2 will consume `querySweptCapsule` and `checkMovementReadiness`.

## Current-main integration

The final branch was rebuilt from `main` at `85ecad4e24f812b6f0f68f4412bd8a79f2d48636` after newer forest rendering and inventory-planning commits landed.

- No forest, tree LOD, impostor, dither, or inventory-plan file is modified by P1.
- Current `TreeManifestStore` behaviour is preserved.
- P1 remains an independent static collision subsystem and QA runtime.

## Browser API

```js
window.__editor.collision
window.__collisionP1Qa
```

Expected headed status after resident chunks build:

```js
window.__collisionP1Qa.status === 'ready'
```

The P1 QA object includes the fixture descriptor, world/residency status, and a deterministic nearby-candidate sample.

## Verification

Automated tests cover:

- stable IDs and immutable records;
- prototype/instance separation;
- bin insertion, removal, fallback, and deduplication;
- swept-route candidate selection;
- chunk boundaries and overlapping references;
- atomic rollback;
- negative canonical coordinates;
- floating-origin invariance;
- current/predicted build priority;
- unload hysteresis;
- destination readiness and safe policy;
- QA/runtime activation contracts.

A normal checkout still needs to run:

```bash
npm test
npm run build
```

Headed acceptance:

```text
http://localhost:5173/?qa=collision-p1&download=0
```
