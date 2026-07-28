import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureCollisionP6QaFixture } from '../src/editor/collision/CollisionP6QaFixture.js';

function objectMapFixture() {
  const objects = [];
  let nextId = 1;
  return {
    objects,
    list: () => objects.map((object) => ({ ...object })),
    validatePlacement: ({ x, z }) => ({ valid: x === 4 && z === 0 }),
    place(candidate) {
      const object = { id: nextId, ...candidate };
      nextId += 1;
      objects.push(object);
      return { ...object };
    },
  };
}

test('P6 fixture is inactive outside its QA scenario', () => {
  const objectMap = objectMapFixture();

  assert.equal(ensureCollisionP6QaFixture(objectMap, '?qa=move'), null);
  assert.deepEqual(objectMap.objects, []);
});

test('P6 fixture finds a valid deterministic cottage location', () => {
  const objectMap = objectMapFixture();
  const fixture = ensureCollisionP6QaFixture(objectMap, '?qa=collision-p6');

  assert.deepEqual(fixture, {
    id: 1,
    definitionKey: 'cottage',
    x: 4,
    z: 0,
    rotation: 0,
  });
  assert.equal(objectMap.objects.length, 1);
});

test('P6 fixture enforcement is idempotent after map reload checks', () => {
  const objectMap = objectMapFixture();
  const first = ensureCollisionP6QaFixture(objectMap, '?qa=collision-p6');
  const second = ensureCollisionP6QaFixture(objectMap, '?qa=collision-p6');

  assert.deepEqual(second, first);
  assert.equal(objectMap.objects.length, 1);
});
