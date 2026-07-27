import assert from 'node:assert/strict';
import test from 'node:test';
import { createCollisionConfig } from '../src/editor/collision/CollisionConfig.js';

test('P3 tree overrides are copied and deeply immutable', () => {
  const input = {
    enabled: true,
    trees: {
      prototypeOverrides: {
        'prototype:3': {
          radius: 0.42,
          height: 6.5,
          centerX: 0.1,
          centerZ: -0.2,
          baseY: 0.05,
        },
      },
    },
  };
  const config = createCollisionConfig(input);
  input.trees.prototypeOverrides['prototype:3'].radius = 99;

  assert.equal(config.enabled, true);
  assert.equal(config.trees.prototypeOverrides['prototype:3'].radius, 0.42);
  assert.equal(Object.isFrozen(config.trees.prototypeOverrides), true);
  assert.equal(Object.isFrozen(config.trees.prototypeOverrides['prototype:3']), true);
});

test('P3 tree overrides reject unsafe fields and values', () => {
  assert.throws(
    () => createCollisionConfig({
      trees: { prototypeOverrides: { 0: { radius: 0 } } },
    }),
    /radius must be positive/,
  );
  assert.throws(
    () => createCollisionConfig({
      trees: { prototypeOverrides: { 0: { canopyRadius: 4 } } },
    }),
    /unsupported/,
  );
  assert.throws(
    () => createCollisionConfig({
      trees: { prototypeOverrides: { 0: { centerX: Number.POSITIVE_INFINITY } } },
    }),
    /centerX must be finite/,
  );
});
