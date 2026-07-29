/**
 * Render-ready page pixels for terrain slots.
 * Surface path influence uses a halo + two-pass chamfer distance field
 * (~O(chunkCells)) instead of nested getTile scans (~O(chunkCells × searchArea)).
 */

import { TILE_BY_ID, hexToRgbBytes } from '../tileCatalog.js';
import { halfToFloat } from '../water/WaterField.js';

const DIST_INF = 1e9;
const SQRT2 = Math.SQRT2;
const WATER_FIELD_CHANNELS = 4;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / Math.max(edge1 - edge0, 1e-9), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Water occupancy of one cell, as the wettest of its four corner vertices.
 *
 * The water surface is drawn from this field, so classifying land from the
 * marine tile id alone leaves the two disagreeing about where the bank is:
 * every lake and river reads as dry, and even on a marine coast the tile edge
 * falls a whole cell away from the waterline. Grass then grows out into the
 * shallows. Reading the same field the surface reads puts both on one bank.
 */
function sampleCellWaterOccupancy(field, localX, localZ, waterlineDepth) {
  let occupancy = 0;
  for (let cornerZ = 0; cornerZ <= 1; cornerZ += 1) {
    for (let cornerX = 0; cornerX <= 1; cornerX += 1) {
      const index = ((localZ + cornerZ) * field.width + (localX + cornerX))
        * WATER_FIELD_CHANNELS;
      const coverage = clamp(halfToFloat(field.pixels[index]), 0, 1);
      if (coverage <= 0) continue;
      const depth = Math.max(0, halfToFloat(field.pixels[index + 2]));
      occupancy = Math.max(occupancy, coverage * smoothstep(0, waterlineDepth, depth));
    }
  }
  return occupancy;
}

export function getSurfaceMaskSearchRadius(blendCells) {
  return Math.ceil(Math.max(0.5, blendCells) + 1);
}

export function createSurfaceMaskConfig(stylizedConfig) {
  return {
    blendCells: Math.max(0.5, stylizedConfig?.path?.blendCells ?? 2.5),
    roadTileId: stylizedConfig?.path?.tileId ?? 13,
    waterTileId: stylizedConfig?.water?.tileId ?? 0,
    grassTileIds: [...(stylizedConfig?.grass?.tileIds ?? [3, 4, 5, 6, 7, 8, 9, 12, 14])],
    // Depth at which a cell counts as fully wet for surface classification.
    // Roughly a grass blade's height: shallower than this and blades still
    // read as bank growth standing in the margin rather than drowned ones.
    waterlineDepth: Math.max(
      0.01,
      stylizedConfig?.water?.optics?.shorelineFadeDepth ?? 0.35,
    ),
  };
}

function resolveTile(tileId, tileDefinitions) {
  if (typeof tileDefinitions === 'function') {
    return tileDefinitions(tileId) ?? TILE_BY_ID.get(tileId);
  }
  return tileDefinitions?.get?.(tileId) ?? TILE_BY_ID.get(tileId);
}

export function buildTilePixels(tiles, tileDefinitions = null) {
  const pixels = new Uint8Array(tiles.length * 4);
  for (let index = 0; index < tiles.length; index += 1) {
    const tile = resolveTile(tiles[index], tileDefinitions);
    if (!tile) {
      throw new Error(`Unknown tile id: ${tiles[index]}.`);
    }
    const [red, green, blue] = hexToRgbBytes(tile.color);
    const offset = index * 4;
    pixels[offset] = red;
    pixels[offset + 1] = green;
    pixels[offset + 2] = blue;
    pixels[offset + 3] = tile.id;
  }
  return pixels;
}

/**
 * Two-pass chamfer distance transform approximating Euclidean distance to roads.
 */
export function computeRoadDistanceField(haloTiles, width, height, roadTileId) {
  const dist = new Float32Array(width * height);
  for (let index = 0; index < haloTiles.length; index += 1) {
    dist[index] = haloTiles[index] === roadTileId ? 0 : DIST_INF;
  }

  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = z * width + x;
      let value = dist[index];
      if (x > 0) value = Math.min(value, dist[index - 1] + 1);
      if (z > 0) value = Math.min(value, dist[index - width] + 1);
      if (x > 0 && z > 0) value = Math.min(value, dist[index - width - 1] + SQRT2);
      if (x + 1 < width && z > 0) value = Math.min(value, dist[index - width + 1] + SQRT2);
      dist[index] = value;
    }
  }

  for (let z = height - 1; z >= 0; z -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const index = z * width + x;
      let value = dist[index];
      if (x + 1 < width) value = Math.min(value, dist[index + 1] + 1);
      if (z + 1 < height) value = Math.min(value, dist[index + width] + 1);
      if (x + 1 < width && z + 1 < height) {
        value = Math.min(value, dist[index + width + 1] + SQRT2);
      }
      if (x > 0 && z + 1 < height) {
        value = Math.min(value, dist[index + width - 1] + SQRT2);
      }
      dist[index] = value;
    }
  }

  return dist;
}

