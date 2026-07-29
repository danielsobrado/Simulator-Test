import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildSurfaceMaskPixels,
  createSurfaceMaskConfig,
} from '../src/editor/world/ChunkRenderPixels.js';
import { createWaterField } from '../src/editor/water/WaterField.js';

const CHUNK_SIZE = 8;
const GRASSLAND_TILE = 4;
const WATER_CHANNEL = 2;

/**
 * A lake over grassland: the bed drops away west of x = 4, and every cell keeps
 * its dry biome id because water is a field over the terrain, not a biome.
 */
function lakeWater(cellX) {
  const surfaceHeight = 0;
  const bedHeight = cellX < 4 ? -1.5 : 0.5;
  const depth = Math.max(0, surfaceHeight - bedHeight);
  return {
    kind: depth > 0 ? 2 : 0,
    coverage: depth > 0 ? 1 : 0,
    surfaceHeight,
    bedHeight,
    depth,
    shoreDistance: Math.abs(cellX - 4),
    flowX: 0,
    flowZ: 0,
    bodyId: 1,
  };
}

function buildMask() {
  const tiles = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(GRASSLAND_TILE);
  const field = createWaterField({
    originX: 0,
    originZ: 0,
    chunkSize: CHUNK_SIZE,
    sampleWater: (cellX) => lakeWater(cellX),
  });
  return buildSurfaceMaskPixels({
    tiles,
    originX: 0,
    originZ: 0,
    chunkSize: CHUNK_SIZE,
    sampleTile: () => GRASSLAND_TILE,
    maskConfig: createSurfaceMaskConfig(null),
    waterField: { pixels: field.pixels, width: field.width, height: field.height },
  });
}

function waterAt(mask, cellX, cellZ) {
  return mask[(cellZ * CHUNK_SIZE + cellX) * 4 + WATER_CHANNEL];
}

test('inland water classifies as water even though its cells keep a land biome', () => {
  const mask = buildMask();
  assert.equal(waterAt(mask, 0, 0), 255, 'submerged grassland must read as water');
  assert.equal(waterAt(mask, 7, 0), 0, 'dry grassland must stay land');
});

test('the land class retreats to the waterline, not to the tile boundary', () => {
  const mask = buildMask();
  // The bank cell straddles the waterline, so it is neither fully wet nor dry:
  // grass fades across it instead of ending on a cell edge a metre inland.
  const bank = waterAt(mask, 3, 0);
  assert.ok(bank > 0, 'the bank cell must carry partial water occupancy');
  assert.ok(bank <= 255);
  for (let cellX = 1; cellX < CHUNK_SIZE; cellX += 1) {
    assert.ok(
      waterAt(mask, cellX, 0) <= waterAt(mask, cellX - 1, 0),
      'water occupancy must fall monotonically from the lake to the bank',
    );
  }
});

test('a page without a water field still classifies marine tiles', () => {
  const tiles = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE).fill(GRASSLAND_TILE);
  tiles[0] = 0;
  const mask = buildSurfaceMaskPixels({
    tiles,
    originX: 0,
    originZ: 0,
    chunkSize: CHUNK_SIZE,
    sampleTile: (cellX, cellZ) => (cellX === 0 && cellZ === 0 ? 0 : GRASSLAND_TILE),
    maskConfig: createSurfaceMaskConfig(null),
  });
  assert.equal(waterAt(mask, 0, 0), 255);
  assert.equal(waterAt(mask, 1, 0), 0);
});
