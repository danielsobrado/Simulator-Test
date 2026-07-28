const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}

function assertFiniteRange(value, fieldName, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${fieldName} must be within [${minimum}, ${maximum}].`);
  }
}

export function validateProjectedWaterCausticsConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('stylizedSurface.water.projectedCaustics must be an object.');
  }
  if (typeof config.enabled !== 'boolean') {
    throw new Error('stylizedSurface.water.projectedCaustics.enabled must be a boolean.');
  }
  if (typeof config.color !== 'string' || !HEX_COLOR.test(config.color)) {
    throw new Error('stylizedSurface.water.projectedCaustics.color must be a six-digit hex colour.');
  }
  assertFiniteRange(config.intensity, 'stylizedSurface.water.projectedCaustics.intensity', 0, 2);
  assertFiniteRange(config.scale, 'stylizedSurface.water.projectedCaustics.scale', 0.001, 20);
  assertFiniteRange(config.speed, 'stylizedSurface.water.projectedCaustics.speed', 0, 10);
  assertFiniteRange(config.contrast, 'stylizedSurface.water.projectedCaustics.contrast', 0.1, 8);
  assertFiniteRange(config.depthFadeStart, 'stylizedSurface.water.projectedCaustics.depthFadeStart', 0, 100);
  assertFiniteRange(config.depthFadeEnd, 'stylizedSurface.water.projectedCaustics.depthFadeEnd', 0, 200);
  assertFiniteRange(config.maxDistance, 'stylizedSurface.water.projectedCaustics.maxDistance', 1, 500);
  if (config.depthFadeEnd <= config.depthFadeStart) {
    throw new Error('stylizedSurface.water.projectedCaustics.depthFadeEnd must exceed depthFadeStart.');
  }
  return config;
}

export function computeProjectedCausticAmount({
  depthBelowSurface,
  distance,
  pattern,
  blend = 1,
  qualityStrength = 1,
  config,
}) {
  validateProjectedWaterCausticsConfig(config);
  if (!config.enabled) return 0;
  const depth = Math.max(0, Number.isFinite(depthBelowSurface) ? depthBelowSurface : 0);
  const range = Math.max(0, Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY);
  const shallow = 1 - smoothstep(config.depthFadeStart, config.depthFadeEnd, depth);
  const distanceFade = 1 - smoothstep(config.maxDistance * 0.7, config.maxDistance, range);
  const shapedPattern = Math.pow(clamp(pattern, 0, 1), config.contrast);
  return clamp(
    shapedPattern
      * shallow
      * distanceFade
      * clamp(blend, 0, 1)
      * config.intensity
      * clamp(qualityStrength, 0, 2),
    0,
    1,
  );
}