function buildHaloTiles({
  tiles,
  originX,
  originZ,
  chunkSize,
  searchRadius,
  sampleTile,
}) {
  const haloSize = chunkSize + searchRadius * 2;
  const halo = new Uint8Array(haloSize * haloSize);
  for (let localZ = 0; localZ < haloSize; localZ += 1) {
    for (let localX = 0; localX < haloSize; localX += 1) {
      const worldX = originX + localX - searchRadius;
      const worldZ = originZ + localZ - searchRadius;
      const chunkLocalX = worldX - originX;
      const chunkLocalZ = worldZ - originZ;
      const index = localZ * haloSize + localX;
      if (
        chunkLocalX >= 0
        && chunkLocalZ >= 0
        && chunkLocalX < chunkSize
        && chunkLocalZ < chunkSize
      ) {
        halo[index] = tiles[chunkLocalZ * chunkSize + chunkLocalX];
      } else {
        halo[index] = sampleTile(worldX, worldZ);
      }
    }
  }
  return { halo, haloSize };
}

export function buildSurfaceMaskPixels({
  tiles,
  originX,
  originZ,
  chunkSize,
  sampleTile,
  maskConfig,
  waterField = null,
}) {
  const blendCells = Math.max(0.5, maskConfig.blendCells);
  const waterlineDepth = Math.max(0.01, maskConfig.waterlineDepth ?? 0.35);
  const usableWaterField = waterField?.pixels
    && waterField.width === chunkSize + 1
    && waterField.height === chunkSize + 1
    ? waterField
    : null;
  const searchRadius = getSurfaceMaskSearchRadius(blendCells);
  const roadTileId = maskConfig.roadTileId;
  const waterTileId = maskConfig.waterTileId;
  const grassTileIds = new Set(maskConfig.grassTileIds);
  const { halo, haloSize } = buildHaloTiles({
    tiles,
    originX,
    originZ,
    chunkSize,
    searchRadius,
    sampleTile,
  });
  const distances = computeRoadDistanceField(halo, haloSize, haloSize, roadTileId);
  const mask = new Uint8Array(chunkSize * chunkSize * 4);

  for (let localZ = 0; localZ < chunkSize; localZ += 1) {
    for (let localX = 0; localX < chunkSize; localX += 1) {
      const cellIndex = localZ * chunkSize + localX;
      const haloIndex = (localZ + searchRadius) * haloSize + (localX + searchRadius);
      const nearestRoad = distances[haloIndex];
      const pathInfluence = nearestRoad < DIST_INF / 2
        ? clamp(1 - Math.max(0, nearestRoad - 0.35) / blendCells, 0, 1)
        : 0;
      const tileId = tiles[cellIndex];
      const offset = cellIndex * 4;
      const tileWater = tileId === waterTileId ? 1 : 0;
      const fieldWater = usableWaterField
        ? sampleCellWaterOccupancy(usableWaterField, localX, localZ, waterlineDepth)
        : 0;
      mask[offset] = Math.round(pathInfluence * 255);
      mask[offset + 1] = grassTileIds.has(tileId) ? 255 : 0;
      mask[offset + 2] = Math.round(Math.max(tileWater, fieldWater) * 255);
      mask[offset + 3] = 255;
    }
  }

  return mask;
}

/**
 * Attach tilePixels + surfaceMaskPixels to a page. Mutates and returns page.
 *
 * Runs after enrichPageWaterField so the water class can be read from the same
 * field the water surface is drawn from.
 */
export function enrichPageRenderPixels(page, sampleTile, maskConfig, tileDefinitions = null) {
  const chunkSize = Math.sqrt(page.tiles.length) | 0;
  page.tilePixels = buildTilePixels(page.tiles, tileDefinitions);
  page.surfaceMaskPixels = buildSurfaceMaskPixels({
    tiles: page.tiles,
    originX: page.originX,
    originZ: page.originZ,
    chunkSize,
    sampleTile,
    maskConfig,
    waterField: page.waterFieldPixels
      ? {
        pixels: page.waterFieldPixels,
        width: page.waterFieldWidth,
        height: page.waterFieldHeight,
      }
      : null,
  });
  page.renderPixelsDirty = false;
  return page;
}
