import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSurfaceMaskPixels } from '../src/editor/world/ChunkRenderPixels.js';

const SAND = [200, 180, 140], GRASS = [60, 120, 40];
const sampleTile = (x) => (x < 8 ? 1 : 4);

function verge(aridTileIds) {
  const chunkSize = 16;
  const tiles = Uint8Array.from({ length: chunkSize * chunkSize }, (_, i) => sampleTile(i % chunkSize));
  const tilePixelsOut = new Uint8Array(tiles.length * 4);
  const mask = buildSurfaceMaskPixels({
    tiles, originX: 0, originZ: 0, chunkSize, sampleTile, tilePixelsOut,
    tileColor: (t) => (t === 1 ? SAND : GRASS),
    maskConfig: { blendCells: 2.5, roadTileId: 13, waterTileId: 0, grassTileIds: [4], aridTileIds, tileSize: 2 },
  });
  const cell = 8 * chunkSize + 8; // first grassland cell, where the sward thins out
  return { color: [...tilePixelsOut.slice(cell * 4, cell * 4 + 3)], grass: mask[cell * 4 + 1] };
}

test('bare ground at a desert border wears the sand, not a grey blend of both swatches', () => {
  const plain = verge([]), sandy = verge([1]);
  assert.ok(plain.grass < 200, 'the sward thins at the border');
  assert.ok(sandy.color[0] > plain.color[0] + 20, `${sandy.color} vs ${plain.color}`);
  assert.ok(Math.abs(sandy.color[0] - SAND[0]) < Math.abs(plain.color[0] - SAND[0]));
});
