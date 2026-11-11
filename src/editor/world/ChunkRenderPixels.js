/**
 * Render-ready page pixels for terrain slots.
 * Surface path influence uses a halo + two-pass chamfer distance field
 * (~O(chunkCells)) instead of nested getTile scans (~O(chunkCells × searchArea)).
 */

import { grassHabitatCoverage, grassHabitatHaloCells } from './GrassHabitatCoverage.js';
import { prepareGrassHabitatHalo } from './GrassHabitatHalo.js';
import { grassPatchCover } from './GrassPatchiness.js';
import { blurTileField } from './BiomeFieldBlur.js';
import { SNOW_BIOME_BLUR_CELLS, snowBiomeCoverField } from '../materials/SnowAccumulation.js';
import { resolveMeadowGrowth } from '../stylized/meadow/meadowGrowthProfiles.js';
import { TILE_BY_ID, hexToRgbBytes } from '../tileCatalog.js';
import { floatToHalf, halfToFloat } from '../water/WaterField.js';


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

/**
 * Each vertex's wetness, `coverage × smoothstep(depth)` as occupancy reads it,
 * from the water field or, without one, the same samples the habitat halo takes
 * (half-float rounded, so both production paths write identical bytes).
 *
 * The mask's alpha is a cell's dry share as the MEAN of its corners. Occupancy
 * (B) is the wettest corner: nearly binary and dilated by up to a cell, so the
 * bake's snow, cut by it, ended at every shore along the 2 m cell staircase in
 * long straight runs. A mean is continuous, and the bake's bilinear filtering
 * turns it into a smooth contour at the waterline.
 */
function vertexWetness(chunkSize, originX, originZ, field, sampleWater, waterlineDepth) {
  if (!field && typeof sampleWater !== 'function') return null;
  const width = chunkSize + 1;
  const wet = new Float32Array(width * width);
  for (let z = 0; z < width; z += 1) {
    for (let x = 0; x < width; x += 1) {
      let coverage, depth;
      if (field) {
        const index = (z * field.width + x) * WATER_FIELD_CHANNELS;
        coverage = halfToFloat(field.pixels[index]);
        depth = halfToFloat(field.pixels[index + 2]);
      } else {
        const sample = sampleWater(originX + x, originZ + z);
        if (!sample) continue;
        coverage = halfToFloat(floatToHalf(sample.coverage));
        depth = halfToFloat(floatToHalf(sample.depth));
      }
      if (coverage > 0) wet[z * width + x] = clamp(coverage, 0, 1) * smoothstep(0, waterlineDepth, Math.max(0, depth));
    }
  }
  return wet;
}

/**
 * Halo cells a page's surface mask reads around its chunk. The grass fringe's
 * snow gate reads the biome snow cover blurred over SNOW_BIOME_BLUR_CELLS, so
 * that blur widens the halo too — and with it how far an edit invalidates.
 */
export function getSurfaceMaskSearchRadius(blendCells, tileSize = 2) {
  return Math.max(Math.ceil(Math.max(0.5, blendCells) + 1), grassHabitatHaloCells(tileSize) + SNOW_BIOME_BLUR_CELLS);
}

export function getSurfaceMaskChunkRadius(blendCells, chunkSize, tileSize = 2) {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error('Surface mask chunk size must be a positive integer.');
  }
  return Math.ceil(getSurfaceMaskSearchRadius(blendCells, tileSize) / chunkSize);
}


/**
 * @param {object} stylizedConfig
 * @param {object} [options]
 * @param {number} [options.tileSize] metres per cell; with the bake's snow
 *   classification it lets the mask keep grass off snow
 */
/**
 * Meadow stand density per tile id, or null without a meadow: the share of a
 * biome's grass habitat that grows grass (GrassPatchiness.js). A plain array so
 * it crosses into the chunk workers.
 */
function grassDensityByTile(stylizedConfig) {
  const meadow = stylizedConfig?.grass?.meadow;
  if (!meadow || meadow.enabled === false) return null;
  const growth = resolveMeadowGrowth(meadow.growth);
  return Array.from(growth.table, (index) => growth.profiles[index].density);
}

