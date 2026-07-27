import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyRockCollision,
  deriveRockCollisionProfile,
  deriveRockCollisionProfiles,
  rockCollisionProfileSignature,
} from '../src/editor/collision/providers/RockCollisionProfiles.js';
import {
  ROCK_COLLISION_SHAPE_CAPSULE,
  ROCK_COLLISION_SHAPE_COMPOUND,
  ROCK_COLLISION_SHAPE_SPHERE,
  ROCK_COLLISION_TIER_BLOCKING,
  ROCK_COLLISION_TIER_DECORATIVE,
  ROCK_COLLISION_TIER_WALKABLE,
} from '../src/editor/collision/providers/RockCollisionConstants.js';

function prototype(width, height, depth) {
  const boundingBox = {
    min: { x: -width / 2, y: 0, z: -depth / 2 },
    max: { x: width / 2, y: height, z: depth / 2 },
  };
  return {
    geometry: {
      boundingBox: null,
      computeBoundingBox() { this.boundingBox = boundingBox; },
    },
  };
}

const config = Object.freeze({
  minimumCollidableHeight: 0.3,
  minimumCollidableWidth: 0.4,
  minimumWalkableHeight: 0.7,
  minimumWalkableWidth: 1.2,
  prototypeOverrides: Object.freeze({}),
});

test('rock profile shape derivation is deterministic and immutable', () => {
  const profiles = deriveRockCollisionProfiles({
    prototypes: [
      prototype(1, 1, 1),
      prototype(4, 1, 1),
      prototype(1, 3, 1),
    ],
    prototypeKeys: ['round', 'ridge', 'pillar'],
    config,
  });

  assert.equal(profiles[0].shape, ROCK_COLLISION_SHAPE_SPHERE);
  assert.equal(profiles[1].shape, ROCK_COLLISION_SHAPE_COMPOUND);
  assert.equal(profiles[1].parts.length, 2);
  assert.equal(profiles[2].shape, ROCK_COLLISION_SHAPE_CAPSULE);
  assert.equal(Object.isFrozen(profiles), true);
  assert.equal(Object.isFrozen(profiles[1].parts), true);
  assert.equal(rockCollisionProfileSignature(profiles), rockCollisionProfileSignature(profiles));
});

test('rock tier classification uses height and footprint', () => {
  const profile = deriveRockCollisionProfile({
    prototype: prototype(1, 1, 1),
    prototypeIndex: 0,
    prototypeKey: 'rock',
    config,
  });

  assert.equal(classifyRockCollision(profile, 0.2, config), ROCK_COLLISION_TIER_DECORATIVE);
  assert.equal(classifyRockCollision(profile, 0.5, config), ROCK_COLLISION_TIER_BLOCKING);
  assert.equal(classifyRockCollision(profile, 1.3, config), ROCK_COLLISION_TIER_WALKABLE);

  const narrow = deriveRockCollisionProfile({
    prototype: prototype(0.5, 2, 0.5),
    prototypeIndex: 1,
    prototypeKey: 'narrow',
    config,
  });
  assert.equal(classifyRockCollision(narrow, 1, config), ROCK_COLLISION_TIER_BLOCKING);
});

test('asset overrides force tier, shape, and conservative scale', () => {
  const overridden = deriveRockCollisionProfile({
    prototype: prototype(4, 1, 1),
    prototypeIndex: 0,
    prototypeKey: 'assets/rocks/ridge.glb',
    config: {
      ...config,
      prototypeOverrides: {
        'assets/rocks/ridge.glb': {
          tier: 'decorative',
          shape: 'capsule',
          collisionScale: 0.75,
        },
      },
    },
  });

  assert.equal(overridden.shape, ROCK_COLLISION_SHAPE_CAPSULE);
  assert.equal(overridden.width, 3);
  assert.equal(overridden.forcedTier, ROCK_COLLISION_TIER_DECORATIVE);
  assert.equal(classifyRockCollision(overridden, 10, config), ROCK_COLLISION_TIER_DECORATIVE);
});
