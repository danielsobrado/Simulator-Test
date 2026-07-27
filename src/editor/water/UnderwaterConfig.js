const REQUIRED_COLORS = Object.freeze(['backgroundColor', 'fogColor']);
const REQUIRED_POSITIVE = Object.freeze(['fogDensity', 'transitionSeconds', 'nearPlane']);

function assertObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${fieldName} must be an object.`);
  }
}

export function validateUnderwaterConfig(config) {
  assertObject(config, 'player.water.underwater');
  for (const field of REQUIRED_COLORS) {
    if (typeof config[field] !== 'string' || config[field].trim() === '') {
      throw new Error(`player.water.underwater.${field} must be a color string.`);
    }
  }
  for (const field of REQUIRED_POSITIVE) {
    if (!Number.isFinite(config[field]) || config[field] <= 0) {
      throw new Error(`player.water.underwater.${field} must be positive.`);
    }
  }
  if (!Number.isFinite(config.lightScale) || config.lightScale < 0 || config.lightScale > 1) {
    throw new Error('player.water.underwater.lightScale must be within [0, 1].');
  }
  return config;
}
