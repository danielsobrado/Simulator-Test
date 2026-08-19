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
const MAX_ROWS_PER_YIELD = 512;
const MAX_CONCURRENT_BUILDS = 16;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

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

function assertFinite(value, path) {
  if (!Number.isFinite(value)) fail(path, 'must be finite');
}

function assertPositive(value, path) {
  assertFinite(value, path);
  if (value <= 0) fail(path, 'must be positive');
}

function assertPositiveInteger(value, path) {
  if (!Number.isInteger(value) || value < 1) fail(path, 'must be a positive integer');
}

function assertNonNegativeInteger(value, path) {
  if (!Number.isSafeInteger(value) || value < 0) fail(path, 'must be a non-negative safe integer');
}

function assertUnitInterval(value, path) {
  assertFinite(value, path);
  if (value < 0 || value > 1) fail(path, 'must be within [0, 1]');
}

function assertHexColor(value, path) {
  if (typeof value !== 'string' || !HEX_COLOR_PATTERN.test(value)) {
    fail(path, 'must be a six-digit hexadecimal color');
  }
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

function normalizeBuild(source) {
  assertObject(source, 'build');
  assertPositiveInteger(source.rowsPerYield, 'build.rowsPerYield');
  if (source.rowsPerYield > MAX_ROWS_PER_YIELD) {
    fail('build.rowsPerYield', `must not exceed ${MAX_ROWS_PER_YIELD}`);
  }
  assertPositiveInteger(source.maxConcurrent, 'build.maxConcurrent');
  if (source.maxConcurrent > MAX_CONCURRENT_BUILDS) {
    fail('build.maxConcurrent', `must not exceed ${MAX_CONCURRENT_BUILDS}`);
  }
  assertPositive(source.retryDelayMs, 'build.retryDelayMs');
  return Object.freeze({
    rowsPerYield: source.rowsPerYield,
    maxConcurrent: source.maxConcurrent,
    retryDelayMs: source.retryDelayMs,
  });
}

function normalizeClassification(source) {
  assertObject(source, 'classification');
  assertFinite(source.rockSlopeStart, 'classification.rockSlopeStart');
  assertPositive(source.rockSlopeFull, 'classification.rockSlopeFull');
  if (source.rockSlopeStart < 0 || source.rockSlopeFull <= source.rockSlopeStart) {
    fail('classification.rockSlopeFull', 'must exceed non-negative rockSlopeStart');
  }
  assertFinite(source.snowLine, 'classification.snowLine');
  assertPositive(source.snowFade, 'classification.snowFade');
  assertPositive(source.snowSlopeMax, 'classification.snowSlopeMax');
  assertPositive(source.shorelineRadiusCells, 'classification.shorelineRadiusCells');
  assertPositive(source.wetnessRadiusCells, 'classification.wetnessRadiusCells');
  if (source.wetnessRadiusCells > source.shorelineRadiusCells) {
    fail('classification.wetnessRadiusCells', 'must not exceed shorelineRadiusCells');
  }
  return Object.freeze({ ...source });
}

function normalizeMacro(source) {
  assertObject(source, 'macro');
  assertPositive(source.scaleMeters, 'macro.scaleMeters');
  assertUnitInterval(source.strength, 'macro.strength');
  assertNonNegativeInteger(source.seedOffset, 'macro.seedOffset');
  assertFinite(source.heightShadeScale, 'macro.heightShadeScale');
  assertPositive(source.minHeightShade, 'macro.minHeightShade');
  assertPositive(source.maxHeightShade, 'macro.maxHeightShade');
  if (source.maxHeightShade < source.minHeightShade) {
    fail('macro.maxHeightShade', 'must cover minHeightShade');
  }
  assertUnitInterval(source.wetDarkening, 'macro.wetDarkening');
  return Object.freeze({ ...source });
}

function normalizeRender(source) {
  assertObject(source, 'render');
  assertPositive(source.nearDistance, 'render.nearDistance');
  assertPositive(source.farDistance, 'render.farDistance');
  assertPositive(source.transitionDistance, 'render.transitionDistance');
  if (source.farDistance <= source.nearDistance + source.transitionDistance) {
    fail('render.farDistance', 'must start after the near transition band');
  }
  for (const field of [
    'grassTintStrength',
    'nearMacroStrength',
    'nearMaterialBlend',
    'nearWetnessScale',
    'wetDarkening',
    'shorelineStrength',
    'canopyStrength',
  ]) {
    assertUnitInterval(source[field], `render.${field}`);
  }
  for (const field of ['rockColor', 'snowColor', 'shorelineColor']) {
    assertHexColor(source[field], `render.${field}`);
  }
  return Object.freeze({ ...source });
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
    build: normalizeBuild(source.build),
    classification: normalizeClassification(source.classification),
    macro: normalizeMacro(source.macro),
    render: normalizeRender(source.render),
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
