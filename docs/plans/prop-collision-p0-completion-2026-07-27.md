# Prop collision P0 completion

Date: **2026-07-27**  
Branch: `agent/prop-collision-p0`  
Parent plan: [`prop-collision-implementation-plan-2026-07-27.md`](prop-collision-implementation-plan-2026-07-27.md)

## Implemented

- [x] Collision configuration loaded into `config.collision` and disabled by default.
- [x] Immutable defaults and validation in `CollisionConfig.js`.
- [x] Explicit cell, canonical-world, render-local, and prototype-local coordinate contract.
- [x] Positive/negative cell, chunk-boundary, and floating-origin conversion tests.
- [x] Current `main` canonical construction blocker conversion audited and preserved.
- [x] Shared `ObjectPlacementResolver` used by `ObjectView`.
- [x] Object and foundation transform parity tests.
- [x] Pre-collision movement baseline record.
- [x] Deterministic headed P0 fixture with the planned obstacle set.
- [x] URL/config switches for collider, broadphase, support, and contact debugging.

## Conflict resolution

The branch was rebased onto `main` at `7e495004d9dcea35e12f4d7aead8352e34bec798`.

- Water-domain and collision configuration loading are both retained.
- The latest spatially indexed `ObjectMap` and `TreeManifestStore` blocker implementation is retained.
- The older P0 full-map blocker helper was removed rather than overriding the newer indexed path.
- Latest tree and bush LOD work remains unchanged.

## Deliberately not implemented

P0 changes no player collision behaviour. It does not add a collision world, broadphase residency, a player capsule motor, primitive collision, mesh/BVH collision, or walkable-rock support.

## Runtime contracts

```text
config.collision.enabled === false
```

Headed fixture:

```text
?qa=collision-p0&download=0
```

Debug switches:

```text
?collisionDebug=all
?collisionDebug=colliders,broadphase
?collisionColliders=1&collisionContacts=0
```
