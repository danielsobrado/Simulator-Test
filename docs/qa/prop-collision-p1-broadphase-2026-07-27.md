# Prop collision P1 broadphase QA

Date: **2026-07-27**  
Gameplay collision: **not connected**  
Runtime surface: **Vite development server only**

## Run

```text
http://localhost:5173/?qa=collision-p1&download=0
```

The temporary P1 browser bootstrap depends on the development-only editor API. Production builds do not poll for that API and report the QA mode as unavailable. Production collision composition begins in P2.

P1 mode automatically shows:

- resident collision chunk bounds;
- occupied fine-broadphase bins;
- canonical collider AABBs;
- the P0 visual fixture for alignment comparison.

## Browser status

```js
window.__collisionP1Qa
window.__editor.collision.getStatus()
```

Ready contract:

```js
window.__collisionP1Qa.status === 'ready'
window.__collisionP1Qa.collision.residency.ready === true
```

The deterministic sample query crosses the tree fixture. Its candidate list must contain `qa:tree` and must not contain unrelated distant fixture records.

## Manual acceptance

1. Confirm the visual tree, rocks, walls, doorway, steps, ramps, and boundary construction align with their collider boxes.
2. Confirm the construction crossing X=128 appears in both adjacent collision chunks.
3. Move the camera/player focus across a chunk boundary and confirm the active window never becomes empty after initial readiness.
4. Trigger a floating-origin rebase and confirm collider boxes remain attached to the canonical fixture.
5. Inspect `window.__editor.collision.getStatus()` and confirm ready/desired counts converge.
6. Open the normal application without collision QA/debug flags and confirm no collision runtime is created.
7. Build the production bundle and confirm no collision bootstrap animation-frame polling occurs.

## Automated gates

```bash
npm test
npm run build
```

Review regressions cover:

- extreme-velocity prediction bounds;
- stale queue pruning and failed-attempt limits;
- active-only huge-range queries;
- capped readiness output;
- monotonic owner revisions;
- production bootstrap termination.

Relevant counters:

```text
collisionActiveChunks
collisionReadyChunks
collisionActiveColliders
collisionActiveBins
collisionLargeColliders
collisionCandidates
collisionQueryChunks
collisionDesiredChunks
collisionReadyDesiredChunks
collisionBuildQueueDepth
collisionLoadedOwnerChunks
collisionBuilds
collisionBuildMs
```
