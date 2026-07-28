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
    surfaceTransitionDepth: 0.75,
    surfaceDetailStrength: 0.28,
    underwaterTintStrength: 0.35,
  }),
  refraction: Object.freeze({
    enabled: true,
    strength: 0.012,
    coarseScale: 0.045,
    fineScale: 0.16,
    coarseSpeed: 0.05,
    fineSpeed: 0.13,
    depthFadeStart: 0.08,
    depthFadeEnd: 1.8,
    depthBiasMeters: 0.15,
    mipLevel: 0,
    sceneColorStrength: 0.94,
    absorptionCoefficients: Object.freeze([0.72, 0.28, 0.12]),
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
    refraction: false,
    refractionStrength: 0,
    caustics: false,
    causticStrength: 0,
  });
  const medium = resolveWaterQualityFeatures({ qualityTier: 'medium' });
  assert.equal(medium.flow, true);
  assert.equal(medium.depthOptics, true);
  assert.equal(medium.refraction, false);
  assert.equal(medium.caustics, false);
  assert.equal(resolveWaterQualityFeatures({ qualityTier: 'high' }).refraction, true);
  assert.ok(resolveWaterQualityFeatures({ qualityTier: 'ultra' }).refractionStrength > 1);
  assert.ok(resolveWaterQualityFeatures({ qualityTier: 'ultra' }).causticStrength > 1);
});

test('visual config rejects invalid tiers, optics, refraction, and caustic ranges', () => {
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
      optics: { ...base.optics, surfaceTransitionDepth: 0 },
    }),
    /surfaceTransitionDepth/,
  );
  assert.throws(
    () => validateWaterVisualConfig({
      ...structuredClone(base),
      refraction: { ...base.refraction, depthFadeEnd: 0.01 },
    }),
    /depthFadeEnd/,
  );
  assert.throws(
    () => validateWaterVisualConfig({
      ...structuredClone(base),
      refraction: { ...base.refraction, depthBiasMeters: -1 },
    }),
    /depthBiasMeters/,
  );
  assert.throws(
    () => validateWaterVisualConfig({
      ...structuredClone(base),
      refraction: { ...base.refraction, absorptionCoefficients: [0.2, 0.1] },
    }),
    /absorptionCoefficients/,
  );
  assert.throws(
    () => validateWaterVisualConfig({
      ...structuredClone(base),
      caustics: { ...base.caustics, depthFadeEnd: 0.1 },
    }),
    /depthFadeEnd/,
  );
});
