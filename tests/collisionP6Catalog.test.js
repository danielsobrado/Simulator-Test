import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OBJECT_COLLISION_POLICY_NONE,
  OBJECT_COLLISION_POLICY_SOLID,
  OBJECT_COLLISION_POLICY_TRIGGER,
  OBJECT_COLLISION_POLICY_WALKABLE,
} from '../src/editor/ObjectCollisionPolicy.js';
import { createObjectCatalog } from '../src/editor/objectCatalogSchema.js';

const TILE_BY_KEY = new Map([[
  'grassland',
  Object.freeze({ id: 4, terrainClass: 'land' }),
]]);

function definition(overrides = {}) {
  return {
    key: 'cottage',
    label: 'Cottage',
    icon: 'house',
    category: 'building',
    color: '#ffffff',
    model: 'cottage',
    footprint: { width: 2, depth: 2 },
    foundation: {
      mode: 'terrace',
      maxSlopeDegrees: 20,
      maxDepth: 3,
      alignToNormal: false,
      color: '#555555',
    },
    allowedTerrain: ['grassland'],
    ...overrides,
  };
}

function catalogFor(raw) {
  return createObjectCatalog(raw, TILE_BY_KEY);
}

test('object collision policy defaults are defined by model and category', () => {
  const catalog = catalogFor([
    definition(),
    definition({ key: 'bush', model: 'bush', category: 'nature' }),
    definition({ key: 'campfire', model: 'campfire', category: 'civic' }),
  ]);

  assert.equal(catalog[0].collision.policy, OBJECT_COLLISION_POLICY_SOLID);
  assert.equal(catalog[1].collision.policy, OBJECT_COLLISION_POLICY_NONE);
  assert.equal(catalog[2].collision.policy, OBJECT_COLLISION_POLICY_TRIGGER);
});

test('object collision overrides are validated, copied, and immutable', () => {
  const rawCollision = {
    policy: OBJECT_COLLISION_POLICY_WALKABLE,
    profile: 'wall',
    allowFootprintOverflow: true,
    scale: { x: 0.8, y: 1.2, z: 0.7 },
    offset: { x: 0.1, y: 0.2, z: -0.3 },
  };
  const [entry] = catalogFor([definition({ collision: rawCollision })]);
  rawCollision.scale.x = 99;
  rawCollision.offset.z = 99;

  assert.equal(entry.collision.policy, OBJECT_COLLISION_POLICY_WALKABLE);
  assert.equal(entry.collision.profile, 'wall');
  assert.equal(entry.collision.allowFootprintOverflow, true);
  assert.deepEqual(entry.collision.scale, { x: 0.8, y: 1.2, z: 0.7 });
  assert.deepEqual(entry.collision.offset, { x: 0.1, y: 0.2, z: -0.3 });
  assert.equal(Object.isFrozen(entry.collision), true);
  assert.equal(Object.isFrozen(entry.collision.scale), true);
});

test('object collision catalog rejects invalid policy and dimensions', () => {
  assert.throws(
    () => catalogFor([definition({ collision: { policy: 'opaque' } })]),
    /invalid collision policy/,
  );
  assert.throws(
    () => catalogFor([definition({ collision: { scale: { x: 0, y: 1, z: 1 } } })]),
    /collision scale.x/,
  );
  assert.throws(
    () => catalogFor([definition({ collision: { offset: { x: 0, y: Number.NaN, z: 0 } } })]),
    /collision offset.y/,
  );
});
