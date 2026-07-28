import assert from 'node:assert/strict';
import test from 'node:test';
import {
  resolveWaterQualityFeatures,
  validateWaterVisualConfig,
} from '../src/editor/water/WaterQuality.js';

const base = Object.freeze({
  qualityTier: 'high',
  currentAnimationSpeed: 0.2,
  currentInfluence: 0.8,
  optics: Object.freeze({
    shallowColor: '#72d8e8',
    deepColor: '#0b4a68',
    underwaterColor: '#15596d',
    absorptionDensity: 0.42,
    minimumOpacity: 0.08,
    maximumOpacity: 0.94,
    shallowDepth: 0.2,
    deepDepth: 6,
    maximumOpticalDistance: 14,
    minimumViewCosine: 0.22,
    surfaceDetailStrength: 0.28,
    underwaterTintStrength: 0.35,
  }),
  caustics: Object.freeze({
    intensity: 0.2,
    scale: 0.4,
    speed: 0.1,
    contrast: 2,
    depthFadeStart: 0.3,
    depthFadeEnd: 4,
  }),
});

test('quality tiers preserve geography while selecting bounded visual features', () => {
  assert.deepEqual(resolveWaterQualityFeatures({ qualityTier: 'low' }), {
    flow: false,
    depthOptics: false,
    caustics: false,
    causticStrength: 0,
  });
  assert.equal(resolveWaterQualityFeatures({ qualityTier: 'medium' }).flow, true);
  assert.equal(resolveWaterQualityFeatures({ qualityTier: 'medium' }).depthOptics, true);
  assert.equal(resolveWaterQualityFeatures({ qualityTier: 'medium' }).caustics, false);
  assert.equal(resolveWaterQualityFeatures({ qualityTier: 'high' }).caustics, true);
  assert.ok(resolveWaterQualityFeatures({ qualityTier: 'ultra' }).causticStrength > 1);
});

test('visual config rejects invalid tiers, optics, and caustic ranges', () => {
  assert.equal(validateWaterVisualConfig(structuredClone(base)).qualityTier, 'high');
  assert.throws(
    () => validateWaterVisualConfig({ ...structuredClone(base), qualityTier: 'cinematic' }),
    /qualityTier/,
  );
  assert.throws(
    () => validateWaterVisualConfig({
      ...structuredClone(base),
      optics: { ...base.optics, minimumViewCosine: 0 },
    }),
    /minimumViewCosine/,
  );
  assert.throws(
    () => validateWaterVisualConfig({
      ...structuredClone(base),
      caustics: { ...base.caustics, depthFadeEnd: 0.1 },
    }),
    /depthFadeEnd/,
  );
});
