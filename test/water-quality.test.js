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
    shorelineFadeDepth: 0.35,
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
  foam: Object.freeze({
    enabled: true,
    color: '#e8fbff',
    intensity: 0.78,
    shoreWidth: 1.6,
    noiseStrength: 0.42,
    flowStrength: 0.32,
    flowBandScale: 0.58,
    flowBandSpeed: 0.42,
    flowBandContrast: 2.4,
    intersectionDepth: 0.28,
    intersectionSoftness: 0.38,
    intersectionStrength: 0.82,
  }),
  caustics: Object.freeze({
    intensity: 0.2,
    scale: 0.4,
    speed: 0.1,
    contrast: 2,
    depthFadeStart: 0.3,
    depthFadeEnd: 4,
  }),
  projectedCaustics: Object.freeze({
    enabled: true,
    color: '#b9f4e5',
    intensity: 0.16,
    scale: 0.42,
    speed: 0.55,
    contrast: 2.6,
    depthFadeStart: 0.15,
    depthFadeEnd: 6,
    maxDistance: 45,
  }),
});

test('quality tiers preserve geography while selecting bounded visual features', () => {
  assert.deepEqual(resolveWaterQualityFeatures({ qualityTier: 'low' }), {
    flow: false,
    cellularSurface: false,
    fresnelStrength: 0,
    depthOptics: false,
    refraction: false,
    refractionStrength: 0,
    foam: false,
    foamStrength: 0,
    intersectionFoam: false,
    intersectionFoamStrength: 0,
    caustics: false,
    causticStrength: 0,
    projectedCaustics: false,
    projectedCausticStrength: 0,
  });
  const medium = resolveWaterQualityFeatures({ qualityTier: 'medium' });
  assert.equal(medium.flow, true);
  assert.equal(medium.cellularSurface, true);
  assert.ok(medium.fresnelStrength > 0);
  assert.equal(medium.depthOptics, true);
  assert.equal(medium.refraction, false);
  assert.equal(medium.foam, true);
  assert.equal(medium.intersectionFoam, false);
  assert.equal(medium.caustics, false);
  assert.equal(medium.projectedCaustics, false);
  const high = resolveWaterQualityFeatures({ qualityTier: 'high' });
  assert.equal(high.refraction, true);
  assert.equal(high.intersectionFoam, true);
  assert.equal(high.projectedCaustics, true);
  assert.ok(high.fresnelStrength > medium.fresnelStrength);
  const ultra = resolveWaterQualityFeatures({ qualityTier: 'ultra' });
  assert.ok(ultra.refractionStrength > 1);
  assert.ok(ultra.foamStrength > 1);
  assert.ok(ultra.causticStrength > 1);
  assert.ok(ultra.projectedCausticStrength > 1);
  assert.ok(ultra.fresnelStrength > high.fresnelStrength);
});

test('visual config rejects invalid W2 optics and surface effects', () => {
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
      refraction: { ...base.refraction, depthBiasMeters: -1 },
    }),
    /depthBiasMeters/,
  );
  assert.throws(
    () => validateWaterVisualConfig({
      ...structuredClone(base),
      foam: { ...base.foam, shoreWidth: 0 },
    }),
    /shoreWidth/,
  );
  assert.throws(
    () => validateWaterVisualConfig({
      ...structuredClone(base),
      projectedCaustics: { ...base.projectedCaustics, depthFadeEnd: 0.1 },
    }),
    /depthFadeEnd/,
  );
  assert.throws(
    () => validateWaterVisualConfig({
      ...structuredClone(base),
      caustics: { ...base.caustics, depthFadeEnd: 0.1 },
    }),
    /depthFadeEnd/,
  );
});
