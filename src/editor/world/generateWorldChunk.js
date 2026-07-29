import { enrichPageVegetationScatter } from '../stylized/vegetationScatter.js';
import { enrichPageWaterField } from '../water/WaterField.js';
import { chunkKey } from './WorldCoordinates.js';
import { createWorldGenerator } from './WorldGeneratorFactory.js';
import {
  createSurfaceMaskConfig,
  enrichPageRenderPixels,
} from './ChunkRenderPixels.js';

function assertChunkRequest(request) {
  if (!Number.isSafeInteger(request?.chunkX) || !Number.isSafeInteger(request?.chunkZ)) {
    throw new Error('World chunk coordinates must be safe integers.');
  }
  if (!Number.isInteger(request.chunkSize) || request.chunkSize < 1) {
    throw new Error('World chunk size must be a positive integer.');
  }
}

function resolveMaskConfig(request) {
  const provided = request.surfaceMaskConfig;
  if (
    provided
    && Number.isFinite(provided.blendCells)
    && Number.isInteger(provided.roadTileId)
    && Array.isArray(provided.grassTileIds)
  ) {
    return {
      blendCells: provided.blendCells,
      roadTileId: provided.roadTileId,
      waterTileId: provided.waterTileId ?? 0,
      grassTileIds: [...provided.grassTileIds],
      waterlineDepth: provided.waterlineDepth,
    };
  }
  return createSurfaceMaskConfig(null);
}

export function generateBaseWorldChunk(request) {
  assertChunkRequest(request);
  const generator = request.worldGenerator
    ?? createWorldGenerator(request.generator, request.baseTerrain ?? null);
  const { chunkX, chunkZ, chunkSize } = request;
  const vertexSize = chunkSize + 1;
  const tiles = new Uint8Array(chunkSize * chunkSize);
  const heights = new Float32Array(vertexSize * vertexSize);
  const originX = chunkX * chunkSize;
  const originZ = chunkZ * chunkSize;

  for (let localZ = 0; localZ < chunkSize; localZ += 1) {
    for (let localX = 0; localX < chunkSize; localX += 1) {
      tiles[localZ * chunkSize + localX] = generator.sampleTile(
        originX + localX,
        originZ + localZ,
      );
    }
  }
  for (let localZ = 0; localZ <= chunkSize; localZ += 1) {
    for (let localX = 0; localX <= chunkSize; localX += 1) {
      heights[localZ * vertexSize + localX] = generator.sampleHeight(
        originX + localX,
        originZ + localZ,
      );
    }
  }

  const page = {
    key: chunkKey(chunkX, chunkZ),
    chunkX,
    chunkZ,
    originX,
    originZ,
    tiles,
    heights,
  };
  const timings = {};
  const waterStartedAt = performance.now();
  enrichPageWaterField(page, (cellX, cellZ) => generator.sampleWater(cellX, cellZ));
  timings.waterGenerationMs = performance.now() - waterStartedAt;

  const maskConfig = resolveMaskConfig(request);
  const tilePixelsStartedAt = performance.now();
  enrichPageRenderPixels(
    page,
    (cellX, cellZ) => generator.sampleTile(cellX, cellZ),
    generator.getSurfaceMaskConfig?.(maskConfig) ?? maskConfig,
    (tileId) => generator.getTileDefinition?.(tileId),
  );
  // enrichPageRenderPixels builds both tile + surface mask; split isn't
  // exposed, so attribute the whole render-pixel pass to surfaceMask for QA
  // (historically the dominant cost) and leave tilePixels as a sibling key.
  timings.surfaceMaskMs = performance.now() - tilePixelsStartedAt;
  timings.tilePixelsMs = timings.surfaceMaskMs;
  page.timings = timings;

  if (request.vegetationScatterConfig) {
    enrichPageVegetationScatter(page, request.vegetationScatterConfig);
  }

  return page;
}
