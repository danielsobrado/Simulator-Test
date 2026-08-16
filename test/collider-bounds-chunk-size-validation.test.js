import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collisionChunkCanonicalBounds,
  collisionChunkForCanonical,
  collisionChunkRangeForAabb,
  createCanonicalAabb,
} from '../src/editor/collision/colliders/ColliderBounds.js';

const WORLD_AABB = createCanonicalAabb({
  minX: -1,
  minY: 0,
  minZ: -1,
  maxX: 1,
  maxY: 1,
  maxZ: 1,
});

for (const invalidSize of [Number.POSITIVE_INFINITY, Number.NaN, 0, -1]) {
  test(`collision chunk helpers reject invalid chunk size ${String(invalidSize)}`, () => {
    assert.throws(
      () => collisionChunkForCanonical(10, -10, invalidSize),
      /chunkWorldSize must be positive and finite/,
    );
    assert.throws(
      () => collisionChunkCanonicalBounds(0, 0, invalidSize),
      /chunkWorldSize must be positive and finite/,
    );
    assert.throws(
      () => collisionChunkRangeForAabb(WORLD_AABB, invalidSize),
      /chunkWorldSize must be positive and finite/,
    );
  });
}
