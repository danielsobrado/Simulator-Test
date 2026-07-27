import { WATER_DOMAIN_VERSION } from './WaterConstants.js';

const WATER_CONFIG_KEYS = Object.freeze(['waterDomain', 'player']);

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

export function resolveWaterDomainVersion(value) {
  const version = value ?? WATER_DOMAIN_VERSION;
  if (!Number.isInteger(version) || version !== WATER_DOMAIN_VERSION) {
    throw new Error(
      `Unsupported water-domain version: ${String(value)}. Expected ${WATER_DOMAIN_VERSION}.`,
    );
  }
  return version;
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
  config.waterDomain = structuredClone(waterConfig.waterDomain);
  config.player.water = structuredClone(waterConfig.player.water);
  return config;
}

export function validateWaterDomainConfig(config) {
  assertObject(config, 'editor config');
  const domain = config.waterDomain;
  const playerWater = config.player?.water;
  assertObject(domain, 'waterDomain');
  assertObject(domain.ocean, 'waterDomain.ocean');
  assertObject(domain.river, 'waterDomain.river');
  assertObject(playerWater, 'player.water');

  resolveWaterDomainVersion(domain.version);
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
