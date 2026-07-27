import assert from 'node:assert/strict';
import test from 'node:test';
import { createCollisionConfig } from '../src/editor/collision/CollisionConfig.js';

test('walkable rock proxy settings are immutable and validated', () => {
  const config = createCollisionConfig({
    rocks: {
      maximumProxyTriangles: 64,
      bvhMaxLeafTriangles: 3,
      minimumProxyOverlapRatio: 0.4,
      allowGeneratedProxyFallback: true,
      requireAuthoredProxy: false,
    },
  });
  assert.equal(config.rocks.maximumProxyTriangles, 64);
  assert.equal(config.rocks.bvhMaxLeafTriangles, 3);
  assert.equal(config.rocks.minimumProxyOverlapRatio, 0.4);
  assert.equal(Object.isFrozen(config.rocks), true);
});

test('authored-only proxies cannot be combined with generated fallback', () => {
  assert.throws(
    () => createCollisionConfig({
      rocks: {
        requireAuthoredProxy: true,
        allowGeneratedProxyFallback: true,
      },
    }),
    /authored rock proxies cannot be required/,
  );
});

test('proxy overlap ratio and BVH leaf size reject unsafe values', () => {
  assert.throws(
    () => createCollisionConfig({ rocks: { minimumProxyOverlapRatio: 1.1 } }),
    /must not exceed 1/,
  );
  assert.throws(
    () => createCollisionConfig({ rocks: { bvhMaxLeafTriangles: 0 } }),
    /positive integer/,
  );
});
