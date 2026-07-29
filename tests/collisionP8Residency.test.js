import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionResidency } from '../src/editor/collision/CollisionResidency.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { collisionChunkCanonicalBounds } from '../src/editor/collision/colliders/ColliderBounds.js';
import { PerfCounters } from '../src/editor/performance/qa/PerfCounters.js';

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
  const bounds = collisionChunkCanonicalBounds(chunkX, chunkZ, 128);
  return {
    minX: bounds.minX + 1,
    minY: 0,
    minZ: bounds.minZ + 1,
    maxX: bounds.minX + 2,
    maxY: 2,
    maxZ: bounds.minZ + 2,
  };
}

test('idle residency flushes do not add chunk-build timing', () => {
  PerfCounters.reset();
  let timestamp = 0;
  const residency = new CollisionResidency({
    world: createWorld(),
    config: CONFIG,
    buildOwnerChunk: () => ({ revision: 1, colliders: [] }),
    now: () => {
      timestamp += 1;
      return timestamp;
    },
  });

  assert.deepEqual(residency.flush(), { attempted: 0, built: 0, remaining: 0 });
  assert.equal(PerfCounters.get('collisionBuildMs'), 0);
  PerfCounters.reset();
});

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
  assert.deepEqual(residency.getStatus().predictedChunk, { chunkX: 2, chunkZ: -1 });
  assert.equal(residency.desiredKeys.has('2:-1'), true);

  residency.update({ focus: { x: 1, z: 1 }, velocity: { x: -300, z: 0 } });
  assert.deepEqual(residency.getStatus().predictedChunk, { chunkX: -3, chunkZ: -1 });
  assert.equal(residency.desiredKeys.has('-3:-1'), true);
  assert.equal(residency.desiredKeys.has('2:-1'), false);
  assert.equal(residency.queue.some(({ key }) => key === '2:-1'), false);
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
  const before = residency.checkDestination(chunkAabb(7, -1));
  assert.equal(before.ready, false);
  assert.deepEqual(before.missing, ['7:-1']);

  residency.flush();
  const after = residency.checkDestination(chunkAabb(7, -1));
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
  const readiness = residency.checkDestination(chunkAabb(0, -1));

  assert.equal(status.ready, false);
  assert.deepEqual(status.failure, {
    providerId: 'production-natural-props',
    phase: 'chunk-build',
    chunkKey: '0:-1',
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
