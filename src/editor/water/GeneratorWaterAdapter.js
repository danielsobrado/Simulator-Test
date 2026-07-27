import {
  WATER_BODY_ID_NONE,
  WATER_BODY_ID_PROCEDURAL_OCEAN,
  WATER_KIND_OCEAN,
  WATER_KIND_RIVER,
  WATER_SAMPLE_FLAG_INCOMPLETE_BED,
} from './WaterConstants.js';
import { resolveWaterDomainVersion } from './WaterConfig.js';
import { createNoWaterSample, createWaterSample } from './WaterSample.js';

const WATER_TILE_ID = 0;

function assertCoordinate(value, fieldName) {
  if (!Number.isFinite(value)) {
    throw new Error(`Water query ${fieldName} must be finite.`);
  }
}

function sampleBedHeight(generator, cellX, cellZ) {
  const x0 = Math.floor(cellX);
  const z0 = Math.floor(cellZ);
  const x1 = x0 + 1;
  const z1 = z0 + 1;
  const tx = cellX - x0;
  const tz = cellZ - z0;
  const northWest = generator.sampleHeight(x0, z0);
  const northEast = generator.sampleHeight(x1, z0);
  const southWest = generator.sampleHeight(x0, z1);
  const southEast = generator.sampleHeight(x1, z1);
  const north = northWest + (northEast - northWest) * tx;
  const south = southWest + (southEast - southWest) * tx;
  return north + (south - north) * tz;
}

export function sampleGeneratorWater(generator, cellX, cellZ) {
  assertCoordinate(cellX, 'cellX');
  assertCoordinate(cellZ, 'cellZ');
  const bedHeight = sampleBedHeight(generator, cellX, cellZ);
  const tileX = Math.floor(cellX);
  const tileZ = Math.floor(cellZ);
  if (generator.sampleTile(tileX, tileZ) !== WATER_TILE_ID) {
    return createNoWaterSample(bedHeight);
  }

  const river = typeof generator.isRiver === 'function' && generator.isRiver(tileX, tileZ);
  if (river) {
    return createWaterSample({
      kind: WATER_KIND_RIVER,
      bodyId: WATER_BODY_ID_NONE,
      surfaceHeight: Math.max(generator.seaLevel, bedHeight),
      bedHeight,
      flags: WATER_SAMPLE_FLAG_INCOMPLETE_BED,
    });
  }

  return createWaterSample({
    kind: WATER_KIND_OCEAN,
    bodyId: WATER_BODY_ID_PROCEDURAL_OCEAN,
    surfaceHeight: generator.seaLevel,
    bedHeight,
  });
}

export function ensureWaterDomainGenerator(generator, metadata = {}) {
  if (!generator || typeof generator.sampleHeight !== 'function'
      || typeof generator.sampleTile !== 'function' || typeof generator.toMetadata !== 'function') {
    throw new Error('Water-domain generators must expose height, tile, and metadata queries.');
  }
  const version = resolveWaterDomainVersion(
    metadata.waterDomainVersion ?? generator.toMetadata().waterDomainVersion,
  );

  if (typeof generator.sampleWater !== 'function') {
    Object.defineProperty(generator, 'sampleWater', {
      configurable: false,
      enumerable: false,
      value(cellX, cellZ) {
        return sampleGeneratorWater(this, cellX, cellZ);
      },
      writable: false,
    });
  }

  const baseToMetadata = generator.toMetadata.bind(generator);
  if (baseToMetadata().waterDomainVersion === undefined) {
    Object.defineProperty(generator, 'toMetadata', {
      configurable: false,
      enumerable: false,
      value() {
        return Object.freeze({
          ...baseToMetadata(),
          waterDomainVersion: version,
        });
      },
      writable: false,
    });
  }

  return generator;
}
