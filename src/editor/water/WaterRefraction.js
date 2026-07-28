const CHANNEL_COUNT = 3;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function assertFiniteRange(value, fieldName, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${fieldName} must be within [${minimum}, ${maximum}].`);
  }
}

function assertAbsorptionCoefficients(value) {
  if (!Array.isArray(value) || value.length !== CHANNEL_COUNT) {
    throw new Error('stylizedSurface.water.refraction.absorptionCoefficients must contain three values.');
  }
  value.forEach((coefficient, index) => {
    assertFiniteRange(
      coefficient,
      `stylizedSurface.water.refraction.absorptionCoefficients[${index}]`,
      0,
      10,
    );
  });
}

export function validateWaterRefractionConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('stylizedSurface.water.refraction must be an object.');
  }
  if (typeof config.enabled !== 'boolean') {
    throw new Error('stylizedSurface.water.refraction.enabled must be a boolean.');
  }
  assertFiniteRange(config.strength, 'stylizedSurface.water.refraction.strength', 0, 0.1);
  assertFiniteRange(config.coarseScale, 'stylizedSurface.water.refraction.coarseScale', 0.001, 10);
  assertFiniteRange(config.fineScale, 'stylizedSurface.water.refraction.fineScale', 0.001, 20);
  assertFiniteRange(config.coarseSpeed, 'stylizedSurface.water.refraction.coarseSpeed', 0, 4);
  assertFiniteRange(config.fineSpeed, 'stylizedSurface.water.refraction.fineSpeed', 0, 4);
  assertFiniteRange(config.depthFadeStart, 'stylizedSurface.water.refraction.depthFadeStart', 0, 100);
  assertFiniteRange(config.depthFadeEnd, 'stylizedSurface.water.refraction.depthFadeEnd', 0, 100);
  assertFiniteRange(config.depthBias, 'stylizedSurface.water.refraction.depthBias', 0, 0.1);
  assertFiniteRange(config.mipLevel, 'stylizedSurface.water.refraction.mipLevel', 0, 8);
  assertFiniteRange(
    config.sceneColorStrength,
    'stylizedSurface.water.refraction.sceneColorStrength',
    0,
    1,
  );
  assertAbsorptionCoefficients(config.absorptionCoefficients);
  if (config.depthFadeEnd <= config.depthFadeStart) {
    throw new Error('stylizedSurface.water.refraction.depthFadeEnd must exceed depthFadeStart.');
  }
  return config;
}

export function computeRefractionOffset({
  coarse = { x: 0, y: 0 },
  fine = { x: 0, y: 0 },
  depth = 0,
  qualityScale = 1,
  config,
}) {
  validateWaterRefractionConfig(config);
  const safeDepth = Math.max(0, Number.isFinite(depth) ? depth : 0);
  const depthFactor = smoothstep(config.depthFadeStart, config.depthFadeEnd, safeDepth);
  const scale = config.enabled
    ? config.strength * clamp(qualityScale, 0, 2) * depthFactor
    : 0;
  return Object.freeze({
    x: (clamp(coarse.x, -1, 1) * 0.65 + clamp(fine.x, -1, 1) * 0.35) * scale,
    y: (clamp(coarse.y, -1, 1) * 0.65 + clamp(fine.y, -1, 1) * 0.35) * scale,
    depthFactor,
  });
}

export function isRefractionDepthValid({
  waterLinearDepth,
  sampleLinearDepth,
  depthBias,
}) {
  if (!Number.isFinite(waterLinearDepth) || !Number.isFinite(sampleLinearDepth)) return false;
  const bias = Math.max(0, Number.isFinite(depthBias) ? depthBias : 0);
  return sampleLinearDepth >= waterLinearDepth + bias;
}

export function filterRefractedSceneColor({
  sceneColor,
  bodyColor,
  opticalDistance,
  absorptionCoefficients,
  sceneColorStrength = 1,
}) {
  assertAbsorptionCoefficients(absorptionCoefficients);
  const distance = Math.max(0, Number.isFinite(opticalDistance) ? opticalDistance : 0);
  const strength = clamp(sceneColorStrength, 0, 1);
  const result = [];
  const transmission = [];
  for (let index = 0; index < CHANNEL_COUNT; index += 1) {
    const channelTransmission = Math.exp(-absorptionCoefficients[index] * distance);
    const scene = clamp(sceneColor[index] ?? 0, 0, 1);
    const body = clamp(bodyColor[index] ?? 0, 0, 1);
    const composite = scene * channelTransmission + body * (1 - channelTransmission);
    transmission.push(channelTransmission);
    result.push(body + (composite - body) * strength);
  }
  return Object.freeze({
    color: Object.freeze(result),
    transmission: Object.freeze(transmission),
  });
}
