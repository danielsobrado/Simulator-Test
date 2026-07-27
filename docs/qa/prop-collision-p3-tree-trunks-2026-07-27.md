# Prop collision P3 tree-trunk QA

Date: **2026-07-27**  
Gameplay scope: **production tree manifests and trunk prototypes**

## Run

```text
http://localhost:5173/?qa=collision-p3&download=0
```

P3 uses the normal tree assets and canonical forest manifest. It does not load the P0 primitive scene.

The bootstrap:

- waits for the tree prototypes and manifest store;
- builds production tree colliders around the player;
- selects the first resident canonical tree collider;
- places the player south of that trunk;
- runs forward after the warm-up phase;
- enables collider and broadphase debug drawing.

## Ready contract

```js
window.__collisionP3Qa.status === 'ready'
window.__collisionP3Qa.collision.residency.ready === true
window.__collisionP3Qa.collision.provider.colliderCount > 0
window.__collisionP3Qa.target != null
```

The target contains:

```js
{
  sourceId,
  prototypeId,
  x,
  y,
  z,
  radius,
  height
}
```

## Core acceptance

1. Confirm the player stops at the selected trunk and cannot pass through it.
2. Approach the trunk diagonally and confirm stable sliding without vibration.
3. Circle the trunk and confirm the collider centre follows the visible lower trunk.
4. Confirm branches and leaves do not create invisible collision.
5. Confirm the collider remains unchanged through mesh, proxy, impostor, and fallback transitions.
6. Confirm tree wind does not move the collider.
7. Confirm generated and planted trees both block movement.
8. Fell the target tree and confirm its collider disappears without leaving a ghost blocker.
9. Plant a tree and confirm its collider appears after the manifest refresh.
10. Confirm an unchanged neighbouring collision chunk is not rebuilt after the edit.

## Coordinate and streaming acceptance

1. Cross a collision chunk boundary inside a forest and confirm there is no collision gap.
2. Trigger a floating-origin rebase and confirm visible trunks and debug colliders remain aligned.
3. Teleport with the QA/player API and confirm movement waits for destination collision readiness.
4. Return to the original forest and confirm stable IDs and collider positions are unchanged.
5. Load/save/reload a world with forest edits and confirm felled trees remain absent and planted trees retain collision.

## Prototype acceptance

Enable collider debugging when running outside P3 QA:

```text
?collisionColliders=1&collisionBroadphase=1
```

For every configured tree prototype:

- debug colour is stable for that prototype;
- collider radius follows the lower trunk, not branch spread;
- collider base is grounded correctly;
- authored scale is respected;
- unusually shaped trunks either derive plausibly or have an explicit YAML override;
- no prototype silently uses the complete tree bounding box.

## Dense-forest performance

During sustained movement through dense forest, inspect:

```text
collisionTreeProfiles
collisionTreeChunkBuilds
collisionTreeChunkRefreshes
collisionTreeRefreshMs
collisionTreeChunks
collisionTreeColliders
collisionTreeRefreshQueueDepth
collisionCandidates
collisionQueryChunks
collisionContacts
collisionSolverIterations
```

Expected behaviour:

- steady movement does not rebuild unchanged tree collision chunks;
- LOD transitions do not increment tree refresh counters;
- candidate counts remain local to collision bins;
- cutting or planting queues bounded refresh work;
- frame-time spikes do not scale with the full rendered forest window.

## Water compatibility

Repeat a forest-edge route near water and confirm P3 preserves merged W3 behaviour:

- wading drag;
- swimming and diving controls;
- steep-bank protection;
- underwater atmosphere;
- gravity and ground support after leaving water.

## Automated gates

```bash
npm test
npm run build
```

The PR must remain draft until the full test/build and headed acceptance complete.
