import {
  WATER_BODY_ID_BOG,
  WATER_BODY_ID_NONE,
  WATER_BODY_ID_PROCEDURAL_OCEAN,
  WATER_KIND_LAKE,
  WATER_KIND_OCEAN,
  WATER_KIND_RIVER,
  WATER_SAMPLE_FLAG_INCOMPLETE_BED,
} from './WaterConstants.js';
import { createNoWaterSample, createWaterSample } from './WaterSample.js';
import { sampleOceanBed } from './OceanBathymetry.js';
import { RiverChannel } from './RiverChannel.js';
import { LakeBodies } from './LakeBodies.js';
import { RiverValley } from './RiverValley.js';
import { WaterDistanceField } from './WaterDistanceField.js';
import { WaterCellCache } from './WaterCellCache.js';
import { BogPools } from './BogPools.js';

const WATER_TILE_ID = 0;
/** How far a river must stand above a lake to count as still falling into it. */
const LAKE_INFLOW_MARGIN = 0.05;

export class WaterTerrainModel {
  constructor({
    source = null,
    seed,
    seaLevel,
    config,
    sampleBaseHeight,
    sampleBaseTile,
    isBaseRiverCell = null,
    resolveLakeLevel = null,
    riverSegments = null,
    riverReaches = null,
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
    const lakes = source?.lakes?.length && resolveLakeLevel
      ? new LakeBodies({ source, resolveLevel: resolveLakeLevel, config })
      : null;
    this.lakes = lakes?.size ? lakes : null;
    this.bog = config.bog?.enabled
      ? new BogPools({ seed, config: config.bog, cellSizeMeters: config.cellSizeMeters, sampleBaseHeight, sampleBaseTile })
      : null;
    this.riverChannel = source?.rivers?.length
      ? new RiverChannel({
        segments: riverSegments,
        source,
        sampleBaseHeight,
        seaLevel,
        config,
        lakeLevelAt: this.lakes ? (x, z) => this.lakes.levelAt(x, z) : null,
      })
      : null;
    this.riverValley = this.riverChannel?.segments.length
      ? new RiverValley({ segments: this.riverChannel.segments, config, seaLevel, sampleBaseHeight, reaches: riverReaches })
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
    // From land to the sea: the same transform with the roles swapped.
    this.beachDistance = config.ocean.beachHeight > 0 && config.ocean.beachWidthMeters > 0
      ? new WaterDistanceField({
        isWaterCell: (cellX, cellZ) => !this.isOceanCell(cellX, cellZ),
        maxDistanceCells: Math.max(1, Math.ceil(config.ocean.beachWidthMeters / config.cellSizeMeters)),
      })
      : null;
  }

  /**
   * Advance the distance blocks a water sample at this position reads.
   * @returns {boolean} false when `shouldYield` stopped it; call again to resume
   */
  prepareWaterSample(cellX, cellZ, shouldYield = null) {
    const x = Math.floor(cellX), z = Math.floor(cellZ);
    for (const field of [this.oceanDistance, this.beachDistance]) {
      if (!field) continue;
      for (const [offsetX, offsetZ] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        if (!field.prepare(x + offsetX, z + offsetZ, shouldYield)) return false;
      }
    }
    return true;
  }

  isRiverCell(cellX, cellZ) {
    if (this.riverChannel?.containsCell(cellX, cellZ)) return true;
    return this.isBaseRiverCell?.(cellX, cellZ) ?? false;
  }

  /** Whether a cell's centre lies in lake water — lakes paint the water tile like the sea. */
  isLakeCell(cellX, cellZ) {
    return this.lakes?.levelAt(cellX + 0.5, cellZ + 0.5) != null;
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

  isLandVertex(cellX, cellZ) {
    if (!Number.isInteger(cellX) || !Number.isInteger(cellZ)) {
      return !this.isOceanCell(Math.floor(cellX), Math.floor(cellZ));
    }
    return !this.isOceanCell(cellX - 1, cellZ - 1)
      && !this.isOceanCell(cellX, cellZ - 1)
      && !this.isOceanCell(cellX - 1, cellZ)
      && !this.isOceanCell(cellX, cellZ);
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

  /**
   * Low land by the sea rises into a beach: from sea level at the shoreline to
   * `ocean.beachHeight` over `ocean.beachWidthMeters`. Only ground below the
   * berm's top is considered, so inland terrain never builds the distance field.
   */
  beachHeight(cellX, cellZ, height) {
    const { beachHeight, beachWidthMeters } = this.config.ocean;
    if (!this.beachDistance || height >= this.seaLevel + beachHeight) return height;
    // Only vertices wholly on land: the shoreline vertices stay where the
    // coastline classification puts them, so the waterline does not move.
    if (!this.isLandVertex(cellX, cellZ)) return height;
    const distance = this.beachDistance.sample(cellX, cellZ) * this.config.cellSizeMeters;
    const t = Math.min(1, distance / beachWidthMeters);
    return Math.max(height, this.seaLevel + beachHeight * t * t * (3 - 2 * t));
  }

  sampleVertexHeight(cellX, cellZ) {
    return this.vertexHeightCache.get(cellX, cellZ, (x, z) => {
      const baseHeight = this.sampleBaseHeight(x, z);
      const oceanBed = this.beachHeight(x, z, this.oceanBedHeight(x, z, baseHeight));
      const bog = this.bog ? this.bog.shapeHeight(x, z, oceanBed) : oceanBed;
      // Valley walls first, so a lake basin can still cut below a river's levee.
      const valley = this.riverValley ? this.riverValley.shapeHeight(x, z, bog) : bog;
      const shaped = this.lakes ? this.lakes.shapeHeight(x, z, valley) : valley;
      const river = this.riverChannel?.sample(x, z) ?? null;
      if (!river) return shaped;
      const carvedBed = Math.min(shaped, river.bedHeight);
      return shaped + (carvedBed - shaped) * river.coverage;
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

  /** Static contact plane only. Dry probes need no terrain interpolation. */
  sampleWaterSurface(cellX, cellZ, knownBedHeight = undefined) {
    const lake = this.lakes?.sample(cellX, cellZ) ?? null;
    const river = this.riverChannel?.sample(cellX, cellZ) ?? null;
    // A river still above the lake is falling into it: the river owns that water,
    // so the face of a fall at the shore runs down to the lake unbroken.
    if (lake && !(river && river.surfaceHeight > lake.surfaceHeight + LAKE_INFLOW_MARGIN)) {
      return {
        kind: WATER_KIND_LAKE,
        bodyId: lake.bodyId,
        surfaceHeight: lake.surfaceHeight,
        coverage: 1,
        shoreDistance: lake.shoreDistance,
      };
    }
    if (river) {
      return {
        kind: WATER_KIND_RIVER,
        bodyId: river.bodyId,
        coverage: river.coverage,
        surfaceHeight: river.surfaceHeight,
        shoreDistance: river.shoreDistance,
        flowX: river.flowX,
        flowZ: river.flowZ,
        fall: river.fall,
        plunge: river.plunge,
      };
    }
    if (!this.riverChannel && this.isBaseRiverCell?.(Math.floor(cellX), Math.floor(cellZ))) {
      return {
        kind: WATER_KIND_RIVER,
        bodyId: WATER_BODY_ID_NONE,
        surfaceHeight: Math.max(this.seaLevel, knownBedHeight ?? this.interpolatedHeight(cellX, cellZ)),
        coverage: 1,
        flags: WATER_SAMPLE_FLAG_INCOMPLETE_BED,
      };
    }

    if (!this.isOceanCell(Math.floor(cellX), Math.floor(cellZ))) {
      // Only a bog interpolates the bed; a dry probe elsewhere stays a tile lookup.
      if (!(this.bog?.weight(cellX, cellZ) > 0)) return null;
      const pool = this.bog.sample(cellX, cellZ, knownBedHeight ?? this.interpolatedHeight(cellX, cellZ));
      return pool ? { kind: WATER_KIND_LAKE, bodyId: WATER_BODY_ID_BOG, coverage: 1, ...pool } : null;
    }
    return {
      kind: WATER_KIND_OCEAN,
      bodyId: WATER_BODY_ID_PROCEDURAL_OCEAN,
      surfaceHeight: this.seaLevel,
      coverage: 1,
    };
  }

  sampleWater(cellX, cellZ) {
    const bedHeight = this.interpolatedHeight(cellX, cellZ);
    const surface = this.sampleWaterSurface(cellX, cellZ, bedHeight);
    if (!surface) return createNoWaterSample(bedHeight);
    return createWaterSample({
      ...surface, bedHeight,
      surfaceHeight: surface.flags & WATER_SAMPLE_FLAG_INCOMPLETE_BED
        ? Math.max(surface.surfaceHeight, bedHeight) : surface.surfaceHeight,
      shoreDistance: surface.kind === WATER_KIND_OCEAN
        ? this.oceanDistance.sample(cellX, cellZ) * this.config.cellSizeMeters : surface.shoreDistance,
    });
  }
}
