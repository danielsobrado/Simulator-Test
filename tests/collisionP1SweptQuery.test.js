import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { COLLISION_LAYERS } from '../src/editor/collision/CollisionLayers.js';
import {
  COLLIDER_TYPE_BOX,
  createPrimitiveCollider,
} from '../src/editor/collision/colliders/ColliderRecords.js';
import {
  createCanonicalAabb,
  createSweptCapsuleAabb,
} from '../src/editor/collision/colliders/ColliderBounds.js';

function blocker(sourceId, x) {
  return createPrimitiveCollider({
    sourceId,
    type: COLLIDER_TYPE_BOX,
    layers: COLLISION_LAYERS.blocking,
    ownerChunkX: 0,
    ownerChunkZ: 0,
    aabb: createCanonicalAabb({
      minX: x - 1,
      maxX: x + 1,
      minY: 0,
      maxY: 3,
      minZ: -2,
      maxZ: 0,
    }),
    position: [x, 0, -1],
    rotationY: 0,
    dimensions: [2, 3, 2],
  });
}

test('swept capsule AABB selects the full route rather than only the destination', () => {
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 8 });
  world.replaceOwnerChunk({
    chunkX: 0,
    chunkZ: 0,
    revision: 1,
    colliders: [blocker('qa:near-route', 16), blocker('qa:beyond-route', 48)],
  });
  const swept = createSweptCapsuleAabb({
    start: { x: 0, y: 0, z: -1 },
    end: { x: 32, y: 0, z: -1 },
    radius: 0.5,
    bodyHeight: 1.8,
  });
  assert.deepEqual(
    world.collectCandidates(swept).map((collider) => collider.sourceId),
    ['qa:near-route'],
  );
});

test('candidate collection reuses a caller-owned output array', () => {
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 8 });
  world.replaceOwnerChunk({
    chunkX: 0,
    chunkZ: 0,
    revision: 1,
    colliders: [blocker('qa:reuse', 8)],
  });
  const out = ['stale'];
  const result = world.collectCandidates(createCanonicalAabb({
    minX: 6,
    maxX: 10,
    minY: 0,
    maxY: 2,
    minZ: -3,
    maxZ: 1,
  }), COLLISION_LAYERS.all, out);
  assert.equal(result, out);
  assert.deepEqual(out.map((collider) => collider.sourceId), ['qa:reuse']);
  assert.equal(world.getStatus().lastQueryCandidates, 1);
});
