import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionSpatialBins } from '../src/editor/collision/CollisionSpatialBins.js';
import { COLLISION_LAYERS } from '../src/editor/collision/CollisionLayers.js';
import {
  COLLIDER_TYPE_BOX,
  createPrimitiveCollider,
} from '../src/editor/collision/colliders/ColliderRecords.js';
import {
  collisionChunkCanonicalBounds,
  createCanonicalAabb,
} from '../src/editor/collision/colliders/ColliderBounds.js';

function collider(sourceId, aabb) {
  return createPrimitiveCollider({
    sourceId,
    type: COLLIDER_TYPE_BOX,
    layers: COLLISION_LAYERS.blocking,
    ownerChunkX: 0,
    ownerChunkZ: 0,
    aabb,
    position: [(aabb.minX + aabb.maxX) / 2, 0, (aabb.minZ + aabb.maxZ) / 2],
    rotationY: 0,
    dimensions: [aabb.maxX - aabb.minX, 2, aabb.maxZ - aabb.minZ],
  });
}

test('spatial bin construction rejects unbounded allocation settings', () => {
  const chunkBounds = collisionChunkCanonicalBounds(0, 0, 128);
  assert.throws(
    () => new CollisionSpatialBins({ chunkBounds, binSize: Number.MIN_VALUE }),
    /more than .* bins per chunk/,
  );
  assert.throws(
    () => new CollisionSpatialBins({ chunkBounds, binSize: Number.POSITIVE_INFINITY }),
    /positive and finite/,
  );
});

test('spatial bins insert, deduplicate, reuse output, and remove records', () => {
  const bins = new CollisionSpatialBins({
    chunkBounds: collisionChunkCanonicalBounds(0, 0, 128),
    binSize: 16,
    maxBinsPerCollider: 16,
  });
  const record = collider('qa:box', createCanonicalAabb({
    minX: 15,
    maxX: 17,
    minY: 0,
    maxY: 2,
    minZ: -17,
    maxZ: -15,
  }));
  bins.insert(record);
  const registry = new Map([[record.sourceId, { collider: record, lastQueryStamp: 0 }]]);
  const out = [];
  const query = createCanonicalAabb({
    minX: 14,
    maxX: 18,
    minY: 0,
    maxY: 2,
    minZ: -18,
    maxZ: -14,
  });
  assert.equal(bins.query(query, 1, registry, out).length, 1);
  assert.equal(out[0], record);
  out.length = 0;
  assert.equal(bins.query(query, 2, registry, out), out);
  assert.equal(out.length, 1, 'record spanning four bins must be emitted once');
  assert.equal(bins.remove(record.sourceId), true);
  out.length = 0;
  assert.equal(bins.query(query, 3, registry, out).length, 0);
});

test('large colliders use fallback references instead of every covered bin', () => {
  const bins = new CollisionSpatialBins({
    chunkBounds: collisionChunkCanonicalBounds(0, 0, 128),
    binSize: 8,
    maxBinsPerCollider: 4,
  });
  const record = collider('qa:large', createCanonicalAabb({
    minX: 0,
    maxX: 100,
    minY: 0,
    maxY: 4,
    minZ: -100,
    maxZ: 0,
  }));
  bins.insert(record);
  const stats = bins.getStats();
  assert.equal(stats.largeColliders, 1);
  assert.equal(stats.activeBins, 0);

  const registry = new Map([[record.sourceId, { collider: record, lastQueryStamp: 0 }]]);
  const out = [];
  bins.query(createCanonicalAabb({
    minX: 90,
    maxX: 91,
    minY: 0,
    maxY: 2,
    minZ: -91,
    maxZ: -90,
  }), 1, registry, out);
  assert.deepEqual(out.map((entry) => entry.sourceId), ['qa:large']);
});
