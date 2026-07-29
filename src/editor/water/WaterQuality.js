import { validateWaterOpticsConfig } from './WaterOptics.js';
import { validateWaterRefractionConfig } from './WaterRefraction.js';
import { validateWaterFoamConfig } from './WaterFoam.js';
import { validateProjectedWaterCausticsConfig } from './ProjectedWaterCaustics.js';

export const WATER_QUALITY_LOW = 'low';
export const WATER_QUALITY_MEDIUM = 'medium';
export const WATER_QUALITY_HIGH = 'high';
export const WATER_QUALITY_ULTRA = 'ultra';

export const WATER_QUALITY_TIERS = Object.freeze([
  WATER_QUALITY_LOW,
  WATER_QUALITY_MEDIUM,
  WATER_QUALITY_HIGH,
  WATER_QUALITY_ULTRA,
]);

const FEATURES_BY_TIER = Object.freeze({
  [WATER_QUALITY_LOW]: Object.freeze({
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
  }),
  [WATER_QUALITY_MEDIUM]: Object.freeze({
    flow: true,
    cellularSurface: true,
    fresnelStrength: 0.28,
    depthOptics: true,
    refraction: false,
    refractionStrength: 0,
    foam: true,
    foamStrength: 0.75,
    intersectionFoam: false,
    intersectionFoamStrength: 0,
    caustics: false,
    causticStrength: 0,
    projectedCaustics: false,
    projectedCausticStrength: 0,
  }),
  [WATER_QUALITY_HIGH]: Object.freeze({
    flow: true,
    cellularSurface: true,
    fresnelStrength: 0.42,
    depthOptics: true,
    refraction: true,
    refractionStrength: 1,
    foam: true,
    foamStrength: 1,
    intersectionFoam: true,
    intersectionFoamStrength: 1,
    caustics: true,
    causticStrength: 1,
    projectedCaustics: true,
    projectedCausticStrength: 1,
  }),
  [WATER_QUALITY_ULTRA]: Object.freeze({
    flow: true,
    cellularSurface: true,
    fresnelStrength: 0.52,
    depthOptics: true,
    refraction: true,
    refractionStrength: 1.25,
    foam: true,
    foamStrength: 1.2,
    intersectionFoam: true,
    intersectionFoamStrength: 1.15,
    caustics: true,
    causticStrength: 1.35,
    projectedCaustics: true,
    projectedCausticStrength: 1.3,
  }),
});

function assertFiniteRange(value, fieldName, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${fieldName} must be within [${minimum}, ${maximum}].`);
  }
}

export function resolveWaterQualityFeatures(waterConfig = {}) {
  const tier = WATER_QUALITY_TIERS.includes(waterConfig.qualityTier)
    ? waterConfig.qualityTier
    : WATER_QUALITY_HIGH;
  return FEATURES_BY_TIER[tier];
}

export function validateWaterVisualConfig(waterConfig) {
  if (!waterConfig || typeof waterConfig !== 'object' || Array.isArray(waterConfig)) {
    throw new Error('stylizedSurface.water must be an object.');
  }
  if (!WATER_QUALITY_TIERS.includes(waterConfig.qualityTier)) {
    throw new Error(`stylizedSurface.water.qualityTier must be one of: ${WATER_QUALITY_TIERS.join(', ')}.`);
  }
  assertFiniteRange(waterConfig.currentAnimationSpeed, 'stylizedSurface.water.currentAnimationSpeed', 0, 4);
  assertFiniteRange(waterConfig.currentInfluence, 'stylizedSurface.water.currentInfluence', 0, 2);
  validateWaterOpticsConfig(waterConfig.optics);
  validateWaterRefractionConfig(waterConfig.refraction);
  validateWaterFoamConfig(waterConfig.foam);

  const caustics = waterConfig.caustics;
  if (!caustics || typeof caustics !== 'object' || Array.isArray(caustics)) {
    throw new Error('stylizedSurface.water.caustics must be an object.');
  }
  assertFiniteRange(caustics.intensity, 'stylizedSurface.water.caustics.intensity', 0, 2);
  assertFiniteRange(caustics.scale, 'stylizedSurface.water.caustics.scale', 0.001, 10);
  assertFiniteRange(caustics.speed, 'stylizedSurface.water.caustics.speed', 0, 4);
  assertFiniteRange(caustics.contrast, 'stylizedSurface.water.caustics.contrast', 0.1, 8);
  assertFiniteRange(caustics.depthFadeStart, 'stylizedSurface.water.caustics.depthFadeStart', 0, 100);
  assertFiniteRange(caustics.depthFadeEnd, 'stylizedSurface.water.caustics.depthFadeEnd', 0, 100);
  if (caustics.depthFadeEnd <= caustics.depthFadeStart) {
    throw new Error('stylizedSurface.water.caustics.depthFadeEnd must exceed depthFadeStart.');
  }
  validateProjectedWaterCausticsConfig(waterConfig.projectedCaustics);
  return waterConfig;
}
