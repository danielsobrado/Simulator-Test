# Prop collision P1 completion

Date: **2026-07-27**  
Original branch: `agent/prop-collision-p1`  
First review-fix branch: `agent/prop-collision-p1-review-fixes`  
Second review-fix branch: `agent/prop-collision-p1-review-fixes-2`  
P1 merge commit: `4aa5976585164040c061372e2fdd53110ddcdb23`  
First review-fix merge commit: `5d4e6a187d9ee42f12190c315ea6d950fb29a7cd`  
Parent plan: [`prop-collision-implementation-plan-2026-07-27.md`](prop-collision-implementation-plan-2026-07-27.md)

## Implemented

### Core records

- Stable collision source IDs, including encoded manifest IDs.
- Collision type and layer constants.
- Immutable primitive and mesh-instance records.
- Canonical AABBs on every collider.
- Separate immutable prototype descriptors.
- Safe-integer chunk keys and coordinates.
- Positive primitive dimensions and supported layer-mask validation.
- Collider and prototype factories brand validated descriptors; the world rejects hand-built substitutes.
- Prototype metadata is copied and deeply frozen, including arrays and reserved keys.
- Mesh-instance colliders require a registered prototype.

### Collision chunks and ownership

- Canonical owner chunks with references in every overlapped chunk.
- Cross-boundary colliders are discoverable from either side.
- Owner readiness is separate from receiving a neighbour reference.
- Atomic owner-chunk replacement builds every affected chunk before committing.
- Failed replacement leaves the previous valid collision data untouched.
- Equal or stale owner revisions cannot overwrite valid data.
- Collider bounds must overlap their declared owner chunk.
- Configurable and globally bounded chunk-span limits prevent one collider from materialising an excessive reference set.
- Owner unload removes canonical records and all references.

### Fine broadphase

- Configurable fixed-size X/Z bins per collision chunk.
- Query-stamp deduplication without a per-query `Set`.
- Caller-owned and internal candidate arrays are reused.
- Queries consume a full swept capsule AABB.
- Large colliders use fallback references instead of occupying every bin.
- Candidate collection scans active collision chunks rather than materialising every chunk crossed by a long sweep.
- Candidate results are sorted by stable source ID so narrowphase input does not depend on chunk build order.
- Readiness reports cap missing-key output and expose truncation.
- Chunk enumeration and per-chunk bin allocation have hard safety ceilings.

### Residency

- Player-centred resident and unload radii.
- Movement-direction route prefetch.
- Current and predicted route priority.
- Prediction distance is bounded before canonical-to-chunk conversion.
- Stale queue entries are pruned before sorting or flushing.
- Queued priorities are recomputed from the latest movement direction.
- Build-count and time budgets apply to attempts, including failed or stale jobs.
- A later success cannot hide an earlier failure from the same flush.
- Direct residency construction validates radii, time values, and work ceilings.
- Ready, desired, queued, and loaded status.
- Disposal clears queued work, focus state, errors, and query counters.
- Explicit not-ready policy: retain the previous valid player position when P2 connects movement.

### Debug and QA

- Canonical collider, active chunk, and active bin visualisation.
- Debug root follows floating-origin translation without mutating collision records.
- Dense debug chunks use bounded height scans without spread-argument or temporary-array growth.
- Active chunk, ready chunk, collider, bin, candidate, queue, build, and timing counters.
- `?qa=collision-p1&download=0` deterministic fixture and browser status API.
- P1 QA enables collider and broadphase drawing automatically.

## Runtime scope

P1 does not change player movement. `createCollisionRuntime` can be composed when:

- `config.collision.enabled` is true;
- `qa=collision-p1`; or
- a collision debug flag is enabled.

The temporary browser bootstrap is intentionally development-only because it depends on the development-only `window.__editor` API. Production pages do not poll for that API. In production, a P1 QA request reports `unavailable`; production collision composition begins with P2.

`PlayerController` and the main animation loop remain unchanged. P2 will consume `querySweptCapsule` and `checkMovementReadiness`.

## First review findings fixed

The first post-merge review found and fixed:

1. unbounded predicted routes after teleports or extreme measured velocity;
2. stale or failed queue entries bypassing the intended per-frame attempt budget;
3. permanent production `requestAnimationFrame` polling for a development-only API;
4. equal-revision owner data overwriting valid collision state;
5. swept broadphase cost scaling with world distance rather than active collision chunks;
6. unbounded missing-chunk readiness reports;
7. unsafe chunk-key parsing and invalid primitive dimensions/layer masks;
8. dense debug-height scans using large temporary arrays and spread arguments.

## Second review findings fixed

The second post-merge review found and fixed:

1. candidate order depended on chunk insertion/build order, which could make future narrowphase resolution non-deterministic;
2. one malformed collider could enumerate an excessive number of collision chunks;
3. collider bounds were not required to overlap their declared owner chunk;
4. exported range and direct-constructor APIs still accepted unsafe work settings;
5. extremely small bin sizes could allocate an excessive bin array;
6. stale queued priorities could retain preference from an old movement direction;
7. prototype metadata was only shallow-frozen and could be changed through nested references;
8. mesh instances could reference missing or hand-built prototype descriptors;
9. hand-built collider objects could bypass factory validation;
10. disposal left stale last-query and residency status visible.

## Current-main integration

The second review was implemented from the collision state after PR #42 and audited against `main` at `fe391b760cf3213f3daef62253fddfc450661008`.

- The newer W1 water geography implementation does not overlap collision files.
- No forest, object LOD, tree LOD, impostor, dither, inventory, water, or related rendering file is modified.
- P1 remains an independent static collision subsystem and development QA runtime.

## Browser API

Development QA exposes:

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

- stable IDs, safe chunk coordinates, and branded immutable records;
- primitive dimension and layer validation;
- deeply immutable and safe prototype metadata;
- registered prototype/mesh-instance separation;
- bounded chunk ranges and collider ownership spans;
- bounded spatial-bin allocation;
- bin insertion, removal, fallback, and deduplication;
- deterministic candidate order and caller-owned output reuse;
- active-only huge-range candidate queries;
- capped readiness reports;
- chunk boundaries and overlapping references;
- owner overlap, atomic rollback, and monotonic revisions;
- negative canonical coordinates;
- floating-origin invariance;
- bounded and refreshed current/predicted build priority;
- stale queue pruning and failed-attempt limits;
- unload hysteresis;
- destination readiness and safe policy;
- clean disposal state;
- development and production bootstrap contracts.

A normal checkout still needs to run:

```bash
npm test
npm run build
```

Headed acceptance:

```text
http://localhost:5173/?qa=collision-p1&download=0
```
