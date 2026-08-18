import {
  TERRAIN_MATERIAL_BAKE_CHANNELS,
  TERRAIN_MATERIAL_BAKE_DEBUG_VIEWS,
  TERRAIN_MATERIAL_BAKE_FORMAT_BYTES,
  TERRAIN_MATERIAL_BAKE_QUALITY_TIERS,
  TERRAIN_MATERIAL_BAKE_SCHEMA_VERSION,
} from './TerrainMaterialBakeConstants.js';

const MIN_RESOLUTION = 16;
const MAX_RESOLUTION = 512;
const MAX_CACHE_ENTRIES = 4096;

function fail(path, message) {
  throw new Error(`Invalid terrain material bake configuration: ${path} ${message}.`);
}

function assertObject(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(path, 'must be an object');
  }
}

function assertBoolean(value, path) {
  if (typeof value !== 'boolean') fail(path, 'must be boolean');
}

function assertPositiveInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) fail(path, 'must be a positive integer');
}

function assertKnownValue(value, allowed, path) {
  if (!allowed.includes(value)) {
    fail(path, `must be one of ${allowed.join(', ')}`);
  }
}

function assertResolution(value, path) {
  assertPositiveInteger(value, path);
  if (value < MIN_RESOLUTION || value > MAX_RESOLUTION) {
    fail(path, `must be between ${MIN_RESOLUTION} and ${MAX_RESOLUTION}`);
  }
  if ((value & (value - 1)) !== 0) fail(path, 'must be a power of two');
}

function freezeRecord(record) {
  return Object.freeze(Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, Object.freeze({ ...value })]),
  ));
}

function normalizeQualityTiers(source) {
  assertObject(source, 'qualityTiers');
  const result = {};
  for (const tier of TERRAIN_MATERIAL_BAKE_QUALITY_TIERS) {
    const value = source[tier];
    assertObject(value, `qualityTiers.${tier}`);
    assertResolution(value.resolution, `qualityTiers.${tier}.resolution`);
    result[tier] = { resolution: value.resolution };
  }
  const resolutions = TERRAIN_MATERIAL_BAKE_QUALITY_TIERS.map(
    (tier) => result[tier].resolution,
  );
  for (let index = 1; index < resolutions.length; index += 1) {
    if (resolutions[index] <= resolutions[index - 1]) {
      fail('qualityTiers', 'resolutions must strictly increase from low to high');
    }
  }
  return freezeRecord(result);
}

function normalizeChannels(source) {
  assertObject(source, 'channels');
  const unknown = Object.keys(source).filter(
    (name) => !TERRAIN_MATERIAL_BAKE_CHANNELS.includes(name),
  );
  if (unknown.length > 0) fail('channels', `contains unsupported channels: ${unknown.join(', ')}`);

  const result = {};
  for (const name of TERRAIN_MATERIAL_BAKE_CHANNELS) {
    const channel = source[name];
    assertObject(channel, `channels.${name}`);
    assertKnownValue(
      channel.format,
      Object.keys(TERRAIN_MATERIAL_BAKE_FORMAT_BYTES),
      `channels.${name}.format`,
    );
    result[name] = { format: channel.format };
  }
  return freezeRecord(result);
}

function normalizeCache(source) {
  assertObject(source, 'cache');
  assertPositiveInteger(source.maxEntries, 'cache.maxEntries');
  if (source.maxEntries > MAX_CACHE_ENTRIES) {
    fail('cache.maxEntries', `must not exceed ${MAX_CACHE_ENTRIES}`);
  }
  assertPositiveInteger(source.maxBytes, 'cache.maxBytes');
  assertBoolean(source.staleWhileRevalidate, 'cache.staleWhileRevalidate');
  return Object.freeze({
    maxEntries: source.maxEntries,
    maxBytes: source.maxBytes,
    staleWhileRevalidate: source.staleWhileRevalidate,
  });
}

function normalizeFallback(source) {
  assertObject(source, 'fallback');
  assertBoolean(source.allowProcedural, 'fallback.allowProcedural');
  assertBoolean(source.allowStale, 'fallback.allowStale');
  if (!source.allowProcedural && !source.allowStale) {
    fail('fallback', 'must allow stale or procedural rendering');
  }
  return Object.freeze({
    allowProcedural: source.allowProcedural,
    allowStale: source.allowStale,
  });
}

function normalizeDebug(source) {
  assertObject(source, 'debug');
  assertKnownValue(source.view, TERRAIN_MATERIAL_BAKE_DEBUG_VIEWS, 'debug.view');
  return Object.freeze({ view: source.view });
}

export function estimateTerrainMaterialBakeBytes(config, quality = config.quality) {
  assertKnownValue(quality, TERRAIN_MATERIAL_BAKE_QUALITY_TIERS, 'quality');
  const resolution = config.qualityTiers[quality].resolution;
  const bytesPerTexel = TERRAIN_MATERIAL_BAKE_CHANNELS.reduce(
    (total, name) => total + TERRAIN_MATERIAL_BAKE_FORMAT_BYTES[config.channels[name].format],
    0,
  );
  return resolution * resolution * bytesPerTexel;
}

export function createTerrainMaterialBakeConfig(source) {
  assertObject(source, 'root');
  if (source.schemaVersion !== TERRAIN_MATERIAL_BAKE_SCHEMA_VERSION) {
    fail('schemaVersion', `must equal ${TERRAIN_MATERIAL_BAKE_SCHEMA_VERSION}`);
  }
  assertBoolean(source.enabled, 'enabled');
  assertKnownValue(source.quality, TERRAIN_MATERIAL_BAKE_QUALITY_TIERS, 'quality');

  const config = {
    schemaVersion: source.schemaVersion,
    enabled: source.enabled,
    quality: source.quality,
    qualityTiers: normalizeQualityTiers(source.qualityTiers),
    channels: normalizeChannels(source.channels),
    cache: normalizeCache(source.cache),
    fallback: normalizeFallback(source.fallback),
    debug: normalizeDebug(source.debug),
  };

  const largestPageBytes = estimateTerrainMaterialBakeBytes(config, 'high');
  if (config.cache.maxBytes < largestPageBytes) {
    fail('cache.maxBytes', `must fit at least one high-quality page (${largestPageBytes} bytes)`);
  }

  return Object.freeze(config);
}
