import { WATER_KIND_NONE, WATER_KINDS } from './WaterConstants.js';

export const DEFAULT_WATER_NAVIGATION_CONFIG = Object.freeze({
  minimumCoverage: 0.75,
  minimumDepth: 1.2,
  minimumShoreDistance: 0.8,
  maximumCurrent: 1,
  allowedKinds: null,
});

function resolveConfig(value = {}) {
  const allowedKinds = value.allowedKinds ?? DEFAULT_WATER_NAVIGATION_CONFIG.allowedKinds;
  if (allowedKinds !== null
      && (!Array.isArray(allowedKinds)
        || allowedKinds.length === 0
        || allowedKinds.some((kind) => !WATER_KINDS.includes(kind)))) {
    throw new Error('Water navigation allowedKinds must contain supported water kinds.');
  }
  const config = {
    ...DEFAULT_WATER_NAVIGATION_CONFIG,
    ...value,
    allowedKinds: allowedKinds ? Object.freeze([...new Set(allowedKinds)]) : null,
  };
  for (const [field, minimum, maximum] of [
    ['minimumCoverage', 0, 1],
    ['minimumDepth', 0, Number.POSITIVE_INFINITY],
    ['minimumShoreDistance', 0, Number.POSITIVE_INFINITY],
    ['maximumCurrent', 0, Number.POSITIVE_INFINITY],
  ]) {
    if (!Number.isFinite(config[field]) || config[field] < minimum || config[field] > maximum) {
      throw new Error(`Water navigation ${field} is invalid.`);
    }
  }
  return config;
}

export function createWaterNavigationSample(waterSample, configValue = {}) {
  const config = resolveConfig(configValue);
  const water = waterSample ?? {};
  const currentStrength = Math.hypot(water.flowX ?? 0, water.flowZ ?? 0);
  const kindAllowed = !config.allowedKinds || config.allowedKinds.includes(water.kind);
  const navigable = water.kind !== WATER_KIND_NONE
    && water.coverage >= config.minimumCoverage
    && water.depth >= config.minimumDepth
    && water.shoreDistance >= config.minimumShoreDistance
    && currentStrength <= config.maximumCurrent
    && kindAllowed;
  return Object.freeze({
    navigable,
    kind: water.kind ?? WATER_KIND_NONE,
    bodyId: water.bodyId ?? 0,
    surfaceHeight: Number.isFinite(water.surfaceHeight) ? water.surfaceHeight : 0,
    bedHeight: Number.isFinite(water.bedHeight) ? water.bedHeight : 0,
    depth: Number.isFinite(water.depth) ? water.depth : 0,
    shoreDistance: Number.isFinite(water.shoreDistance) ? water.shoreDistance : 0,
    currentX: Number.isFinite(water.flowX) ? water.flowX : 0,
    currentZ: Number.isFinite(water.flowZ) ? water.flowZ : 0,
    currentStrength,
  });
}