export function createSurfaceMaskConfig(stylizedConfig, { tileSize = null } = {}) {
  const bake = stylizedConfig?.materialBake;
  return {
    grassDensityByTile: grassDensityByTile(stylizedConfig),
    // Bare-ground colour per biome where it differs from the map colour
    // (config/biome-looks.yaml `soil`); a plain object for the chunk workers.
    soilColorByTile: { ...(stylizedConfig?.biomeLooks?.soil ?? {}) },
    tileSize: tileSize ?? 2,
    snow: bake?.classification && Number.isFinite(tileSize)
      ? { classification: bake.classification, seedOffset: bake.macro.seedOffset, tileSize }
      : null,
    blendCells: Math.max(0.5, stylizedConfig?.path?.blendCells ?? 2.5),
    roadTileId: stylizedConfig?.path?.tileId ?? 13,
    waterTileId: stylizedConfig?.water?.tileId ?? 0,
    aridTileIds: Object.values(stylizedConfig?.biomeLooks?.arid ?? {}).flat(),
    grassTileIds: [...(stylizedConfig?.grass?.tileIds ?? [3, 4, 5, 6, 7, 8, 9, 10, 12, 14])],
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

export function buildTilePixels(tiles, tileDefinitions = null, soilColorByTile = null) {
  const pixels = new Uint8Array(tiles.length * 4);
  for (let index = 0; index < tiles.length; index += 1) {
    const tile = resolveTile(tiles[index], tileDefinitions);
    if (!tile) {
      throw new Error(`Unknown tile id: ${tiles[index]}.`);
    }
    const [red, green, blue] = hexToRgbBytes(soilColorByTile?.[tile.id] ?? tile.color);
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
  heights = null,
  originX,
  originZ,
  chunkSize,
  sampleTile,
  maskConfig,
  waterField = null,
  sampleHeight = null,
  sampleWater = null,
  snowCoverOut = null,
  tilePixelsOut = null,
  tileColor = null,
}) {
  const blendCells = Math.max(0.5, maskConfig.blendCells);
  const waterlineDepth = Math.max(0.01, maskConfig.waterlineDepth ?? 0.35);
  const usableWaterField = waterField?.pixels
    && waterField.width === chunkSize + 1
    && waterField.height === chunkSize + 1
    ? waterField
    : null;
  if (usableWaterField && typeof sampleWater !== 'function') {
    throw new Error('Grass habitat water halo requires water sampling.');
  }
  const tileSize = maskConfig.tileSize ?? maskConfig.snow?.tileSize ?? 2;
  const searchRadius = getSurfaceMaskSearchRadius(blendCells, tileSize);
  const roadTileId = maskConfig.roadTileId;
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
  const snowCover = maskConfig.snow
    ? snowBiomeCoverField(halo, haloSize, maskConfig.snow.classification.snowBiomeCover, roadTileId)
    : null;
  const wetness = vertexWetness(chunkSize, originX, originZ, usableWaterField, sampleWater, waterlineDepth);
  const habitat = prepareGrassHabitatHalo({halo,haloSize,searchRadius,chunkSize,heights,
    originX,originZ,maskConfig,sampleHeight,sampleWater,snowCover,
    coreWater:usableWaterField ? (x,z)=>sampleCellWaterOccupancy(usableWaterField,x,z,waterlineDepth) : null});
  // Barren land — not water, not a road, whose verge has its own blend, and not
  // a snow drift on grass ground, which the sward meets — fades the sward over
  // the wider barren edge.
  const barren = Uint8Array.from(habitat.eligibility, (eligible, i) => (
    !eligible && habitat.water[i] < 1 && halo[i] !== roadTileId && !habitat.snowed[i] ? 1 : 0));
  const coverage = grassHabitatCoverage(habitat.eligibility,haloSize,haloSize,tileSize,barren);
  const densityByTile = maskConfig.grassDensityByTile ?? null;
  const worldSeed = maskConfig.worldSeed ?? 0;
  // Stand density blurred across biome borders over grass cells only (water,
  // roads and barren land drop out: the coverage fringe already thins toward
  // them), so a thin biome's islands thin in rather than starting at a line.
  // Biome ground colour blurred across borders the same way: the terrain draws
  // a cell's own swatch wherever grass thins out, and stepping from one biome's
  // swatch to the next at a cell edge left a notched line around every border.
  // Water and roads neither give nor take colour; the tile id in alpha stays.
  if (tilePixelsOut && tileColor) {
    const blends = (t) => t !== maskConfig.waterTileId && t !== roadTileId;
    const share = blurTileField(halo, haloSize, (t) => (blends(t) ? 1 : 0));
    const channels = [0, 1, 2].map((channel) => blurTileField(halo, haloSize,
      (t) => (blends(t) ? tileColor(t)[channel] : 0)));
    // Bare ground near a desert is the desert's sand: blended with the grass
    // swatch it drew a grey-brown verge round every erg, under the thinning sward.
    const arid = new Set(maskConfig.aridTileIds ?? []);
    const aridShare = halo.some((t) => arid.has(t)) ? blurTileField(halo, haloSize, (t) => (arid.has(t) ? 1 : 0)) : null;
    const aridChannels = aridShare && [0, 1, 2].map((channel) => blurTileField(halo, haloSize,
      (t) => (arid.has(t) ? tileColor(t)[channel] : 0)));
    for (let localZ = 0; localZ < chunkSize; localZ += 1) {
      for (let localX = 0; localX < chunkSize; localX += 1) {
        const cellIndex = localZ * chunkSize + localX;
        const haloIndex = (localZ + searchRadius) * haloSize + (localX + searchRadius);
        if (!blends(tiles[cellIndex]) || share[haloIndex] < 1e-6) continue;
        const sandy = aridShare && aridShare[haloIndex] > 1e-6
          ? smoothstep(0, 0.5, aridShare[haloIndex]) * (1 - coverage[haloIndex] / 255) : 0;
        for (let channel = 0; channel < 3; channel += 1) {
          const blended = channels[channel][haloIndex] / share[haloIndex];
          const sand = sandy > 0 ? aridChannels[channel][haloIndex] / aridShare[haloIndex] : blended;
          tilePixelsOut[cellIndex * 4 + channel] = Math.round(blended + (sand - blended) * sandy);
        }
      }
    }
  }
  let blurredDensity = null;
  if (densityByTile) {
    const grassTiles = new Set(maskConfig.grassTileIds);
    const weighted = blurTileField(halo, haloSize, (t) => (grassTiles.has(t) ? densityByTile[t] ?? 1 : 0));
    const share = blurTileField(halo, haloSize, (t) => (grassTiles.has(t) ? 1 : 0));
    blurredDensity = weighted.map((value, i) => (share[i] > 1e-6 ? value / share[i] : 1));
  }

  for (let localZ = 0; localZ < chunkSize; localZ += 1) {
    for (let localX = 0; localX < chunkSize; localX += 1) {
      const cellIndex = localZ * chunkSize + localX;
      const haloIndex = (localZ + searchRadius) * haloSize + (localX + searchRadius);
      const nearestRoad = distances[haloIndex];
      const pathInfluence = nearestRoad < DIST_INF / 2
        ? clamp(1 - Math.max(0, nearestRoad - 0.35) / blendCells, 0, 1)
        : 0;
      const offset = cellIndex * 4;
      mask[offset] = Math.round(pathInfluence * 255);
      // Thin biomes grow islands of grass over bare ground; the habitat edge
      // thins the same way, so a sward dissolves into a desert in patches.
      let grass = coverage[haloIndex];
      if (densityByTile && grass > 0) {
        const density = blurredDensity[haloIndex] * (grass / 255);
        grass = Math.round(grass * grassPatchCover(originX + localX + 0.5, originZ + localZ + 0.5, density, worldSeed));
      }
      // A bank cell partly under water keeps grass by its dry share: the habitat
      // edge alone grew blades out across the shallows of a gently shelving bank.
      const dry = 1 - habitat.water[haloIndex];
      mask[offset + 1] = Math.round(grass * dry * dry);
      mask[offset + 2] = Math.round(habitat.water[haloIndex] * 255);
      // Continuous dry share for the bake's snow (255 dry); B stays the gate.
      mask[offset + 3] = wetness
        ? Math.round((1 - (wetness[localZ * (chunkSize + 1) + localX] + wetness[localZ * (chunkSize + 1) + localX + 1]
          + wetness[(localZ + 1) * (chunkSize + 1) + localX] + wetness[(localZ + 1) * (chunkSize + 1) + localX + 1]) / 4) * 255)
        : Math.round((1 - habitat.water[haloIndex]) * 255);
      if (snowCoverOut) snowCoverOut[cellIndex] = Math.round((snowCover?.[haloIndex] ?? 0) * 255);
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
export function enrichPageRenderPixels(page, sampleTile, maskConfig, tileDefinitions = null, sampling = {}) {
  const chunkSize = Math.sqrt(page.tiles.length) | 0;
  page.tilePixels = buildTilePixels(page.tiles, tileDefinitions, maskConfig?.soilColorByTile);
  // Biome snow blurred across borders, for the material bake's snow.
  page.snowBiomeCover = new Uint8Array(chunkSize * chunkSize);
  const colors = new Map();
  const tileColor = (tileId) => {
    let color = colors.get(tileId);
    if (!color) {
      const tile = resolveTile(tileId, tileDefinitions);
      color = tile ? hexToRgbBytes(maskConfig?.soilColorByTile?.[tile.id] ?? tile.color) : [0, 0, 0];
      colors.set(tileId, color);
    }
    return color;
  };
  page.surfaceMaskPixels = buildSurfaceMaskPixels({
    snowCoverOut: page.snowBiomeCover,
    tilePixelsOut: page.tilePixels,
    tileColor,
    tiles: page.tiles,
    heights: page.heights ?? null,
    originX: page.originX,
    originZ: page.originZ,
    chunkSize,
    sampleTile,
    maskConfig,
    sampleHeight: sampling.sampleHeight ? (x,z)=>sampling.sampleHeight(x,z) : null,
    sampleWater: sampling.sampleWater ? (x,z)=>sampling.sampleWater(x,z) : null,
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
