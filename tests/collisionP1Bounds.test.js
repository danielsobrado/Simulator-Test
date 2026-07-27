import assert from 'node:assert/strict';
import test from 'node:test';
import { createCollisionConfig } from '../src/editor/collision/CollisionConfig.js';
import {
  MAX_COLLIDER_CHUNKS,
  MAX_COLLISION_BUILDS_PER_FRAME,
  MAX_COLLISION_STREAMING_RADIUS,
} from '../src/editor/collision/CollisionLimits.js';
import {
  collisionChunkCountForRange,
  collisionChunksForAabb,
  createCanonicalAabb,
} from '../src/editor/collision/colliders/ColliderBounds.js';

function horizontalBounds(minX, maxX) {
  return createCanonicalAabb({
    minX,
    maxX,
    minY: 0,
    maxY: 2,
    minZ: -1,
    maxZ: 0,
  });
}

test('collision configuration exposes bounded streaming limits', () => {
  assert.equal(createCollisionConfig({}).streaming.maxChunksPerCollider, 64);
  assert.equal(
    createCollisionConfig({ streaming: { maxChunksPerCollider: 8 } })
      .streaming.maxChunksPerCollider,
    8,
  );
  assert.throws(
    () => createCollisionConfig({ streaming: { maxChunksPerCollider: 0 } }),
    /maxChunksPerCollider/,
  );
  assert.throws(
    () => createCollisionConfig({
      streaming: { maxChunksPerCollider: MAX_COLLIDER_CHUNKS + 1 },
    }),
    /maxChunksPerCollider/,
  );
  assert.throws(
    () => createCollisionConfig({
      streaming: {
        residentRadius: MAX_COLLISION_STREAMING_RADIUS + 1,
        unloadRadius: MAX_COLLISION_STREAMING_RADIUS + 1,
      },
    }),
    /residentRadius/,
  );
  assert.throws(
    () => createCollisionConfig({
      streaming: { buildsPerFrame: MAX_COLLISION_BUILDS_PER_FRAME + 1 },
    }),
    /buildsPerFrame/,
  );
});

test('AABB chunk enumeration rejects spans above the requested limit', () => {
  const target = ['stale'];
  assert.throws(
    () => collisionChunksForAabb(horizontalBounds(0, 128 * 4), 128, target, 2),
    /exceeding the limit of 2/,
  );
  assert.deepEqual(target, []);
  assert.throws(
    () => collisionChunksForAabb(
      horizontalBounds(0, 1),
      128,
      [],
      MAX_COLLIDER_CHUNKS + 1,
    ),
    /must not exceed/,
  );
});

test('chunk range counts reject arithmetic outside the safe integer range', () => {
  assert.throws(
    () => collisionChunkCountForRange({
      minChunkX: -Number.MAX_SAFE_INTEGER,
      maxChunkX: Number.MAX_SAFE_INTEGER,
      minChunkZ: 0,
      maxChunkZ: 0,
    }),
    /too large to enumerate safely/,
  );
});

test('bounded AABB chunk enumeration remains deterministic', () => {
  assert.deepEqual(
    collisionChunksForAabb(horizontalBounds(0, 129), 128, [], 4),
    [
      { chunkX: 0, chunkZ: 0 },
      { chunkX: 1, chunkZ: 0 },
    ],
  );
});
