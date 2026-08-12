import assert from 'node:assert/strict';
import test from 'node:test';

import { generateBaseWorldChunk } from '../src/editor/world/generateWorldChunk.js';
import { WORLD_MAX_SAFE_CELL_COORDINATE } from '../src/editor/world/worldConstants.js';

const CHUNK_SIZE = 8;

function requestAt(chunkX, chunkZ = 0) {
  return {
    chunkX,
    chunkZ,
    chunkSize: CHUNK_SIZE,
    worldGenerator: {},
  };
}

test('chunk generation rejects positive cell-coordinate overflow before sampling', () => {
  const firstOverflowingChunk = Math.floor(WORLD_MAX_SAFE_CELL_COORDINATE / CHUNK_SIZE);

  assert.throws(
    () => generateBaseWorldChunk(requestAt(firstOverflowingChunk)),
    /exceeds the engine cell coordinate limit/,
  );
});

test('chunk generation rejects negative cell-coordinate overflow before sampling', () => {
  const firstOverflowingChunk = -Math.floor(WORLD_MAX_SAFE_CELL_COORDINATE / CHUNK_SIZE) - 1;

  assert.throws(
    () => generateBaseWorldChunk(requestAt(firstOverflowingChunk)),
    /exceeds the engine cell coordinate limit/,
  );
});
