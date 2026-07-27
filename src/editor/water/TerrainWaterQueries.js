import { cellKey } from '../world/WorldCoordinates.js';
import {
  WATER_BODY_ID_PROCEDURAL_OCEAN,
  WATER_KIND_NONE,
  WATER_KIND_OCEAN,
  WATER_KIND_RIVER,
  WATER_SAMPLE_FLAG_INCOMPLETE_BED,
} from './WaterConstants.js';
import { createWaterNavigationSample } from './WaterNavigation.js';
import { createNoWaterSample, createWaterSample } from './WaterSample.js';

const WATER_TILE_ID = 0;

function assertWorldStore(worldStore) {
  if (!worldStore?.generator
      || typeof worldStore.generator.sampleWater !== 'function'
      || typeof worldStore.sampleHeight !== 'function'
      || typeof worldStore.getTile !== 'function') {
    throw new Error('The active world store does not implement water-domain queries.');
  }
}

function assertTerrainView(terrainView) {
  if (!terrainView?.floatingOrigin) {
    throw new Error('Terrain water queries require a floating origin.');
  }
  assertWorldStore(terrainView.worldStore);
}

function toCanonicalWorldSample(sample) {
  if (sample.kind === WATER_KIND_NONE || (sample.flowX === 0 && sample.flowZ === 0)) return sample;
  return createWaterSample({
    kind: sample.kind,
    bodyId: sample.bodyId,
    coverage: sample.coverage,
    surfaceHeight: sample.surfaceHeight,
    bedHeight: sample.bedHeight,
    shoreDistance: sample.shoreDistance,
    flowX: sample.flowX,
    flowZ: -sample.flowZ,
    flags: sample.flags,
  });
}

export function sampleWorldStoreWater(worldStore, cellX, cellZ) {
  assertWorldStore(worldStore);
  const tileX = Math.floor(cellX);
  const tileZ = Math.floor(cellZ);
  const tileId = worldStore.getTile(tileX, tileZ);
  const base = worldStore.generator.sampleWater(cellX, cellZ);
  const hasExplicitTileOverrides = worldStore.tileOverrides instanceof Map
    && worldStore.tileOverrides.size > 0;
  const explicitTileOverride = hasExplicitTileOverrides
    && worldStore.tileOverrides.has(cellKey(tileX, tileZ));
  const canUseBaseBed = worldStore.heightOverrides instanceof Map
    && worldStore.heightOverrides.size === 0;
  const bedHeight = canUseBaseBed
    ? base.bedHeight
    : worldStore.sampleHeight(cellX, cellZ);

  if (tileId !== WATER_TILE_ID
      && (base.kind !== WATER_KIND_RIVER || explicitTileOverride)) {
    return createNoWaterSample(bedHeight);
  }

  const addedWater = base.kind === WATER_KIND_NONE;
  const kind = addedWater ? WATER_KIND_OCEAN : base.kind;
  const incompleteRiver = kind === WATER_KIND_RIVER
    && (base.flags & WATER_SAMPLE_FLAG_INCOMPLETE_BED) !== 0;
  const surfaceHeight = addedWater
    ? worldStore.generator.seaLevel
    : incompleteRiver
      ? Math.max(base.surfaceHeight, bedHeight)
      : base.surfaceHeight;
  return createWaterSample({
    kind,
    bodyId: addedWater ? WATER_BODY_ID_PROCEDURAL_OCEAN : base.bodyId,
    coverage: addedWater ? 1 : base.coverage,
    surfaceHeight,
    bedHeight,
    shoreDistance: addedWater ? 0 : base.shoreDistance,
    flowX: addedWater ? 0 : base.flowX,
    flowZ: addedWater ? 0 : base.flowZ,
    flags: base.flags,
  });
}

export function getCanonicalWater(terrainView, worldX, worldZ) {
  assertTerrainView(terrainView);
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
    throw new Error('Canonical water coordinates must be finite.');
  }
  const tileSize = terrainView.worldStore.tileSize;
  return toCanonicalWorldSample(sampleWorldStoreWater(
    terrainView.worldStore,
    worldX / tileSize,
    -worldZ / tileSize,
  ));
}

export function getWorldWater(terrainView, renderX, renderZ) {
  assertTerrainView(terrainView);
  const canonical = terrainView.floatingOrigin.toCanonical(renderX, renderZ);
  return getCanonicalWater(terrainView, canonical.x, canonical.z);
}

export function getCanonicalWaterNavigation(terrainView, worldX, worldZ, config = {}) {
  return createWaterNavigationSample(getCanonicalWater(terrainView, worldX, worldZ), config);
}

export function getWorldWaterNavigation(terrainView, renderX, renderZ, config = {}) {
  return createWaterNavigationSample(getWorldWater(terrainView, renderX, renderZ), config);
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
  if (typeof terrainView.getCanonicalWaterNavigation !== 'function') {
    Object.defineProperty(terrainView, 'getCanonicalWaterNavigation', {
      configurable: false,
      enumerable: false,
      value(worldX, worldZ, config = {}) {
        return getCanonicalWaterNavigation(this, worldX, worldZ, config);
      },
      writable: false,
    });
  }
  if (typeof terrainView.getWorldWaterNavigation !== 'function') {
    Object.defineProperty(terrainView, 'getWorldWaterNavigation', {
      configurable: false,
      enumerable: false,
      value(renderX, renderZ, config = {}) {
        return getWorldWaterNavigation(this, renderX, renderZ, config);
      },
      writable: false,
    });
  }
  return terrainView;
}
