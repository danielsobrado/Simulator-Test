import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_COLLIDER_CHUNKS } from '../src/editor/collision/CollisionLimits.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import {
  createColliderPrototype,
  createMeshInstanceCollider,
} from '../src/editor/collision/colliders/ColliderRecords.js';

const BOUNDS = Object.freeze({
  minX: 4,
  minY: 0,
  minZ: -8,
  maxX: 8,
  maxY: 3,
  maxZ: -4,
});

const IDENTITY_TRANSFORM = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
]);

test('world construction rejects non-finite and excessive work settings', () => {
  assert.throws(
    () => new CollisionWorld({ chunkWorldSize: Number.POSITIVE_INFINITY, binSize: 16 }),
    /positive and finite/,
  );
  assert.throws(
    () => new CollisionWorld({ chunkWorldSize: 128, binSize: Number.POSITIVE_INFINITY }),
    /positive and finite/,
  );
  assert.throws(
    () => new CollisionWorld({
      chunkWorldSize: 128,
      binSize: 16,
      maxChunksPerCollider: MAX_COLLIDER_CHUNKS + 1,
    }),
    /maxChunksPerCollider/,
  );
});

test('mesh colliders require a registered immutable prototype', () => {
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  const collider = createMeshInstanceCollider({
    sourceId: 'rock:mesh',
    ownerChunkX: 0,
    ownerChunkZ: 0,
    aabb: BOUNDS,
    prototypeId: 'rock-large',
    transform: IDENTITY_TRANSFORM,
  });

  assert.throws(
    () => world.replaceOwnerChunk({ chunkX: 0, chunkZ: 0, revision: 1, colliders: [collider] }),
    /unknown prototype rock-large/,
  );
  assert.throws(
    () => world.registerPrototype({ id: 'rock-large', bounds: BOUNDS, metadata: {} }),
    /immutable descriptor/,
  );

  const prototype = createColliderPrototype({
    id: 'rock-large',
    kind: 'mesh',
    bounds: BOUNDS,
    metadata: { triangles: 64 },
  });
  world.registerPrototype(prototype);
  assert.equal(
    world.replaceOwnerChunk({ chunkX: 0, chunkZ: 0, revision: 1, colliders: [collider] }),
    true,
  );
  assert.equal(world.getPrototype('rock-large'), prototype);
  assert.equal(world.getCollider('rock:mesh'), collider);
});
