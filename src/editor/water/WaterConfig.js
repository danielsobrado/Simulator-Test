import { WATER_DOMAIN_VERSION } from './WaterConstants.js';

const WATER_CONFIG_KEYS = Object.freeze(['waterDomain', 'player']);

export const DEFAULT_WATER_DOMAIN_CONFIG = Object.freeze({
  version: WATER_DOMAIN_VERSION,
  cellSizeMeters: 1,
  shoreDistanceMeters: 48,
  ocean: Object.freeze({
    coastalShelfMeters: 32,
    shelfDepth: 4,
    maximumDepth: 24,
    maximumBedSlope: 0.75,
  }),
  river: Object.freeze({
    minimumDepth: 0.8,
    maximumDepth: 8,
    widthDepthRatio: 0.18,
    bankExponent: 1.8,
    minimumGradient: 0.0002,
  }),
});

let runtimeWaterDomainConfig = DEFAULT_WATER_DOMAIN_CONFIG;

function assertObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid water configuration: ${fieldName} must be an object.`);
  }
}

function assertPositive(value, fieldName) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid water configuration: ${fieldName} must be positive.`);
  }
}

function assertNonNegative(value, fieldName) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid water configuration: ${fieldName} must be non-negative.`);
  }
}

function cloneDomain(domain) {
  return {
    version: domain.version,
    cellSizeMeters: domain.cellSizeMeters,
    shoreDistanceMeters: domain.shoreDistanceMeters,
    ocean: { ...domain.ocean },
    river: { ...domain.river },
  };
}

function freezeDomain(domain) {
  Object.freeze(domain.ocean);
  Object.freeze(domain.river);
  return Object.freeze(domain);
}

export function resolveWaterDomainVersion(value) {
  const version = value ?? WATER_DOMAIN_VERSION;
  if (!Number.isInteger(version) || version !== WATER_DOMAIN_VERSION) {
    throw new Error(
      `Unsupported water-domain version: ${String(value)}. Expected ${WATER_DOMAIN_VERSION}.`,
    );
  }
  return version;
}

export function validateWaterDomainDefinition(domain) {
  assertObject(domain, 'waterDomain');
  assertObject(domain.ocean, 'waterDomain.ocean');
  assertObject(domain.river, 'waterDomain.river');
  resolveWaterDomainVersion(domain.version);
  assertPositive(domain.cellSizeMeters, 'waterDomain.cellSizeMeters');
  assertPositive(domain.shoreDistanceMeters, 'waterDomain.shoreDistanceMeters');

  for (const field of ['coastalShelfMeters', 'shelfDepth', 'maximumDepth', 'maximumBedSlope']) {
    assertPositive(domain.ocean[field], `waterDomain.ocean.${field}`);
  }
  if (domain.ocean.shelfDepth > domain.ocean.maximumDepth) {
    throw new Error(
      'Invalid water configuration: waterDomain.ocean.maximumDepth must cover shelfDepth.',
    );
  }
  if (domain.ocean.maximumBedSlope > 1) {
    throw new Error(
      'Invalid water configuration: waterDomain.ocean.maximumBedSlope must be within (0, 1].',
    );
  }

  for (const field of [
    'minimumDepth',
    'maximumDepth',
    'widthDepthRatio',
    'bankExponent',
    'minimumGradient',
  ]) {
    assertPositive(domain.river[field], `waterDomain.river.${field}`);
  }
  if (domain.river.minimumDepth > domain.river.maximumDepth) {
    throw new Error(
      'Invalid water configuration: waterDomain.river.maximumDepth must cover minimumDepth.',
    );
  }
  return domain;
}

export function resolveWaterDomainConfig(value = runtimeWaterDomainConfig) {
  const source = value ?? DEFAULT_WATER_DOMAIN_CONFIG;
  const resolved = cloneDomain({
    ...DEFAULT_WATER_DOMAIN_CONFIG,
    ...source,
    ocean: { ...DEFAULT_WATER_DOMAIN_CONFIG.ocean, ...source.ocean },
    river: { ...DEFAULT_WATER_DOMAIN_CONFIG.river, ...source.river },
  });
  validateWaterDomainDefinition(resolved);
  return freezeDomain(resolved);
}

export function getRuntimeWaterDomainConfig() {
  return runtimeWaterDomainConfig;
}

export function setRuntimeWaterDomainConfig(domain) {
  runtimeWaterDomainConfig = resolveWaterDomainConfig(domain);
  return runtimeWaterDomainConfig;
}

export function applyWaterDomainConfig(config, waterConfig) {
  assertObject(config, 'editor config');
  assertObject(waterConfig, 'water config');
  for (const key of WATER_CONFIG_KEYS) {
    if (!(key in waterConfig)) {
      throw new Error(`Invalid water configuration: missing ${key}.`);
    }
  }
  assertObject(config.player, 'player');
  const domain = {
    ...structuredClone(waterConfig.waterDomain),
    cellSizeMeters: config.map?.tileSize ?? waterConfig.waterDomain.cellSizeMeters ?? 1,
  };
  config.waterDomain = domain;
  config.player.water = structuredClone(waterConfig.player.water);
  setRuntimeWaterDomainConfig(domain);
  return config;
}

export function validateWaterDomainConfig(config) {
  assertObject(config, 'editor config');
  const domain = config.waterDomain;
  const playerWater = config.player?.water;
  validateWaterDomainDefinition(domain);
  assertObject(playerWater, 'player.water');

  for (const field of [
    'wadeDepth',
    'swimDepth',
    'wadeDrag',
    'swimSpeed',
    'verticalSwimSpeed',
    'buoyancy',
    'swimDrag',
  ]) {
    assertPositive(playerWater[field], `player.water.${field}`);
  }
  assertNonNegative(playerWater.transitionHysteresis, 'player.water.transitionHysteresis');
  if (playerWater.wadeDepth >= playerWater.swimDepth) {
    throw new Error('Invalid water configuration: player.water.swimDepth must exceed wadeDepth.');
  }
  if (playerWater.transitionHysteresis * 2 >= playerWater.swimDepth - playerWater.wadeDepth) {
    throw new Error(
      'Invalid water configuration: player.water.transitionHysteresis is too large for the state thresholds.',
    );
  }

  return config;
}
