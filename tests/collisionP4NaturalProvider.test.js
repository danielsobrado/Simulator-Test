import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { createCanonicalAabb } from '../src/editor/collision/colliders/ColliderBounds.js';
import {
  COLLIDER_TYPE_CAPSULE,
  COLLIDER_TYPE_SPHERE,
  createPrimitiveCollider,
} from '../src/editor/collision/colliders/ColliderRecords.js';
import { NaturalCollisionProvider } from '../src/editor/collision/providers/NaturalCollisionProvider.js';

function collider(sourceId, type, x) {
  const radius = 0.5;
  return createPrimitiveCollider({
    sourceId,
    type,
    ownerChunkX: 0,
    ownerChunkZ: 0,
    aabb: createCanonicalAabb({
      minX: x - radius,
      maxX: x + radius,
      minY: 0,
      maxY: 2,
      minZ: -radius,
      maxZ: radius,
    }),
    position: [x, 0, 0],
    dimensions: [radius, 2, radius],
    prototypeId: sourceId,
  });
}

function component(id, counterName, initialCollider) {
  let epoch = 1;
  let current = initialCollider;
  return {
    record: Object.freeze({
      id,
      counterName,
      provider: {
        getEpoch: () => epoch,
        getProfileCount: () => 1,
        buildChunkData: () => Object.freeze({
          signature: `${id}:${epoch}`,
          colliders: Object.freeze(current ? [current] : []),
          stats: Object.freeze({ colliders: current ? 1 : 0 }),
          sample: null,
        }),
      },
    }),
    replace(next) {
      current = next;
      epoch += 1;
    },
  };
}

test('natural provider refresh keeps unchanged tree and replaces only rock contribution', () => {
  const tree = component('trees', 'Tree', collider('tree:1', COLLIDER_TYPE_CAPSULE, 2));
  const rock = component('rocks', 'Rock', collider('rock:1', COLLIDER_TYPE_SPHERE, 4));
  const provider = new NaturalCollisionProvider({
    components: [tree.record, rock.record],
    buildsPerFrame: 4,
    buildBudgetMs: 100,
    now: () => 0,
    logger: Object.freeze({ error() {} }),
  });
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });

  const initial = provider.buildOwnerChunk(0, 0);
  assert.equal(world.replaceOwnerChunk({ chunkX: 0, chunkZ: 0, ...initial }), true);
  provider.commitOwnerChunk({ chunkX: 0, chunkZ: 0, ...initial });
  assert.ok(world.getCollider('tree:1'));
  assert.ok(world.getCollider('rock:1'));

  rock.replace(collider('rock:2', COLLIDER_TYPE_SPHERE, 5));
  const refreshed = provider.refresh(world);
  assert.equal(refreshed.rebuilt, 1);
  assert.ok(world.getCollider('tree:1'));
  assert.equal(world.getCollider('rock:1'), null);
  assert.ok(world.getCollider('rock:2'));
  assert.equal(provider.getStatus().components.trees.colliders, 1);
  assert.equal(provider.getStatus().components.rocks.colliders, 1);
});

test('natural provider unload removes provider state after world unload', () => {
  const tree = component('trees', 'Tree', collider('tree:1', COLLIDER_TYPE_CAPSULE, 2));
  const provider = new NaturalCollisionProvider({
    components: [tree.record],
    now: () => 0,
  });
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  const initial = provider.buildOwnerChunk(0, 0);
  world.replaceOwnerChunk({ chunkX: 0, chunkZ: 0, ...initial });
  provider.commitOwnerChunk({ chunkX: 0, chunkZ: 0, ...initial });

  world.unloadOwnerChunk(0, 0);
  provider.unloadOwnerChunk(0, 0);
  assert.equal(provider.getStatus().loadedChunks, 0);
  assert.equal(provider.getStatus().colliderCount, 0);
});
