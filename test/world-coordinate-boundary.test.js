import assert from 'node:assert/strict';
import test from 'node:test';

import {
  cellCenterToWorld,
  chunkCellBounds,
  worldToCell,
} from '../src/editor/world/WorldCoordinates.js';
import { WORLD_MAX_SAFE_CELL_COORDINATE } from '../src/editor/world/worldConstants.js';

test('worldToCell rejects invalid tile sizes', () => {
  for (const tileSize of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => worldToCell(0, 0, tileSize),
      /tile size must be a positive finite number/,
    );
  }
});

test('worldToCell rejects positions that resolve beyond the engine cell limit', () => {
  assert.throws(
    () => worldToCell(WORLD_MAX_SAFE_CELL_COORDINATE + 1, 0, 1),
    /cellX must be a safe world-cell integer/,
  );
});

test('chunkCellBounds rejects bounds that overflow the engine cell limit', () => {
  const overflowingChunk = Math.floor(WORLD_MAX_SAFE_CELL_COORDINATE / 8) + 1;

  assert.throws(
    () => chunkCellBounds(overflowingChunk, 0, 8),
    /minX must be a safe world-cell integer/,
  );
});

test('cellCenterToWorld rejects invalid tile sizes', () => {
  assert.throws(
    () => cellCenterToWorld(0, 0, Number.POSITIVE_INFINITY),
    /tile size must be a positive finite number/,
  );
});
