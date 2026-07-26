import {
  cellSampleRandom01,
  grassClumpCellOffset,
  sampleHeight,
  scatterRandom01,
} from './scatterMath.js';
import { clumpsPerCell } from './grassLodMath.js';

const TWO_PI = Math.PI * 2;

/**
 * Serialisable scatter config shipped to the chunk worker.
 * Keep this free of Three.js / DOM references.
 */
export function createVegetationScatterConfig(stylizedConfig, tileSize) {
  if (!stylizedConfig?.enabled) return null;
  const grass = stylizedConfig.grass;
  const flowers = stylizedConfig.flowers;
  const bladesPerClump = grass?.bladesPerClump ?? 8;
  return {
    tileSize,
    grass: grass && stylizedConfig.enabled !== false
      ? {
        enabled: true,
        clumpsPerCell: clumpsPerCell(grass.bladesPerCell, bladesPerClump),
        tileIds: [...(grass.tileIds ?? [])],
        minWidth: grass.minWidth,
        maxWidth: grass.maxWidth,
        minLength: grass.minLength,
        maxLength: grass.maxLength,
      }
      : null,
    flowers: flowers?.enabled
      ? {
        enabled: true,
        perChunk: flowers.perChunk,
        tileIds: [...(flowers.tileIds ?? [])],
        minSize: flowers.minSize,
        maxSize: flowers.maxSize,
      }
      : null,
  };
}

export function buildGrassScatter({
  page,
  chunkSize,
  tileSize,
  clumpsPerCell: clumps,
  tileIds,
  minWidth,
  maxWidth,
  minLength,
  maxLength,
}) {
  const eligible = new Set(tileIds);
  const maxInstances = chunkSize * chunkSize * clumps;
  const base = new Float32Array(maxInstances * 3);
  const parameters = new Float32Array(maxInstances * 4);
  const chunkWorldSize = chunkSize * tileSize;
  let count = 0;
  let minimumHeight = Number.POSITIVE_INFINITY;
  let maximumHeight = Number.NEGATIVE_INFINITY;

  for (let cellIndex = 0; cellIndex < chunkSize * chunkSize; cellIndex += 1) {
    if (!eligible.has(page.tiles[cellIndex])) continue;
    const localX = cellIndex % chunkSize;
    const localZ = Math.floor(cellIndex / chunkSize);
    for (let clumpIndex = 0; clumpIndex < clumps; clumpIndex += 1) {
      const offset = grassClumpCellOffset(page.chunkX, page.chunkZ, cellIndex, clumpIndex);
      const sampleX = localX + offset.x;
      const sampleZ = localZ + offset.z;
      const localWorldX = -chunkWorldSize / 2 + sampleX * tileSize;
      const localWorldZ = chunkWorldSize / 2 - sampleZ * tileSize;
      const height = sampleHeight(page, sampleX, sampleZ, chunkSize);
      const width = minWidth + cellSampleRandom01(page.chunkX, page.chunkZ, cellIndex, clumpIndex, 2)
        * (maxWidth - minWidth);
      const length = minLength + cellSampleRandom01(page.chunkX, page.chunkZ, cellIndex, clumpIndex, 3)
        * (maxLength - minLength);
      const angle = cellSampleRandom01(page.chunkX, page.chunkZ, cellIndex, clumpIndex, 4) * TWO_PI;

      const baseOffset = count * 3;
      base[baseOffset] = localWorldX;
      base[baseOffset + 1] = height;
      base[baseOffset + 2] = localWorldZ;
      const parameterOffset = count * 4;
      parameters[parameterOffset] = width;
      parameters[parameterOffset + 1] = length;
      parameters[parameterOffset + 2] = angle;
      parameters[parameterOffset + 3] = cellSampleRandom01(
        page.chunkX,
        page.chunkZ,
        cellIndex,
        clumpIndex,
        5,
      );
      minimumHeight = Math.min(minimumHeight, height);
      maximumHeight = Math.max(maximumHeight, height);
      count += 1;
    }
  }

  return {
    base,
    parameters,
    count,
    clumpsPerCell: clumps,
    minimumHeight,
    maximumHeight,
  };
}

/**
 * Compact a full-density grass scatter down to `targetClumpsPerCell` per eligible cell.
 * Matches main-thread generation which uses clump indices `0..target-1`.
 */
