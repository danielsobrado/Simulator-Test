import assert from 'node:assert/strict';
import test from 'node:test';
import {
  naturalTrailFieldAt,
  naturalTrailMaskAt,
  normalizeNaturalTrailConfig,
} from '../src/editor/stylized/naturalTrailMath.js';

const TRAIL = Object.freeze({
  enabled: true,
  scale: 0.018,
  level: 0.08,
  width: 0.038,
  softness: 0.035,
  warp: 0.9,
  clearThreshold: 0.42,
});

test('natural trail field is deterministic in absolute world space', () => {
  const first = naturalTrailFieldAt(137.25, -91.75, TRAIL);
  const second = naturalTrailFieldAt(137.25, -91.75, TRAIL);
  assert.equal(first, second);
  assert.equal(Number.isFinite(first), true);
});

test('natural trail mask stays disabled unless explicitly enabled', () => {
  assert.equal(naturalTrailMaskAt(0, 0, { ...TRAIL, enabled: false }), 0);
  assert.equal(naturalTrailMaskAt(0, 0), 0);
});

test('world-scale contour yields narrow trails separated by dense ground', () => {
  let trailSamples = 0;
  let denseSamples = 0;
  const totalPerAxis = 161;
  for (let zIndex = 0; zIndex < totalPerAxis; zIndex += 1) {
    for (let xIndex = 0; xIndex < totalPerAxis; xIndex += 1) {
      const mask = naturalTrailMaskAt(
        (xIndex - 80) * 4,
        (zIndex - 80) * 4,
        TRAIL,
      );
      if (mask >= TRAIL.clearThreshold) trailSamples += 1;
      if (mask <= 0.01) denseSamples += 1;
    }
  }
  const total = totalPerAxis * totalPerAxis;
  assert.ok(trailSamples / total > 0.04, 'trail should remain visible');
  assert.ok(trailSamples / total < 0.25, 'trail should not become mottled fill');
  assert.ok(denseSamples / total > 0.65, 'most ground should remain densely vegetated');
});

test('normalization clamps clearance threshold without changing valid values', () => {
  assert.equal(normalizeNaturalTrailConfig(TRAIL).clearThreshold, 0.42);
  assert.equal(normalizeNaturalTrailConfig({ clearThreshold: -2 }).clearThreshold, 0);
  assert.equal(normalizeNaturalTrailConfig({ clearThreshold: 4 }).clearThreshold, 1);
});
