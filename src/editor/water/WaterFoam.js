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

export function validateWaterFoamConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('stylizedSurface.water.foam must be an object.');
  }
  if (typeof config.enabled !== 'boolean') {
    throw new Error('stylizedSurface.water.foam.enabled must be a boolean.');
  }
  if (typeof config.color !== 'string' || !HEX_COLOR.test(config.color)) {
    throw new Error('stylizedSurface.water.foam.color must be a six-digit hex colour.');
  }
  assertFiniteRange(config.intensity, 'stylizedSurface.water.foam.intensity', 0, 2);
  assertFiniteRange(config.shoreWidth, 'stylizedSurface.water.foam.shoreWidth', 0.01, 50);
  assertFiniteRange(config.noiseStrength, 'stylizedSurface.water.foam.noiseStrength', 0, 1);
  assertFiniteRange(config.flowStrength, 'stylizedSurface.water.foam.flowStrength', 0, 2);
  assertFiniteRange(config.flowBandScale, 'stylizedSurface.water.foam.flowBandScale', 0.001, 20);
  assertFiniteRange(config.flowBandSpeed, 'stylizedSurface.water.foam.flowBandSpeed', 0, 10);
  assertFiniteRange(config.flowBandContrast, 'stylizedSurface.water.foam.flowBandContrast', 0.1, 8);
  assertFiniteRange(config.intersectionDepth, 'stylizedSurface.water.foam.intersectionDepth', 0.01, 10);
  assertFiniteRange(config.intersectionSoftness, 'stylizedSurface.water.foam.intersectionSoftness', 0.01, 10);
  assertFiniteRange(config.intersectionStrength, 'stylizedSurface.water.foam.intersectionStrength', 0, 2);
  return config;
}

export function computeGeographicFoam({
  shoreDistance,
  currentStrength = 0,
  flowPhase = 0,
  noise = 1,
  qualityStrength = 1,
  config,
}) {
  validateWaterFoamConfig(config);
  if (!config.enabled) return 0;
  const shore = 1 - smoothstep(0, config.shoreWidth, Math.max(0, shoreDistance));
  const band = Math.pow(
    clamp(Math.sin(Number.isFinite(flowPhase) ? flowPhase : 0) * 0.5 + 0.5, 0, 1),
    config.flowBandContrast,
  );
  const flow = clamp(currentStrength, 0, 1) * band * config.flowStrength;
  const noiseFactor = 1 + (clamp(noise, 0, 1) - 1) * config.noiseStrength;
  return clamp(
    Math.max(shore, flow) * noiseFactor * config.intensity * clamp(qualityStrength, 0, 2),
    0,
    1,
  );
}

export function computeIntersectionFoam({
  sceneGap,
  qualityStrength = 1,
  config,
}) {
  validateWaterFoamConfig(config);
  if (!config.enabled) return 0;
  const gap = Math.max(0, Number.isFinite(sceneGap) ? sceneGap : Number.POSITIVE_INFINITY);
  const contact = 1 - smoothstep(
    config.intersectionDepth,
    config.intersectionDepth + config.intersectionSoftness,
    gap,
  );
  return clamp(
    contact * config.intersectionStrength * clamp(qualityStrength, 0, 2),
    0,
    1,
  );
}
