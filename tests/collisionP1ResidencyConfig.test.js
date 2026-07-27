import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionResidency } from '../src/editor/collision/CollisionResidency.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';

const QUIET_LOGGER = Object.freeze({ error() {} });

test('residency snapshots validated configuration', () => {
  const config = {
    residentRadius: 0,
    unloadRadius: 1,
    prefetchSeconds: 1,
    buildsPerFrame: 1,
    buildBudgetMs: 2,
  };
  const residency = new CollisionResidency({
    world: new CollisionWorld({ chunkWorldSize: 128, binSize: 16 }),
    config,
    buildOwnerChunk: () => ({ revision: 1, colliders: [] }),
    logger: QUIET_LOGGER,
  });

  config.residentRadius = 64;
  config.buildsPerFrame = 64;

  residency.update({ focus: { x: 1, z: -1 }, velocity: { x: 0, z: 0 } });
  assert.equal(residency.getStatus().desiredChunks, 1);
  assert.equal(residency.flush().attempted, 1);
  assert.equal(Object.isFrozen(residency.config), true);
});
