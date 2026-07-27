import {
  WATER_BODY_ID_NONE,
  WATER_BODY_ID_PROCEDURAL_OCEAN,
  WATER_DOMAIN_VERSION,
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

export function sampleGeneratorWater(generator, cellX, cellZ) {
  assertCoordinate(cellX, 'cellX');
  assertCoordinate(cellZ, 'cellZ');
  const bedHeight = generator.sampleHeight(cellX, cellZ);
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

export function waterDomainMetadata() {
  return Object.freeze({ waterDomainVersion: WATER_DOMAIN_VERSION });
}
