import { TERRAIN_MATERIAL_FAMILIES } from './TerrainMaterialFamilyConstants.js';

const MIN_RESOLUTION = 16;
const MAX_RESOLUTION = 256;
const MAX_VARIANTS_PER_FAMILY = 8;
const MAX_FREQUENCY = 64;

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

function assertUnit(value, path) {
  assertFinite(value, path);
  if (value < 0 || value > 1) fail(path, 'must be within [0, 1]');
}

function assertPositiveInteger(value, path, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    fail(path, `must be an integer within [1, ${maximum}]`);
  }
}

function assertResolution(value) {
  assertPositiveInteger(value, 'families.resolution', MAX_RESOLUTION);
  if (value < MIN_RESOLUTION) {
    fail('families.resolution', `must be at least ${MIN_RESOLUTION}`);
  }
  if ((value & (value - 1)) !== 0) {
    fail('families.resolution', 'must be a power of two');
  }
}

function normalizeDirection(value, path) {
  if (!Array.isArray(value) || value.length !== 2) fail(path, 'must contain two numbers');
  const [x, y] = value.map(Number);
  assertFinite(x, `${path}[0]`);
  assertFinite(y, `${path}[1]`);
  if (Math.hypot(x, y) < 1e-6) fail(path, 'must not be a zero vector');
  const length = Math.hypot(x, y);
  return Object.freeze([x / length, y / length]);
}

function normalizeProfile(source, family) {
  const path = `families.profiles.${family}`;
  assertObject(source, path);
  assertUnit(source.contrast, `${path}.contrast`);
  assertPositiveInteger(source.coarseFrequency, `${path}.coarseFrequency`, MAX_FREQUENCY);
  assertPositiveInteger(source.fineFrequency, `${path}.fineFrequency`, MAX_FREQUENCY);
  assertPositiveInteger(source.ridgeFrequency, `${path}.ridgeFrequency`, MAX_FREQUENCY);
  assertUnit(source.fineStrength, `${path}.fineStrength`);
  assertUnit(source.ridgeStrength, `${path}.ridgeStrength`);
  assertPositive(source.directionalFrequency, `${path}.directionalFrequency`);
  assertUnit(source.directionalStrength, `${path}.directionalStrength`);
  assertUnit(source.colorSpread, `${path}.colorSpread`);
  return Object.freeze({
    contrast: source.contrast,
    coarseFrequency: source.coarseFrequency,
    fineFrequency: source.fineFrequency,
    fineStrength: source.fineStrength,
    ridgeFrequency: source.ridgeFrequency,
    ridgeStrength: source.ridgeStrength,
    directionalFrequency: source.directionalFrequency,
    directionalStrength: source.directionalStrength,
    direction: normalizeDirection(source.direction, `${path}.direction`),
    colorSpread: source.colorSpread,
  });
}

export function normalizeTerrainMaterialFamilies(source) {
  assertObject(source, 'families');
  assertBoolean(source.enabled, 'families.enabled');
  if (!Number.isSafeInteger(source.seed) || source.seed < 0) {
    fail('families.seed', 'must be a non-negative safe integer');
  }
  assertResolution(source.resolution);
  assertPositiveInteger(
    source.variantsPerFamily,
    'families.variantsPerFamily',
    MAX_VARIANTS_PER_FAMILY,
  );
  for (const field of ['mesoScaleMeters', 'microScaleMeters', 'variantCellMeters', 'dominantFadePower']) {
    assertPositive(source[field], `families.${field}`);
  }
  for (const field of ['strength', 'nearStrength', 'mesoStrength', 'microStrength']) {
    assertUnit(source[field], `families.${field}`);
  }

  assertObject(source.projection, 'families.projection');
  assertFinite(source.projection.slopeStart, 'families.projection.slopeStart');
  assertPositive(source.projection.slopeFull, 'families.projection.slopeFull');
  if (source.projection.slopeStart < 0
      || source.projection.slopeFull <= source.projection.slopeStart) {
    fail('families.projection.slopeFull', 'must exceed non-negative slopeStart');
  }
  assertPositive(source.projection.verticalScale, 'families.projection.verticalScale');

  assertObject(source.environment, 'families.environment');
  assertUnit(source.environment.wetDetailScale, 'families.environment.wetDetailScale');
  assertUnit(source.environment.canopyDetailScale, 'families.environment.canopyDetailScale');

  assertObject(source.profiles, 'families.profiles');
  const unknownProfiles = Object.keys(source.profiles).filter(
    (name) => !TERRAIN_MATERIAL_FAMILIES.includes(name),
  );
  if (unknownProfiles.length > 0) {
    fail('families.profiles', `contains unsupported families: ${unknownProfiles.join(', ')}`);
  }
  const profiles = Object.freeze(Object.fromEntries(
    TERRAIN_MATERIAL_FAMILIES.map((family) => [
      family,
      normalizeProfile(source.profiles[family], family),
    ]),
  ));

  return Object.freeze({
    enabled: source.enabled,
    seed: source.seed,
    resolution: source.resolution,
    variantsPerFamily: source.variantsPerFamily,
    mesoScaleMeters: source.mesoScaleMeters,
    microScaleMeters: source.microScaleMeters,
    variantCellMeters: source.variantCellMeters,
    strength: source.strength,
    nearStrength: source.nearStrength,
    dominantFadePower: source.dominantFadePower,
    mesoStrength: source.mesoStrength,
    microStrength: source.microStrength,
    projection: Object.freeze({ ...source.projection }),
    environment: Object.freeze({ ...source.environment }),
    profiles,
  });
}
