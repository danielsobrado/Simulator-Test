import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeChunkDocument } from '../src/editor/world/ChunkDocumentCodec.js';
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

function chunkDocumentAt(x, z = 0) {
  return { x, z, tiles: [], heights: [] };
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

test('persisted chunks reject positive cell-coordinate overflow before reconstruction', () => {
  const firstOverflowingChunk = Math.floor(WORLD_MAX_SAFE_CELL_COORDINATE / CHUNK_SIZE);

  assert.throws(
    () => decodeChunkDocument(chunkDocumentAt(firstOverflowingChunk), CHUNK_SIZE),
    /exceeds the engine cell coordinate limit/,
  );
});

test('persisted chunks reject negative cell-coordinate overflow before reconstruction', () => {
  const firstOverflowingChunk = -Math.floor(WORLD_MAX_SAFE_CELL_COORDINATE / CHUNK_SIZE) - 1;

  assert.throws(
    () => decodeChunkDocument(chunkDocumentAt(firstOverflowingChunk), CHUNK_SIZE),
    /exceeds the engine cell coordinate limit/,
  );
});
