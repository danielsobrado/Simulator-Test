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
    this.riverChannel = source?.rivers?.length
      ? new RiverChannel({ source, sampleBaseHeight, seaLevel, config })
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
    return this.sampleBaseTile(cellX, cellZ) === WATER_TILE_ID
      && !this.isRiverCell(cellX, cellZ);
  }

  filteredBaseHeight(cellX, cellZ, centerHeight) {
    return (
      centerHeight * 4
      + this.sampleBaseHeight(cellX - 1, cellZ)
      + this.sampleBaseHeight(cellX + 1, cellZ)
      + this.sampleBaseHeight(cellX, cellZ - 1)
      + this.sampleBaseHeight(cellX, cellZ + 1)
    ) / 8;
  }

  oceanBedHeight(cellX, cellZ, baseHeight) {
    if (!this.isOceanCell(Math.floor(cellX), Math.floor(cellZ))) return baseHeight;
    const distanceMeters = this.oceanDistance.sample(cellX, cellZ)
      * this.config.cellSizeMeters;
    return sampleOceanBed({
      baseHeight,
      filteredBaseHeight: this.filteredBaseHeight(cellX, cellZ, baseHeight),
      surfaceHeight: this.seaLevel,
      distanceMeters,
      cellX,
      cellZ,
      seed: this.seed,
      config: this.oceanConfig,
    });
  }

  sampleHeight(cellX, cellZ) {
    const baseHeight = this.sampleBaseHeight(cellX, cellZ);
    const oceanBed = this.oceanBedHeight(cellX, cellZ, baseHeight);
    const river = this.riverChannel?.sample(cellX, cellZ) ?? null;
    if (!river) return oceanBed;
    const carvedBed = Math.min(oceanBed, river.bedHeight);
    return oceanBed + (carvedBed - oceanBed) * river.coverage;
  }

  interpolatedHeight(cellX, cellZ) {
    if (Number.isInteger(cellX) && Number.isInteger(cellZ)) {
      return this.sampleHeight(cellX, cellZ);
    }
    const x0 = Math.floor(cellX);
    const z0 = Math.floor(cellZ);
    const x1 = x0 + 1;
    const z1 = z0 + 1;
    const tx = cellX - x0;
    const tz = cellZ - z0;
    const northWest = this.sampleHeight(x0, z0);
    const northEast = this.sampleHeight(x1, z0);
    const southWest = this.sampleHeight(x0, z1);
    const southEast = this.sampleHeight(x1, z1);
    const north = northWest + (northEast - northWest) * tx;
    const south = southWest + (southEast - southWest) * tx;
    return north + (south - north) * tz;
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
    if (!this.riverChannel
        && this.isBaseRiverCell?.(Math.floor(cellX), Math.floor(cellZ))) {
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
      shoreDistance: this.oceanDistance.sample(cellX, cellZ)
        * this.config.cellSizeMeters,
    });
  }
}
