import assert from 'node:assert/strict';
import test from 'node:test';

import { InfiniteWorldStore } from '../src/editor/world/InfiniteWorldStore.js';
import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import { WORLD_MAX_SAFE_CELL_COORDINATE } from '../src/editor/world/worldConstants.js';

const CHUNK_SIZE = 8;

function createStore() {
  return new InfiniteWorldStore({
    chunkSize: CHUNK_SIZE,
    tileSize: 2,
    cacheLimit: 4,
    generator: new ProceduralWorldGenerator({ seed: 42 }),
  });
}

function sculptOptions(overrides = {}) {
  return {
    centerX: 0,
    centerZ: 0,
    brushSize: 3,
    operation: 'raise',
    strength: 2,
    smoothFactor: 0.5,
    minHeight: -100,
    maxHeight: 100,
    ...overrides,
  };
}

test('terrain brushes reject non-finite sizes before entering edit loops', () => {
  const store = createStore();

  assert.throws(
    () => store.paintSquare(0, 0, Number.POSITIVE_INFINITY, 3),
    /Paint brush size must be a positive finite number/,
  );
  assert.throws(
    () => store.sculpt(sculptOptions({ brushSize: Number.POSITIVE_INFINITY })),
    /Heightfield brush size must be a positive finite number/,
  );
  assert.equal(store.tileOverrides.size, 0);
  assert.equal(store.heightOverrides.size, 0);
});

test('terrain sculpting rejects non-finite parameters before mutation', () => {
  const store = createStore();

  assert.throws(
    () => store.sculpt(sculptOptions({ strength: Number.NaN })),
    /Heightfield strength must be finite/,
  );
  assert.throws(
    () => store.sculpt(sculptOptions({ minHeight: 10, maxHeight: -10 })),
    /minimum height must not exceed maximum height/,
  );
  assert.equal(store.heightOverrides.size, 0);
});

test('paint brushes crossing the world limit fail before partial mutation', () => {
  const store = createStore();

  assert.throws(
    () => store.paintSquare(WORLD_MAX_SAFE_CELL_COORDINATE, 0, 3, 3),
    /safe world-cell integer/,
  );
  assert.equal(store.tileOverrides.size, 0);
  assert.equal(store.revision, 0);
});

test('sculpt brushes crossing the world limit fail before partial mutation', () => {
  const store = createStore();

  assert.throws(
    () => store.sculpt(sculptOptions({
      centerX: WORLD_MAX_SAFE_CELL_COORDINATE,
      brushSize: 3,
    })),
    /safe world-cell integer/,
  );
  assert.equal(store.heightOverrides.size, 0);
  assert.equal(store.revision, 0);
});

test('synchronous chunk generation rejects chunks whose border vertex exceeds the engine limit', () => {
  const store = createStore();
  const firstOverflowingChunk = Math.floor(WORLD_MAX_SAFE_CELL_COORDINATE / CHUNK_SIZE);

  assert.throws(
    () => store.getChunk(firstOverflowingChunk, 0),
    /maxVertexX must be a safe world-cell integer/,
  );
  assert.equal(store.cache.size, 0);
});
