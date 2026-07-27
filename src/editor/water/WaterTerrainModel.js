import {
  WATER_BODY_ID_NONE,
  WATER_BODY_ID_PROCEDURAL_OCEAN,
  WATER_KIND_OCEAN,
  WATER_KIND_RIVER,
  WATER_SAMPLE_FLAG_INCOMPLETE_BED,
} from './WaterConstants.js';
import { createNoWaterSample, createWaterSample } from './WaterSample.js';
import { sampleOceanBed } from './OceanBathymetry.js';
import { RiverChannel } from './RiverChannel.js';
import { WaterDistanceField } from './WaterDistanceField.js';
import { WaterCellCache } from './WaterCellCache.js';

const WATER_TILE_ID = 0;

export class WaterTerrainModel {
  constructor({
    source = null,
    seed,
    seaLevel,
    config,
    sampleBaseHeight,
    sampleBaseTile,
    isBaseRiverCell = null,
  }) {
    this.source = source;
    this.seed = seed;
    this.seaLevel = seaLevel;
    this.config = config;
    this.sampleBaseHeight = sampleBaseHeight;
    this.sampleBaseTile = sampleBaseTile;
    this.isBaseRiverCell = isBaseRiverCell;
    this.oceanCellCache = new WaterCellCache({ ArrayType: Uint8Array });
    this.vertexHeightCache = new WaterCellCache({ ArrayType: Float64Array });
    this.riverChannel = source?.rivers?.length
      ? new RiverChannel({
        source,
        sampleBaseHeight,
        seaLevel,
        config,
      })
      : null;
    this.oceanConfig = Object.freeze({
      ...config.ocean,
      shoreDistanceMeters: config.shoreDistanceMeters,
      cellSizeMeters: config.cellSizeMeters,
    });
    this.oceanDistance = new WaterDistanceField({
      isWaterCell: (cellX, cellZ) => this.isOceanCell(cellX, cellZ),
      maxDistanceCells: Math.max(
        1,
        Math.ceil(config.shoreDistanceMeters / config.cellSizeMeters),
      ),
    });
  }

  isRiverCell(cellX, cellZ) {
    if (this.riverChannel?.containsCell(cellX, cellZ)) return true;
    return this.isBaseRiverCell?.(cellX, cellZ) ?? false;
  }

  isOceanCell(cellX, cellZ) {
    return this.oceanCellCache.get(cellX, cellZ, (x, z) => (
      this.sampleBaseTile(x, z) === WATER_TILE_ID && !this.isRiverCell(x, z) ? 1 : 0
    )) === 1;
  }

  isOceanBedVertex(cellX, cellZ) {
    if (!Number.isInteger(cellX) || !Number.isInteger(cellZ)) {
      return this.isOceanCell(Math.floor(cellX), Math.floor(cellZ));
    }
    return this.isOceanCell(cellX - 1, cellZ - 1)
      && this.isOceanCell(cellX, cellZ - 1)
      && this.isOceanCell(cellX - 1, cellZ)
      && this.isOceanCell(cellX, cellZ);
  }

  oceanBedHeight(cellX, cellZ, baseHeight) {
    if (!this.isOceanBedVertex(cellX, cellZ)) return baseHeight;
    const distanceMeters = this.oceanDistance.sample(cellX, cellZ) * this.config.cellSizeMeters;
    return sampleOceanBed({
      baseHeight,
      surfaceHeight: this.seaLevel,
      distanceMeters,
      cellX,
      cellZ,
      seed: this.seed,
      config: this.oceanConfig,
    });
  }

  sampleVertexHeight(cellX, cellZ) {
    return this.vertexHeightCache.get(cellX, cellZ, (x, z) => {
      const baseHeight = this.sampleBaseHeight(x, z);
      const oceanBed = this.oceanBedHeight(x, z, baseHeight);
      const river = this.riverChannel?.sample(x, z) ?? null;
      if (!river) return oceanBed;
      const carvedBed = Math.min(oceanBed, river.bedHeight);
      return oceanBed + (carvedBed - oceanBed) * river.coverage;
    });
  }

  sampleHeight(cellX, cellZ) {
    if (!Number.isFinite(cellX) || !Number.isFinite(cellZ)) {
      throw new Error('Water terrain coordinates must be finite.');
    }
    if (Number.isInteger(cellX) && Number.isInteger(cellZ)) {
      return this.sampleVertexHeight(cellX, cellZ);
    }
    const x0 = Math.floor(cellX);
    const z0 = Math.floor(cellZ);
    const x1 = x0 + 1;
    const z1 = z0 + 1;
    const tx = cellX - x0;
    const tz = cellZ - z0;
    const northWest = this.sampleVertexHeight(x0, z0);
    const northEast = this.sampleVertexHeight(x1, z0);
    const southWest = this.sampleVertexHeight(x0, z1);
    const southEast = this.sampleVertexHeight(x1, z1);
    const north = northWest + (northEast - northWest) * tx;
    const south = southWest + (southEast - southWest) * tx;
    return north + (south - north) * tz;
  }

  interpolatedHeight(cellX, cellZ) {
    return this.sampleHeight(cellX, cellZ);
  }

  sampleWater(cellX, cellZ) {
    const bedHeight = this.interpolatedHeight(cellX, cellZ);
    const river = this.riverChannel?.sample(cellX, cellZ) ?? null;
    if (river) {
      return createWaterSample({
        kind: WATER_KIND_RIVER,
        bodyId: river.bodyId,
        coverage: river.coverage,
        surfaceHeight: river.surfaceHeight,
        bedHeight,
        shoreDistance: river.shoreDistance,
        flowX: river.flowX,
        flowZ: river.flowZ,
      });
    }
    if (!this.riverChannel && this.isBaseRiverCell?.(Math.floor(cellX), Math.floor(cellZ))) {
      return createWaterSample({
        kind: WATER_KIND_RIVER,
        bodyId: WATER_BODY_ID_NONE,
        surfaceHeight: Math.max(this.seaLevel, bedHeight),
        bedHeight,
        flags: WATER_SAMPLE_FLAG_INCOMPLETE_BED,
      });
    }

    if (!this.isOceanCell(Math.floor(cellX), Math.floor(cellZ))) {
      return createNoWaterSample(bedHeight);
    }
    return createWaterSample({
      kind: WATER_KIND_OCEAN,
      bodyId: WATER_BODY_ID_PROCEDURAL_OCEAN,
      surfaceHeight: this.seaLevel,
      bedHeight,
      shoreDistance: this.oceanDistance.sample(cellX, cellZ) * this.config.cellSizeMeters,
    });
  }
}
