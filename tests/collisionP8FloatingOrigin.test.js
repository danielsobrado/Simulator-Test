import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import {
  canonicalCollisionSignature,
  getCollisionWorldComposition,
} from '../src/editor/collision/CollisionWorldMetrics.js';
import {
  COLLIDER_TYPE_BOX,
  createPrimitiveCollider,
} from '../src/editor/collision/colliders/ColliderRecords.js';
import { FloatingOrigin } from '../src/editor/world/FloatingOrigin.js';

function collider() {
  return createPrimitiveCollider({
    sourceId: 'construction:wall:segment-1',
    type: COLLIDER_TYPE_BOX,
    ownerChunkX: 8,
    ownerChunkZ: -4,
    aabb: {
      minX: 1024,
      minY: 10,
      minZ: -512,
      maxX: 1032,
      maxY: 14,
      maxZ: -511,
    },
    position: [1028, 12, -511.5],
    dimensions: [8, 4, 1],
    rotationY: 0.25,
    prototypeId: 'construction:wall',
  });
}

test('floating-origin changes do not alter canonical collision signatures or bounds', () => {
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  const record = collider();
  world.replaceOwnerChunk({
    chunkX: 8,
    chunkZ: -4,
    revision: 1,
    colliders: [record],
  });
  const origin = new FloatingOrigin({ threshold: 100, snapSize: 64 });
  const signatureBefore = canonicalCollisionSignature(world);
  const boundsBefore = { ...world.getCollider(record.sourceId).aabb };

  const rebase = origin.update({ x: 1024, z: -512 });

  assert.deepEqual(rebase, {
    shiftX: 1024,
    shiftZ: -512,
    originX: 1024,
    originZ: -512,
  });
  assert.equal(canonicalCollisionSignature(world), signatureBefore);
  assert.deepEqual(world.getCollider(record.sourceId).aabb, boundsBefore);
  assert.deepEqual(origin.toRender(1028, -511.5), { x: 4, z: 0.5 });
});

test('canonical signatures are deterministic across identical reloads', () => {
  const first = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  const second = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  const record = collider();
  for (const world of [first, second]) {
    world.replaceOwnerChunk({
      chunkX: 8,
      chunkZ: -4,
      revision: 1,
      colliders: [record],
    });
  }

  assert.equal(canonicalCollisionSignature(first), canonicalCollisionSignature(second));
  assert.deepEqual(getCollisionWorldComposition(first), {
    primitiveColliders: 1,
    meshInstances: 0,
    prototypeBvhs: 0,
  });
});
