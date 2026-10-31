import assert from 'node:assert/strict';
import test from 'node:test';
import { StylizedVariantResidency } from '../src/editor/stylized/StylizedVariantResidency.js';

test('the chunk tile cache stays bounded and still serves the current window', () => {
  let lookups = 0;
  const residency = new StylizedVariantResidency({
    terrainView: { tileMap: { get: () => { lookups += 1; return 3; } } },
    prefetchChunks: 1,
  });
  const limit = residency.chunkTileCacheLimit;
  for (let chunkX = 0; chunkX < limit * 3; chunkX += 1) residency.chunkTileIds(chunkX, 0, 4, 1);
  assert.equal(residency.chunkTileCache.size, limit);
  const before = lookups;
  assert.deepEqual([...residency.chunkTileIds(limit * 3 - 1, 0, 4, 1)], [3]);
  assert.equal(lookups, before, 'a recent chunk is still a cache hit');
});
