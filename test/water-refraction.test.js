import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeRefractionOffset,
  filterRefractedSceneColor,
  isRefractionDepthValid,
  validateWaterRefractionConfig,
} from '../src/editor/water/WaterRefraction.js';

const refraction = Object.freeze({
  enabled: true,
  strength: 0.012,
  coarseScale: 0.045,
  fineScale: 0.16,
  coarseSpeed: 0.05,
  fineSpeed: 0.13,
  depthFadeStart: 0.08,
  depthFadeEnd: 1.8,
  depthBias: 0.00012,
  mipLevel: 0,
  sceneColorStrength: 0.94,
  absorptionCoefficients: Object.freeze([0.72, 0.28, 0.12]),
});

test('refraction distortion fades in with depth and remains bounded', () => {
  assert.equal(validateWaterRefractionConfig(structuredClone(refraction)).enabled, true);
  const shore = computeRefractionOffset({
    coarse: { x: 1, y: -1 },
    fine: { x: 1, y: -1 },
    depth: 0,
    config: refraction,
  });
  const deep = computeRefractionOffset({
    coarse: { x: 1, y: -1 },
    fine: { x: 1, y: -1 },
    depth: 4,
    qualityScale: 1.25,
    config: refraction,
  });
  assert.equal(shore.x, 0);
  assert.equal(shore.y, 0);
  assert.ok(deep.x > 0);
  assert.ok(deep.y < 0);
  assert.ok(Math.abs(deep.x) <= refraction.strength * 1.25);
  assert.ok(Math.abs(deep.y) <= refraction.strength * 1.25);
});

test('foreground distorted samples are rejected', () => {
  assert.equal(isRefractionDepthValid({
    waterLinearDepth: 0.4,
    sampleLinearDepth: 0.7,
    depthBias: refraction.depthBias,
  }), true);
  assert.equal(isRefractionDepthValid({
    waterLinearDepth: 0.4,
    sampleLinearDepth: 0.2,
    depthBias: refraction.depthBias,
  }), false);
  assert.equal(isRefractionDepthValid({
    waterLinearDepth: 0.4,
    sampleLinearDepth: 0.40005,
    depthBias: refraction.depthBias,
  }), false);
});

test('RGB absorption removes red faster than green and blue', () => {
  const filtered = filterRefractedSceneColor({
    sceneColor: [1, 1, 1],
    bodyColor: [0.05, 0.25, 0.35],
    opticalDistance: 4,
    absorptionCoefficients: refraction.absorptionCoefficients,
    sceneColorStrength: 1,
  });
  assert.ok(filtered.transmission[0] < filtered.transmission[1]);
  assert.ok(filtered.transmission[1] < filtered.transmission[2]);
  assert.ok(filtered.color[0] < filtered.color[1]);
  assert.ok(filtered.color[1] < filtered.color[2]);
});

test('disabled refraction produces no offset and malformed coefficients fail', () => {
  const disabled = { ...structuredClone(refraction), enabled: false };
  assert.deepEqual(computeRefractionOffset({
    coarse: { x: 1, y: 1 },
    fine: { x: 1, y: 1 },
    depth: 10,
    config: disabled,
  }), { x: 0, y: 0, depthFactor: 1 });
  assert.throws(
    () => validateWaterRefractionConfig({
      ...structuredClone(refraction),
      absorptionCoefficients: [0.2, -0.1, 0.05],
    }),
    /absorptionCoefficients\[1\]/,
  );
});
