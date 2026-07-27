import {
  resolveWaterDomainConfig,
  resolveWaterDomainVersion,
  serializeWaterDomainConfig,
} from './WaterConfig.js';
import { WaterTerrainModel } from './WaterTerrainModel.js';

const WATER_ADAPTER_MARKER = Symbol('water-domain-adapter');

function assertGenerator(generator) {
  if (!generator || typeof generator.sampleHeight !== 'function'
      || typeof generator.sampleTile !== 'function' || typeof generator.toMetadata !== 'function') {
    throw new Error('Water-domain generators must expose height, tile, and metadata queries.');
  }
}

function createModel({ generator, config, sampleBaseHeight, sampleBaseTile }) {
  return new WaterTerrainModel({
    source: generator.source ?? null,
    seed: generator.seed,
    seaLevel: generator.seaLevel,
    config,
    sampleBaseHeight,
    sampleBaseTile,
    isBaseRiverCell: typeof generator.isRiver === 'function'
      ? generator.isRiver.bind(generator)
      : null,
  });
}

function resolveBaseMacroColumn(generator) {
  return typeof generator.sampleMacroColumn === 'function'
    ? generator.sampleMacroColumn.bind(generator)
    : null;
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
  const baseMacroColumn = resolveBaseMacroColumn(generator);
  const model = createModel({
    generator,
    config,
    sampleBaseHeight: baseSampleHeight,
    sampleBaseTile: baseSampleTile,
  });
  let macroModel = null;

  const descriptors = {
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
          waterDomain: serializeWaterDomainConfig(config),
        });
      },
    },
  };

  if (baseMacroColumn) {
    descriptors.sampleMacroColumn = {
      value(cellX, cellZ) {
        const column = baseMacroColumn(cellX, cellZ);
        macroModel ??= createModel({
          generator,
          config,
          sampleBaseHeight: (x, z) => baseMacroColumn(x, z).height,
          sampleBaseTile: baseSampleTile,
        });
        return {
          ...column,
          height: macroModel.sampleHeight(cellX, cellZ),
        };
      },
    };
  }

  Object.defineProperties(generator, descriptors);
  return generator;
}
