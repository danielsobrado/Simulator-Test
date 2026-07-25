import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_IRREGULARITY,
  IRREGULARITY_CATEGORY_SCALE,
  LEGACY_IRREGULARITY,
  irregularityAmount,
  offsetAlongLocalY,
  stoneJitter,
} from '../src/editor/workshop/ProceduralWorkshopIrregularity.js';

function recipe(overrides = {}) {
  return {
    seed: 1848,
    detail: 2,
    irregularity: DEFAULT_IRREGULARITY,
    ...overrides,
  };
}

const params = Object.freeze({
  width: 0.8,
  height: 0.4,
  depth: 0.3,
  position: [1, 2, 3],
  rotation: [0, 0, 0],
});

test('irregularity of zero produces no shaping at all', () => {
  const shaped = stoneJitter(recipe({ irregularity: 0 }), params, 17);
  assert.equal(shaped.width, params.width);
  assert.equal(shaped.height, params.height);
  assert.equal(shaped.depth, params.depth);
  // Compared by magnitude: scaling a negative lane by zero yields -0, which is
  // not strictly equal to 0 but is the same offset.
  for (const value of shaped.rotation) assert.equal(Math.abs(value), 0);
  for (const value of shaped.skew) assert.equal(Math.abs(value), 0);
  assert.deepEqual(shaped.position, [1, 2, 3]);
  assert.equal(Math.abs(shaped.protrusion), 0);
});

test('jitter magnitude scales monotonically with irregularity', () => {
  let previous = 0;
  for (const irregularity of [0, 0.25, 0.5, 0.75, 1]) {
    let total = 0;
    for (let index = 0; index < 400; index += 1) {
      const shaped = stoneJitter(recipe({ irregularity }), params, index);
      total += Math.abs(shaped.width - params.width)
        + Math.abs(shaped.rotation[2])
        + Math.abs(shaped.protrusion);
    }
    assert.ok(total >= previous, `irregularity ${irregularity} did not increase shaping`);
    previous = total;
  }
  assert.ok(previous > 0);
});

test('structural dressings are shaped less than field masonry', () => {
  const measure = (category) => {
    let total = 0;
    for (let index = 0; index < 400; index += 1) {
      const shaped = stoneJitter(recipe({ irregularity: 1 }), params, index, category);
      total += Math.abs(shaped.width - params.width) + Math.abs(shaped.protrusion);
    }
    return total;
  };
  const field = measure('field');
  // 04-…md §8: stronger irregularity for rubble, reduced at structural dressings.
  for (const category of ['coping', 'ashlar', 'quoin', 'voussoir']) {
    assert.ok(
      measure(category) < field,
      `${category} should be shaped less than field masonry`,
    );
  }
  assert.ok(measure('voussoir') < measure('ashlar'));
});

test('category scale and the legacy default are exposed and bounded', () => {
  assert.equal(irregularityAmount(recipe({ irregularity: 1 }), 'field'), 1);
  assert.equal(
    irregularityAmount(recipe({ irregularity: 1 }), 'quoin'),
    IRREGULARITY_CATEGORY_SCALE.quoin,
  );
  // Out-of-range input is clamped rather than trusted.
  assert.equal(irregularityAmount(recipe({ irregularity: 9 }), 'field'), 1);
  assert.equal(irregularityAmount(recipe({ irregularity: -3 }), 'field'), 0);
  // Missing values fall back to the current default, not to zero.
  assert.equal(irregularityAmount({ seed: 1 }, 'field'), DEFAULT_IRREGULARITY);
  assert.ok(LEGACY_IRREGULARITY < DEFAULT_IRREGULARITY);
});

test('shape and rotation lanes are decorrelated', () => {
  // Before the three-hash split, several lanes were cut from overlapping bits of
  // one 32-bit hash, so a wide stone tended to rotate the same way every time.
  let sum = 0;
  let sumWidth = 0;
  let sumRotation = 0;
  let sumWidthSq = 0;
  let sumRotationSq = 0;
  const samples = 4000;
  for (let index = 0; index < samples; index += 1) {
    const shaped = stoneJitter(recipe({ irregularity: 1 }), params, index);
    const width = shaped.width - params.width;
    const rotation = shaped.rotation[2];
    sum += width * rotation;
    sumWidth += width;
    sumRotation += rotation;
    sumWidthSq += width * width;
    sumRotationSq += rotation * rotation;
  }
  const covariance = sum / samples - (sumWidth / samples) * (sumRotation / samples);
  const deviation = Math.sqrt(sumWidthSq / samples - (sumWidth / samples) ** 2)
    * Math.sqrt(sumRotationSq / samples - (sumRotation / samples) ** 2);
  assert.ok(
    Math.abs(covariance / deviation) < 0.08,
    `width and roll are still correlated: r = ${covariance / deviation}`,
  );
});

test('protrusion follows the unit orientation, not world axes', () => {
  // A tower block yawed a quarter turn must protrude along world X, radially,
  // rather than along world Z.
  const yawed = { ...params, rotation: [0, Math.PI / 2, 0], position: [0, 0, 0] };
  let found = false;
  for (let index = 0; index < 200 && !found; index += 1) {
    const shaped = stoneJitter(recipe({ irregularity: 1 }), yawed, index);
    if (Math.abs(shaped.protrusion) < 0.01) continue;
    found = true;
    assert.ok(
      Math.abs(shaped.position[0]) > Math.abs(shaped.protrusion) * 0.9,
      'a quarter-turn yaw should push the stone along world X',
    );
    // Not exactly zero: the yaw itself is jittered, so a little of the offset
    // leaks into Z. World X must still dominate by a wide margin.
    assert.ok(
      Math.abs(shaped.position[0]) > Math.abs(shaped.position[2]) * 10,
      `offset was not predominantly along X: ${shaped.position}`,
    );
  }
  assert.ok(found, 'expected at least one protruding stone');
});

test('the local Y axis helper matches known rotations', () => {
  const near = (actual, expected) => assert.ok(
    Math.abs(actual - expected) < 1e-9,
    `${actual} !== ${expected}`,
  );
  const identity = offsetAlongLocalY([0, 0, 0], 1);
  near(identity[0], 0);
  near(identity[1], 1);
  near(identity[2], 0);
  // A quarter-turn pitch about X carries +Y onto +Z.
  const pitched = offsetAlongLocalY([Math.PI / 2, 0, 0], 1);
  near(pitched[0], 0);
  near(pitched[1], 0);
  near(pitched[2], 1);
});

test('jitter is a pure function of seed and stable index', () => {
  const first = stoneJitter(recipe(), params, 991, 'field');
  const second = stoneJitter(recipe(), params, 991, 'field');
  assert.deepEqual(first, second);
  // Seed locality: a different index must not reproduce the same shape.
  assert.notDeepEqual(stoneJitter(recipe(), params, 992, 'field'), first);
  // A different seed reshapes the same index.
  assert.notDeepEqual(stoneJitter(recipe({ seed: 99 }), params, 991, 'field'), first);
});
