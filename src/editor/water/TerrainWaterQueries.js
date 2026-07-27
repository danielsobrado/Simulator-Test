import {
  WATER_BODY_ID_PROCEDURAL_OCEAN,
  WATER_KIND_NONE,
  WATER_KIND_OCEAN,
  WATER_KIND_RIVER,
  WATER_SAMPLE_FLAG_INCOMPLETE_BED,
} from './WaterConstants.js';
import { createNoWaterSample, createWaterSample } from './WaterSample.js';

const WATER_TILE_ID = 0;

function assertTerrainView(terrainView) {
  const worldStore = terrainView?.worldStore;
  if (!worldStore?.generator || !terrainView?.floatingOrigin) {
    throw new Error('Terrain water queries require a world store and floating origin.');
  }
  if (typeof worldStore.generator.sampleWater !== 'function'
      || typeof worldStore.sampleHeight !== 'function'
      || typeof worldStore.getTile !== 'function') {
    throw new Error('The active world store does not implement water-domain queries.');
  }
}

function sampleCurrentWater(worldStore, cellX, cellZ) {
  const bedHeight = worldStore.sampleHeight(cellX, cellZ);
  const tileId = worldStore.getTile(Math.floor(cellX), Math.floor(cellZ));
  if (tileId !== WATER_TILE_ID) {
    return createNoWaterSample(bedHeight);
  }

  const base = worldStore.generator.sampleWater(cellX, cellZ);
  const kind = base.kind === WATER_KIND_NONE ? WATER_KIND_OCEAN : base.kind;
  const incompleteRiver = kind === WATER_KIND_RIVER
    && (base.flags & WATER_SAMPLE_FLAG_INCOMPLETE_BED) !== 0;
  return createWaterSample({
    kind,
    bodyId: base.kind === WATER_KIND_NONE
      ? WATER_BODY_ID_PROCEDURAL_OCEAN
      : base.bodyId,
    coverage: base.kind === WATER_KIND_NONE ? 1 : base.coverage,
    surfaceHeight: incompleteRiver
      ? Math.max(base.surfaceHeight, bedHeight)
      : base.surfaceHeight,
    bedHeight,
    shoreDistance: base.shoreDistance,
    flowX: base.flowX,
    flowZ: base.flowZ,
    flags: base.flags,
  });
}

export function getCanonicalWater(terrainView, worldX, worldZ) {
  assertTerrainView(terrainView);
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
    throw new Error('Canonical water coordinates must be finite.');
  }
  const tileSize = terrainView.worldStore.tileSize;
  return sampleCurrentWater(
    terrainView.worldStore,
    worldX / tileSize,
    -worldZ / tileSize,
  );
}

export function getWorldWater(terrainView, renderX, renderZ) {
  assertTerrainView(terrainView);
  const canonical = terrainView.floatingOrigin.toCanonical(renderX, renderZ);
  return getCanonicalWater(terrainView, canonical.x, canonical.z);
}

export function installTerrainWaterQueries(terrainView) {
  assertTerrainView(terrainView);
  if (typeof terrainView.getCanonicalWater !== 'function') {
    Object.defineProperty(terrainView, 'getCanonicalWater', {
      configurable: false,
      enumerable: false,
      value(worldX, worldZ) {
        return getCanonicalWater(this, worldX, worldZ);
      },
      writable: false,
    });
  }
  if (typeof terrainView.getWorldWater !== 'function') {
    Object.defineProperty(terrainView, 'getWorldWater', {
      configurable: false,
      enumerable: false,
      value(renderX, renderZ) {
        return getWorldWater(this, renderX, renderZ);
      },
      writable: false,
    });
  }
  return terrainView;
}
