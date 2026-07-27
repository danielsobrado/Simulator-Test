import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLLISION_NOT_READY_POLICY,
  CollisionResidency,
} from '../src/editor/collision/CollisionResidency.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { createCanonicalAabb } from '../src/editor/collision/colliders/ColliderBounds.js';

const QUIET_LOGGER = Object.freeze({ error() {} });

function createResidency(config = {}) {
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  const built = [];
  let clock = 0;
  const residency = new CollisionResidency({
    world,
    config: {
      residentRadius: 0,
      unloadRadius: 1,
      prefetchSeconds: 1,
      buildsPerFrame: 1,
      buildBudgetMs: 2,
      ...config,
    },
    buildOwnerChunk: (chunkX, chunkZ) => {
      built.push(`${chunkX}:${chunkZ}`);
      return { revision: 1, colliders: [] };
    },
    now: () => clock,
    logger: QUIET_LOGGER,
  });
  return {
    world,
    residency,
    built,
    advance(milliseconds) { clock += milliseconds; },
  };
}

test('residency prioritises current and bounded predicted-route chunks', () => {
  const harness = createResidency();
  harness.residency.update({
    focus: { x: 1, z: -1 },
    velocity: { x: 300, z: 0 },
  });
  harness.residency.flush();
  harness.advance(1);
  harness.residency.flush();
  assert.deepEqual(harness.built.slice(0, 2), ['0:0', '1:0']);
  assert.equal(harness.residency.getStatus().predictedChunk.chunkX, 1);
});

test('teleport-sized velocity cannot create an unbounded prefetch route', () => {
  const harness = createResidency({ unloadRadius: 2, buildsPerFrame: 8 });
  harness.residency.update({
    focus: { x: 1, z: -1 },
    velocity: { x: 1e12, z: -1e12 },
  });
  const status = harness.residency.getStatus();
  assert.equal(status.predictedChunk.chunkX, 2);
  assert.equal(status.predictedChunk.chunkZ, 2);
  assert.ok(status.desiredChunks <= 3, `unexpected desired chunk count: ${status.desiredChunks}`);
});

test('stale queued jobs are pruned before they can consume a later frame', () => {
  const harness = createResidency();
  harness.residency.update({
    focus: { x: 1, z: -1 },
    velocity: { x: 300, z: 0 },
  });
  assert.equal(harness.residency.getStatus().queuedBuilds, 2);

  harness.residency.update({
    focus: { x: 1281, z: -1 },
    velocity: { x: 0, z: 0 },
  });
  assert.equal(harness.residency.getStatus().queuedBuilds, 1);
  harness.residency.flush();
  assert.deepEqual(harness.built, ['10:0']);
});

test('failed builds respect the per-frame attempt limit', () => {
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  let attempts = 0;
  const residency = new CollisionResidency({
    world,
    config: {
      residentRadius: 1,
      unloadRadius: 1,
      prefetchSeconds: 1,
      buildsPerFrame: 3,
      buildBudgetMs: 100,
    },
    buildOwnerChunk: () => {
      attempts += 1;
      throw new Error('fixture failure');
    },
    now: () => 0,
    logger: QUIET_LOGGER,
  });
  residency.update({ focus: { x: 1, z: -1 }, velocity: { x: 0, z: 0 } });
  const result = residency.flush();
  assert.equal(result.attempted, 3);
  assert.equal(result.built, 0);
  assert.equal(attempts, 3);
  assert.equal(result.remaining, 6);
});

test('unload hysteresis retains nearby chunks and removes distant owners', () => {
  const harness = createResidency({ buildsPerFrame: 8 });
  harness.residency.update({ focus: { x: 1, z: -1 }, velocity: { x: 0, z: 0 } });
  harness.residency.flush();
  assert.equal(harness.world.isOwnerChunkReady(0, 0), true);

  harness.residency.update({ focus: { x: 129, z: -1 }, velocity: { x: 0, z: 0 } });
  harness.residency.flush();
  assert.equal(harness.world.isOwnerChunkReady(0, 0), true, 'chunk inside unload radius must remain');

  harness.residency.update({ focus: { x: 385, z: -1 }, velocity: { x: 0, z: 0 } });
  harness.residency.flush();
  assert.equal(harness.world.isOwnerChunkReady(0, 0), false);
  assert.equal(harness.world.isOwnerChunkReady(3, 0), true);
});

test('destination readiness exposes the P2 safe movement policy', () => {
  const harness = createResidency();
  const destination = createCanonicalAabb({
    minX: 1,
    maxX: 2,
    minY: 0,
    maxY: 2,
    minZ: -2,
    maxZ: -1,
  });
  const missing = harness.residency.checkDestination(destination);
  assert.equal(missing.ready, false);
  assert.equal(missing.policy, COLLISION_NOT_READY_POLICY);

  harness.residency.update({ focus: { x: 1, z: -1 }, velocity: { x: 0, z: 0 } });
  harness.residency.flush();
  assert.equal(harness.residency.checkDestination(destination).ready, true);
});
