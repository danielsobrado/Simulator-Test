import { resolveWaterDomainConfig, resolveWaterDomainVersion } from './WaterConfig.js';
import { WaterTerrainModel } from './WaterTerrainModel.js';

const WATER_ADAPTER_MARKER = Symbol('water-domain-adapter');

function assertGenerator(generator) {
  if (!generator || typeof generator.sampleHeight !== 'function'
      || typeof generator.sampleTile !== 'function' || typeof generator.toMetadata !== 'function') {
    throw new Error('Water-domain generators must expose height, tile, and metadata queries.');
  }
}

function serializableConfig(config) {
  return {
    version: config.version,
    cellSizeMeters: config.cellSizeMeters,
    shoreDistanceMeters: config.shoreDistanceMeters,
    ocean: { ...config.ocean },
    river: { ...config.river },
  };
}

export function ensureWaterDomainGenerator(generator, metadata = {}) {
  assertGenerator(generator);
  if (generator[WATER_ADAPTER_MARKER]) return generator;
  if (generator.waterTerrainModel && typeof generator.sampleWater === 'function') {
    resolveWaterDomainVersion(
      metadata.waterDomainVersion ?? generator.toMetadata().waterDomainVersion,
    );
    return generator;
  }

  const config = resolveWaterDomainConfig(metadata.waterDomain);
  const version = resolveWaterDomainVersion(
    metadata.waterDomainVersion ?? config.version,
  );
  const baseSampleHeight = generator.sampleHeight.bind(generator);
  const baseSampleTile = generator.sampleTile.bind(generator);
  const baseToMetadata = generator.toMetadata.bind(generator);
  const model = new WaterTerrainModel({
    source: generator.source ?? null,
    seed: generator.seed,
    seaLevel: generator.seaLevel,
    config,
    sampleBaseHeight: baseSampleHeight,
    sampleBaseTile: baseSampleTile,
    isBaseRiverCell: typeof generator.isRiver === 'function'
      ? generator.isRiver.bind(generator)
      : null,
  });

  Object.defineProperties(generator, {
    [WATER_ADAPTER_MARKER]: {
      value: true,
    },
    waterTerrainModel: {
      value: model,
    },
    sampleHeight: {
      value(cellX, cellZ) {
        return model.sampleHeight(cellX, cellZ);
      },
    },
    sampleWater: {
      value(cellX, cellZ) {
        return model.sampleWater(cellX, cellZ);
      },
    },
    toMetadata: {
      value() {
        return Object.freeze({
          ...baseToMetadata(),
          waterDomainVersion: version,
          waterDomain: serializableConfig(config),
        });
      },
    },
  });
  return generator;
}
