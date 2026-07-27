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
  [WATER_QUALITY_LOW]: Object.freeze({ flow: false, caustics: false, causticStrength: 0 }),
  [WATER_QUALITY_MEDIUM]: Object.freeze({ flow: true, caustics: false, causticStrength: 0 }),
  [WATER_QUALITY_HIGH]: Object.freeze({ flow: true, caustics: true, causticStrength: 1 }),
  [WATER_QUALITY_ULTRA]: Object.freeze({ flow: true, caustics: true, causticStrength: 1.35 }),
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
  return waterConfig;
}
