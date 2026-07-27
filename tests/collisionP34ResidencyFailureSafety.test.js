import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionResidency } from '../src/editor/collision/CollisionResidency.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { COLLISION_RETRY_BASE_MS } from '../src/editor/collision/CollisionLimits.js';

const CONFIG = Object.freeze({
  residentRadius: 0,
  unloadRadius: 1,
  prefetchSeconds: 0.5,
  buildsPerFrame: 1,
  buildBudgetMs: 10,
});

const QUIET_LOGGER = Object.freeze({ error() {} });

function createWorld() {
  return new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
}

test('commit callback failure rolls the world back and retries after backoff', () => {
  const world = createWorld();
  let clock = 0;
  let revision = 0;
  let commitAttempts = 0;
  let unloadNotifications = 0;
  const residency = new CollisionResidency({
    world,
    config: CONFIG,
    buildOwnerChunk: () => ({
      revision: revision += 1,
      colliders: [],
      providerData: Object.freeze({ signature: `chunk:${revision}` }),
    }),
    onOwnerChunkCommitted: () => {
      commitAttempts += 1;
      if (commitAttempts === 1) throw new Error('commit fixture failed');
    },
    onOwnerChunkUnloaded: () => {
      unloadNotifications += 1;
    },
    now: () => clock,
    logger: QUIET_LOGGER,
  });

  residency.update({ focus: { x: 1, z: 1 } });
  const failed = residency.flush();
  assert.equal(failed.built, 0);
  assert.equal(world.isOwnerChunkReady(0, 0), false);
  assert.equal(residency.getStatus().deferredRetries, 1);
  assert.equal(unloadNotifications, 1);
  assert.match(residency.getStatus().lastBuildError, /commit callback failed/);

  residency.update({ focus: { x: 1, z: 1 } });
  assert.equal(residency.flush().attempted, 0);

  clock += COLLISION_RETRY_BASE_MS;
  residency.update({ focus: { x: 1, z: 1 } });
  const recovered = residency.flush();
  assert.equal(recovered.built, 1);
  assert.equal(world.isOwnerChunkReady(0, 0), true);
  assert.equal(residency.getStatus().deferredRetries, 0);
});

test('failed owner builds do not retry every animation frame', () => {
  const world = createWorld();
  let clock = 0;
  let attempts = 0;
  const residency = new CollisionResidency({
    world,
    config: CONFIG,
    buildOwnerChunk: () => {
      attempts += 1;
      throw new Error('invalid profile');
    },
    now: () => clock,
    logger: QUIET_LOGGER,
  });

  residency.update({ focus: { x: 1, z: 1 } });
  assert.equal(residency.flush().attempted, 1);
  assert.equal(attempts, 1);

  residency.update({ focus: { x: 1, z: 1 } });
  assert.equal(residency.flush().attempted, 0);
  assert.equal(attempts, 1);

  clock += COLLISION_RETRY_BASE_MS;
  residency.update({ focus: { x: 1, z: 1 } });
  assert.equal(residency.flush().attempted, 1);
  assert.equal(attempts, 2);
});
