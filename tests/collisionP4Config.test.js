import assert from 'node:assert/strict';
import test from 'node:test';
import { createCollisionConfig } from '../src/editor/collision/CollisionConfig.js';

test('P4 rock policy and overrides are copied and immutable', () => {
  const input = {
    enabled: true,
    rocks: {
      minimumCollidableHeight: 0.25,
      minimumCollidableWidth: 0.35,
      minimumWalkableHeight: 0.8,
      minimumWalkableWidth: 1.4,
      prototypeOverrides: {
        'assets/rocks/ridge.glb': {
          tier: 'walkable',
          shape: 'compound',
          collisionScale: 0.9,
        },
      },
    },
  };
  const config = createCollisionConfig(input);
  input.rocks.prototypeOverrides['assets/rocks/ridge.glb'].collisionScale = 99;

  assert.equal(config.rocks.minimumCollidableWidth, 0.35);
  assert.equal(config.rocks.prototypeOverrides['assets/rocks/ridge.glb'].collisionScale, 0.9);
  assert.equal(Object.isFrozen(config.rocks), true);
  assert.equal(Object.isFrozen(config.rocks.prototypeOverrides['assets/rocks/ridge.glb']), true);
});

test('P4 rock policy rejects invalid thresholds and overrides', () => {
  assert.throws(
    () => createCollisionConfig({
      rocks: { minimumWalkableWidth: 0.2 },
    }),
    /minimumWalkableWidth must not be below minimumCollidableWidth/,
  );
  assert.throws(
    () => createCollisionConfig({
      rocks: { prototypeOverrides: { rock: { tier: 'solid' } } },
    }),
    /tier must be one of/,
  );
  assert.throws(
    () => createCollisionConfig({
      rocks: { prototypeOverrides: { rock: { shape: 'mesh' } } },
    }),
    /shape must be one of/,
  );
  assert.throws(
    () => createCollisionConfig({
      rocks: { prototypeOverrides: { rock: { collisionScale: 0 } } },
    }),
    /collisionScale must be positive/,
  );
  assert.throws(
    () => createCollisionConfig({
      rocks: { prototypeOverrides: { rock: null } },
    }),
    /must be an object/,
  );
});
