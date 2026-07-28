import assert from 'node:assert/strict';
import test from 'node:test';
import { createObjectColliderDescriptions } from '../src/editor/ObjectColliderLibrary.js';

function collision(policy = 'solid', overrides = {}) {
  return Object.freeze({
    policy,
    profile: 'cottage',
    allowFootprintOverflow: false,
    scale: Object.freeze({ x: 1, y: 1, z: 1 }),
    offset: Object.freeze({ x: 0, y: 0, z: 0 }),
    ...overrides,
  });
}

function definition(overrides = {}) {
  return Object.freeze({
    key: 'cottage',
    model: 'cottage',
    footprint: Object.freeze({ width: 2, depth: 2 }),
    collision: collision(),
    ...overrides,
  });
}

function containsPoint(box, x, y, z) {
  assert.equal(box.type, 'box');
  const halfX = box.dimensions[0] / 2;
  const halfY = box.dimensions[1] / 2;
  const halfZ = box.dimensions[2] / 2;
  return Math.abs(x - box.position[0]) <= halfX
    && Math.abs(y - box.position[1]) <= halfY
    && Math.abs(z - box.position[2]) <= halfZ;
}

test('cottage collider is a compound shell with a player-height doorway', () => {
  const descriptions = createObjectColliderDescriptions(definition(), 2);
  const frontZ = 2 * 1.4 / 2 - 2 * 0.14 / 2;

  assert.ok(descriptions.length >= 5);
  assert.ok(descriptions.some((entry) => entry.partId === 'wall-front-left'));
  assert.ok(descriptions.some((entry) => entry.partId === 'wall-front-right'));
  assert.equal(
    descriptions.some((entry) => containsPoint(entry, 0, 1.77, frontZ)),
    false,
    'the player capsule must fit under the doorway clearance',
  );
  assert.equal(
    descriptions.some((entry) => containsPoint(entry, -1.3, 0.9, frontZ)),
    true,
    'front wall material outside the doorway must remain solid',
  );
  assert.equal(
    descriptions.some((entry) => containsPoint(entry, 0, 0.9, -frontZ)),
    true,
    'the rear wall must remain solid',
  );
});

test('decorative policy emits no collider descriptions', () => {
  const descriptions = createObjectColliderDescriptions(definition({
    collision: collision('none'),
  }), 2);
  assert.deepEqual(descriptions, []);
});

test('catalog offsets cannot silently exceed the reserved footprint', () => {
  assert.throws(
    () => createObjectColliderDescriptions(definition({
      collision: collision('solid', {
        offset: Object.freeze({ x: 10, y: 0, z: 0 }),
      }),
    }), 2),
    /exceeds its reserved footprint/,
  );
});
