const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

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

function assertColor(value, fieldName) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    throw new Error(`${fieldName} must be a six-digit hex colour.`);
  }
}

export function validateWaterOpticsConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('stylizedSurface.water.optics must be an object.');
  }
  for (const field of ['shallowColor', 'deepColor', 'underwaterColor']) {
    assertColor(config[field], `stylizedSurface.water.optics.${field}`);
  }
  assertFiniteRange(config.absorptionDensity, 'stylizedSurface.water.optics.absorptionDensity', 0, 10);
  assertFiniteRange(config.minimumOpacity, 'stylizedSurface.water.optics.minimumOpacity', 0, 1);
  assertFiniteRange(config.maximumOpacity, 'stylizedSurface.water.optics.maximumOpacity', 0, 1);
  assertFiniteRange(config.shallowDepth, 'stylizedSurface.water.optics.shallowDepth', 0, 100);
  assertFiniteRange(config.deepDepth, 'stylizedSurface.water.optics.deepDepth', 0, 500);
  assertFiniteRange(
    config.maximumOpticalDistance,
    'stylizedSurface.water.optics.maximumOpticalDistance',
    0.01,
    500,
  );
  assertFiniteRange(
    config.minimumViewCosine,
    'stylizedSurface.water.optics.minimumViewCosine',
    0.05,
    1,
  );
  assertFiniteRange(
    config.surfaceTransitionDepth,
    'stylizedSurface.water.optics.surfaceTransitionDepth',
    0.05,
    5,
  );
  assertFiniteRange(
    config.shorelineFadeDepth,
    'stylizedSurface.water.optics.shorelineFadeDepth',
    0.01,
    5,
  );
  assertFiniteRange(
    config.surfaceDetailStrength,
    'stylizedSurface.water.optics.surfaceDetailStrength',
    0,
    1,
  );
  assertFiniteRange(
    config.underwaterTintStrength,
    'stylizedSurface.water.optics.underwaterTintStrength',
    0,
    1,
  );
  if (config.maximumOpacity < config.minimumOpacity) {
    throw new Error('stylizedSurface.water.optics.maximumOpacity must be at least minimumOpacity.');
  }
  if (config.deepDepth <= config.shallowDepth) {
    throw new Error('stylizedSurface.water.optics.deepDepth must exceed shallowDepth.');
  }
  return config;
}

export function computeWaterOpticsSample({
  depth,
  viewCosine = 1,
  cameraSubmersionDepth = 0,
  config,
}) {
  validateWaterOpticsConfig(config);
  const safeDepth = Math.max(0, Number.isFinite(depth) ? depth : 0);
  const safeSubmersionDepth = Math.max(
    0,
    Number.isFinite(cameraSubmersionDepth) ? cameraSubmersionDepth : 0,
  );
  const underwaterBlend = smoothstep(
    0,
    config.surfaceTransitionDepth,
    safeSubmersionDepth,
  );
  const verticalDistance = safeDepth
    + (safeSubmersionDepth - safeDepth) * underwaterBlend;
  const safeCosine = clamp(
    Math.abs(Number.isFinite(viewCosine) ? viewCosine : 1),
    config.minimumViewCosine,
    1,
  );
  const opticalDistance = Math.min(
    config.maximumOpticalDistance,
    verticalDistance / safeCosine,
  );
  const transmission = Math.exp(-config.absorptionDensity * opticalDistance);
  const opacity = config.minimumOpacity
    + (config.maximumOpacity - config.minimumOpacity) * (1 - transmission);
  return Object.freeze({
    depth: safeDepth,
    cameraSubmersionDepth: safeSubmersionDepth,
    underwaterBlend,
    verticalDistance,
    opticalDistance,
    transmission,
    opacity: clamp(opacity, config.minimumOpacity, config.maximumOpacity),
    depthMix: smoothstep(config.shallowDepth, config.deepDepth, safeDepth),
    // How much of the surface sheet survives where the body thins out. The
    // water field extends the surface onto dry vertices to keep it continuous
    // across chunk seams, so without this the sheet paints over the beach.
    shorelineFade: smoothstep(0, config.shorelineFadeDepth, safeDepth),
  });
}
