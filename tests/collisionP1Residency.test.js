import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLLISION_NOT_READY_POLICY,
  CollisionResidency,
} from '../src/editor/collision/CollisionResidency.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { createCanonicalAabb } from '../src/editor/collision/colliders/ColliderBounds.js';

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
  });
  return {
    world,
    residency,
    built,
    advance(milliseconds) { clock += milliseconds; },
  };
}

test('residency prioritises current and predicted-route chunks', () => {
  const harness = createResidency();
  harness.residency.update({
    focus: { x: 1, z: -1 },
    velocity: { x: 300, z: 0 },
  });
  harness.residency.flush();
  harness.advance(1);
  harness.residency.flush();
  assert.deepEqual(harness.built.slice(0, 2), ['0:0', '1:0']);
  assert.equal(harness.residency.getStatus().predictedChunk.chunkX, 2);
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
