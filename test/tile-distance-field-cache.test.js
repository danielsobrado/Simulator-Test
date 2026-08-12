import assert from 'node:assert/strict';
import test from 'node:test';

import { TileDistanceField } from '../src/editor/stylized/forest/TileDistanceField.js';

function createField(options = {}) {
  return new TileDistanceField({
    tileAt: (x, z) => (x === 0 && z === 0 ? 7 : 0),
    tileSize: 1,
    chunkSize: 2,
    targetTileId: 7,
    maxCells: 2,
    ...options,
  });
}

test('tile distance field defaults to one cached chunk', () => {
  const field = createField();

  field.chunkField(0, 0);
  field.chunkField(1, 0);
  field.chunkField(2, 0);

  assert.equal(field.cache.size, 1);
  assert.deepEqual([...field.cache.keys()], ['2:0']);
  assert.equal(field.stats.builds, 3);
  assert.equal(field.stats.cacheEvictions, 2);
});

test('tile distance field refreshes cache recency on a hit', () => {
  const field = createField({ maxCachedChunks: 2 });

  field.chunkField(0, 0);
  field.chunkField(1, 0);
  field.chunkField(0, 0);
  field.chunkField(2, 0);

  assert.deepEqual([...field.cache.keys()], ['0:0', '2:0']);
  assert.equal(field.stats.cacheHits, 1);
  assert.equal(field.stats.cacheEvictions, 1);
});

test('tile distance field rejects an invalid cache capacity', () => {
  assert.throws(
    () => createField({ maxCachedChunks: 0 }),
    /maxCachedChunks must be a positive integer/,
  );
});
