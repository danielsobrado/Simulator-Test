import assert from 'node:assert/strict';
import test from 'node:test';

import { constructionStoneColorProfile } from '../src/editor/construction/config/ConstructionStoneColorProfiles.generated.js';
import { applyConstructionStoneColorGrade } from '../src/editor/construction/compile/ConstructionStoneColorGrade.js';

function fakeGeometry(rgb = [0.7, 0.7, 0.7], count = 4) {
  const values = Array.from({ length: count }, () => [...rgb]);
  const color = {
    count,
    needsUpdate: false,
    getX: (index) => values[index][0],
    getY: (index) => values[index][1],
    getZ: (index) => values[index][2],
    setXYZ(index, r, g, b) {
      values[index] = [r, g, b];
    },
  };
  return {
    values,
    color,
    getAttribute: (name) => (name === 'color' ? color : null),
  };
}

test('coursed rubble has a restrained warm/cool stone grade', () => {
  const profile = constructionStoneColorProfile('coursed-rubble');

  assert.equal(profile.enabled, true);
  assert.ok(profile.strength >= 0.7);
  assert.ok(profile.warm[0] > profile.warm[2]);
  assert.ok(profile.cool[2] > profile.cool[0]);
  assert.ok(profile.value.max - profile.value.min < 0.1);
  assert.ok(profile.outlier.chance <= 0.05);
});

test('stone color grade is stable per stone and uniform across its vertices', () => {
  const first = fakeGeometry();
  const second = fakeGeometry();
  const options = {
    styleKey: 'coursed-rubble',
    seed: 9123,
    stableIndex: 77,
    category: 'field',
  };

  applyConstructionStoneColorGrade(first, options);
  applyConstructionStoneColorGrade(second, options);

  assert.deepEqual(first.values, second.values);
  assert.equal(first.color.needsUpdate, true);
  for (const value of first.values.slice(1)) assert.deepEqual(value, first.values[0]);
});

test('custom stone materials bypass procedural color grading', () => {
  const geometry = fakeGeometry([0.6, 0.5, 0.4]);
  const before = structuredClone(geometry.values);

  applyConstructionStoneColorGrade(geometry, {
    styleKey: 'coursed-rubble',
    seed: 12,
    stableIndex: 4,
    category: 'field',
    hasCustomStoneMaterial: true,
  });

  assert.deepEqual(geometry.values, before);
  assert.equal(geometry.color.needsUpdate, false);
});
