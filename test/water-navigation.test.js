import assert from 'node:assert/strict';
import test from 'node:test';
import { createWaterNavigationSample } from '../src/editor/water/WaterNavigation.js';

const deep = Object.freeze({
  kind: 2,
  bodyId: 9,
  coverage: 1,
  surfaceHeight: 12,
  bedHeight: 8,
  depth: 4,
  shoreDistance: 3,
  flowX: 0.6,
  flowZ: 0.8,
});

test('navigation samples expose body, depth, and current without changing geography', () => {
  const result = createWaterNavigationSample(deep, {
    minimumDepth: 2,
    minimumShoreDistance: 1,
    maximumCurrent: 1,
  });
  assert.equal(result.navigable, true);
  assert.equal(result.bodyId, deep.bodyId);
  assert.equal(result.depth, deep.depth);
  assert.equal(result.currentStrength, 1);
});

test('navigation rejects shallow, shoreline, strong-current, and disallowed water', () => {
  assert.equal(createWaterNavigationSample({ ...deep, depth: 0.4 }).navigable, false);
  assert.equal(createWaterNavigationSample({ ...deep, shoreDistance: 0.2 }).navigable, false);
  assert.equal(createWaterNavigationSample(deep, { maximumCurrent: 0.5 }).navigable, false);
  assert.equal(createWaterNavigationSample(deep, { allowedKinds: [1, 3] }).navigable, false);
});
