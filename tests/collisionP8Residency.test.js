import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionResidency } from '../src/editor/collision/CollisionResidency.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';

const CONFIG = Object.freeze({
  residentRadius: 0,
  unloadRadius: 3,
  prefetchSeconds: 1,
  buildsPerFrame: 8,
  buildBudgetMs: 10,
});

function createWorld() {
  return new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
}

function chunkAabb(chunkX, chunkZ) {
  return {
    minX: chunkX * 128 + 1,
    minY: 0,
    minZ: chunkZ * 128 + 1,
    maxX: chunkX * 128 + 2,
    maxY: 2,
    maxZ: chunkZ * 128 + 2,
  };
}

test('velocity prefetch reverses route priority without retaining stale queued chunks', () => {
  const world = createWorld();
  let revision = 1;
  const residency = new CollisionResidency({
    world,
    config: CONFIG,
    buildOwnerChunk: () => ({ revision: revision++, colliders: [] }),
    now: () => 0,
  });

  residency.update({ focus: { x: 1, z: 1 }, velocity: { x: 300, z: 0 } });
  assert.deepEqual(residency.getStatus().predictedChunk, { chunkX: 2, chunkZ: 0 });
  assert.equal(residency.desiredKeys.has('2:0'), true);

  residency.update({ focus: { x: 1, z: 1 }, velocity: { x: -300, z: 0 } });
  assert.deepEqual(residency.getStatus().predictedChunk, { chunkX: -3, chunkZ: 0 });
  assert.equal(residency.desiredKeys.has('-3:0'), true);
  assert.equal(residency.desiredKeys.has('2:0'), false);
  assert.equal(residency.queue.some(({ key }) => key === '2:0'), false);
});

test('teleport destination remains blocked until its owner chunk is ready', () => {
  const world = createWorld();
  let revision = 1;
  const residency = new CollisionResidency({
    world,
    config: CONFIG,
    buildOwnerChunk: () => ({ revision: revision++, colliders: [] }),
    now: () => 0,
  });

  residency.update({ focus: { x: 900, z: 1 }, velocity: { x: 0, z: 0 } });
  const before = residency.checkDestination(chunkAabb(7, 0));
  assert.equal(before.ready, false);
  assert.deepEqual(before.missing, ['7:0']);

  residency.flush();
  const after = residency.checkDestination(chunkAabb(7, 0));
  assert.equal(after.ready, true);
  assert.deepEqual(after.missing, []);
});

test('failed chunks expose structured context and stay unsafe', () => {
  const world = createWorld();
  const error = new Error('Missing required walkable proxy.');
  error.sourceId = 'rock:42';
  error.prototypeId = 'rock-walkable:granite';
  const residency = new CollisionResidency({
    world,
    config: CONFIG,
    providerId: 'production-natural-props',
    buildOwnerChunk: () => {
      throw error;
    },
    now: () => 0,
    logger: { error() {} },
  });

  residency.update({ focus: { x: 1, z: 1 }, velocity: { x: 0, z: 0 } });
  residency.flush();
  const status = residency.getStatus();
  const readiness = residency.checkDestination(chunkAabb(0, 0));

  assert.equal(status.ready, false);
  assert.deepEqual(status.failure, {
    providerId: 'production-natural-props',
    phase: 'chunk-build',
    chunkKey: '0:0',
    sourceId: 'rock:42',
    prototypeId: 'rock-walkable:granite',
    message: 'Missing required walkable proxy.',
  });
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.failed, [status.failure]);

  residency.update({ focus: { x: 1025, z: 1 }, velocity: { x: 0, z: 0 } });
  assert.equal(residency.getStatus().failure, null);
});

test('residency disposal unloads committed owner chunks and clears failure state', () => {
  const world = createWorld();
  const residency = new CollisionResidency({
    world,
    config: CONFIG,
    buildOwnerChunk: () => ({ revision: 1, colliders: [] }),
    now: () => 0,
  });
  residency.update({ focus: { x: 1, z: 1 }, velocity: { x: 0, z: 0 } });
  residency.flush();
  assert.equal(world.getStatus().ownerChunks, 1);

  residency.dispose();
  assert.equal(world.getStatus().ownerChunks, 0);
  assert.equal(residency.getStatus().loadedOwnerChunks, 0);
  assert.equal(residency.getStatus().failure, null);
});