export function compactGrassScatter(scatter, targetClumpsPerCell, chunkSize) {
  if (!scatter || targetClumpsPerCell >= scatter.clumpsPerCell) {
    return scatter;
  }
  const sourceClumps = scatter.clumpsPerCell;
  const base = new Float32Array(chunkSize * chunkSize * targetClumpsPerCell * 3);
  const parameters = new Float32Array(chunkSize * chunkSize * targetClumpsPerCell * 4);
  let read = 0;
  let write = 0;
  let minimumHeight = Number.POSITIVE_INFINITY;
  let maximumHeight = Number.NEGATIVE_INFINITY;

  // Source was written cell-major over eligible cells only — recover by walking
  // the packed source count in clumpsPerCell strides is wrong when tiles skip.
  // Instead: rebuild from the packed stream by grouping consecutive clumps.
  // Eligible cells produce exactly `sourceClumps` instances each in order.
  const groups = scatter.count / sourceClumps;
  for (let group = 0; group < groups; group += 1) {
    for (let clump = 0; clump < targetClumpsPerCell; clump += 1) {
      const src = (group * sourceClumps + clump) * 3;
      const dst = write * 3;
      base[dst] = scatter.base[src];
      base[dst + 1] = scatter.base[src + 1];
      base[dst + 2] = scatter.base[src + 2];
      const srcP = (group * sourceClumps + clump) * 4;
      const dstP = write * 4;
      parameters[dstP] = scatter.parameters[srcP];
      parameters[dstP + 1] = scatter.parameters[srcP + 1];
      parameters[dstP + 2] = scatter.parameters[srcP + 2];
      parameters[dstP + 3] = scatter.parameters[srcP + 3];
      minimumHeight = Math.min(minimumHeight, base[dst + 1]);
      maximumHeight = Math.max(maximumHeight, base[dst + 1]);
      write += 1;
    }
    read += sourceClumps;
  }
  void read;

  return {
    base,
    parameters,
    count: write,
    clumpsPerCell: targetClumpsPerCell,
    minimumHeight,
    maximumHeight,
  };
}

export function buildFlowerScatter({
  page,
  chunkSize,
  tileSize,
  sampleLimit,
  tileIds,
  minSize,
  maxSize,
}) {
  const eligible = new Set(tileIds);
  const base = new Float32Array(sampleLimit * 3);
  const parameters = new Float32Array(sampleLimit * 4);
  const chunkWorldSize = chunkSize * tileSize;
  let count = 0;
  let minimumHeight = Number.POSITIVE_INFINITY;
  let maximumHeight = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < sampleLimit; index += 1) {
    const localX = scatterRandom01(page.chunkX, page.chunkZ, index, 0) * chunkSize;
    const localZ = scatterRandom01(page.chunkX, page.chunkZ, index, 1) * chunkSize;
    const cellX = Math.min(chunkSize - 1, Math.floor(localX));
    const cellZ = Math.min(chunkSize - 1, Math.floor(localZ));
    const cellIndex = cellZ * chunkSize + cellX;
    if (!eligible.has(page.tiles[cellIndex])) continue;
    const localWorldX = -chunkWorldSize / 2 + localX * tileSize;
    const localWorldZ = chunkWorldSize / 2 - localZ * tileSize;
    const height = sampleHeight(page, localX, localZ, chunkSize);
    const baseOffset = count * 3;
    base[baseOffset] = localWorldX;
    base[baseOffset + 1] = height;
    base[baseOffset + 2] = localWorldZ;
    const parameterOffset = count * 4;
    parameters[parameterOffset] = scatterRandom01(page.chunkX, page.chunkZ, index, 2) * Math.PI * 2;
    parameters[parameterOffset + 1] = minSize
      + scatterRandom01(page.chunkX, page.chunkZ, index, 3) * (maxSize - minSize);
    parameters[parameterOffset + 2] = scatterRandom01(page.chunkX, page.chunkZ, index, 4);
    parameters[parameterOffset + 3] = scatterRandom01(page.chunkX, page.chunkZ, index, 5) < 0.5 ? 0 : 1;
    minimumHeight = Math.min(minimumHeight, height);
    maximumHeight = Math.max(maximumHeight, height);
    count += 1;
  }

  return {
    base,
    parameters,
    count,
    sampleLimit,
    minimumHeight,
    maximumHeight,
  };
}

/**
 * Attach worker-ready grass/flower scatter buffers to a page.
 * Flower density reductions rebuild with a lower sampleLimit on the main thread
 * (packed accepts are not a simple prefix of the full scatter).
 */
export function enrichPageVegetationScatter(page, scatterConfig) {
  if (!scatterConfig || !page?.tiles || !page?.heights) {
    return page;
  }
  const chunkSize = Math.sqrt(page.tiles.length) | 0;
  const tileSize = scatterConfig.tileSize;
  const timings = page.timings ?? {};

  if (scatterConfig.grass?.enabled) {
    const startedAt = performance.now();
    const grass = scatterConfig.grass;
    page.grassScatter = buildGrassScatter({
      page,
      chunkSize,
      tileSize,
      clumpsPerCell: grass.clumpsPerCell,
      tileIds: grass.tileIds,
      minWidth: grass.minWidth,
      maxWidth: grass.maxWidth,
      minLength: grass.minLength,
      maxLength: grass.maxLength,
    });
    timings.grassScatterMs = performance.now() - startedAt;
  }

  if (scatterConfig.flowers?.enabled) {
    const startedAt = performance.now();
    const flowers = scatterConfig.flowers;
    page.flowerScatter = buildFlowerScatter({
      page,
      chunkSize,
      tileSize,
      sampleLimit: flowers.perChunk,
      tileIds: flowers.tileIds,
      minSize: flowers.minSize,
      maxSize: flowers.maxSize,
    });
    timings.flowerScatterMs = performance.now() - startedAt;
  }

  page.timings = timings;
  return page;
}
