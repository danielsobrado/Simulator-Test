import assert from 'node:assert/strict';
import test from 'node:test';
import { FloatingOrigin } from '../src/editor/world/FloatingOrigin.js';
import {
  canonicalWorldToCell,
  canonicalWorldToRenderLocal,
  canonicalWorldToTerrainChunk,
  cellBoundsCenterToCanonicalWorld,
  cellToCanonicalWorld,
  renderLocalToCanonicalWorld,
} from '../src/editor/world/CoordinateSpaces.js';

const TILE_SIZE = 2;
const CHUNK_SIZE = 64;

test('cell centres convert to canonical metres with the world Z convention', () => {
  assert.deepEqual(cellToCanonicalWorld(0, 0, TILE_SIZE), { x: 1, z: -1 });
  assert.deepEqual(cellToCanonicalWorld(-1, -1, TILE_SIZE), { x: -1, z: 1 });
  assert.deepEqual(cellToCanonicalWorld(12, -7, TILE_SIZE), { x: 25, z: 13 });
});

test('canonical positions map to positive and negative cells', () => {
  assert.deepEqual(canonicalWorldToCell(0.99, -0.99, TILE_SIZE), { x: 0, z: 0 });
  assert.deepEqual(canonicalWorldToCell(-0.01, 0.01, TILE_SIZE), { x: -1, z: -1 });
  assert.deepEqual(canonicalWorldToCell(25, 13, TILE_SIZE), { x: 12, z: -7 });
});

test('canonical chunk conversion is stable on positive and negative boundaries', () => {
  assert.deepEqual(
    canonicalWorldToTerrainChunk(127.99, -127.99, TILE_SIZE, CHUNK_SIZE),
    { chunkX: 0, chunkZ: 0 },
  );
  assert.deepEqual(
    canonicalWorldToTerrainChunk(128, -128, TILE_SIZE, CHUNK_SIZE),
    { chunkX: 1, chunkZ: 1 },
  );
  assert.deepEqual(
    canonicalWorldToTerrainChunk(-0.01, 0.01, TILE_SIZE, CHUNK_SIZE),
    { chunkX: -1, chunkZ: -1 },
  );
});

test('floating-origin render local conversion round-trips canonical positions', () => {
  const origin = new FloatingOrigin({ threshold: 100, snapSize: 128 });
  origin.setOrigin(4096, -2048);
  const render = canonicalWorldToRenderLocal(4200, -1900, origin);
  assert.deepEqual(render, { x: 104, z: 148 });
  assert.deepEqual(renderLocalToCanonicalWorld(render.x, render.z, origin), {
    x: 4200,
    z: -1900,
  });
});

test('cell bounds resolve their canonical world centre', () => {
  assert.deepEqual(
    cellBoundsCenterToCanonicalWorld({ minX: 2, maxX: 3, minZ: 4, maxZ: 5 }, TILE_SIZE),
    { x: 6, z: -10 },
  );
  assert.deepEqual(
    cellBoundsCenterToCanonicalWorld({ minX: -4, maxX: -2, minZ: -3, maxZ: -1 }, TILE_SIZE),
    { x: -5, z: 3 },
  );
});
