import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeProjectedCausticAmount,
  validateProjectedWaterCausticsConfig,
} from '../src/editor/water/ProjectedWaterCaustics.js';

const caustics = Object.freeze({
  enabled: true,
  color: '#b9f4e5',
  intensity: 0.16,
  scale: 0.42,
  speed: 0.55,
  contrast: 2.6,
  depthFadeStart: 0.15,
  depthFadeEnd: 6,
  maxDistance: 45,
});

test('projected caustics fade with depth and distance', () => {
  assert.equal(validateProjectedWaterCausticsConfig(structuredClone(caustics)).enabled, true);
  const shallow = computeProjectedCausticAmount({
    depthBelowSurface: 0.5,
    distance: 5,
    pattern: 1,
    config: caustics,
  });
  const deep = computeProjectedCausticAmount({
    depthBelowSurface: 10,
    distance: 5,
    pattern: 1,
    config: caustics,
  });
  const far = computeProjectedCausticAmount({
    depthBelowSurface: 0.5,
    distance: 60,
    pattern: 1,
    config: caustics,
  });
  assert.ok(shallow > deep);
  assert.equal(deep, 0);
  assert.equal(far, 0);
});

test('transition and quality strength remain bounded', () => {
  const partial = computeProjectedCausticAmount({
    depthBelowSurface: 1,
    distance: 8,
    pattern: 0.8,
    blend: 0.5,
    qualityStrength: 1.3,
    config: caustics,
  });
  const full = computeProjectedCausticAmount({
    depthBelowSurface: 1,
    distance: 8,
    pattern: 0.8,
    blend: 1,
    qualityStrength: 1.3,
    config: caustics,
  });
  assert.ok(partial > 0);
  assert.ok(full > partial);
  assert.ok(full <= 1);
});

test('disabled and invalid configurations fail safely', () => {
  assert.equal(computeProjectedCausticAmount({
    depthBelowSurface: 1,
    distance: 1,
    pattern: 1,
    config: { ...structuredClone(caustics), enabled: false },
  }), 0);
  assert.throws(
    () => validateProjectedWaterCausticsConfig({
      ...structuredClone(caustics),
      depthFadeEnd: 0.1,
    }),
    /depthFadeEnd/,
  );
});
