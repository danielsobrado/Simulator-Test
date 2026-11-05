import assert from 'node:assert/strict';
import test from 'node:test';
import { groundedChunkDistance } from '../src/editor/stylized/StylizedTreeView.js';

const distance = (x, z) => Math.max(Math.abs(x), Math.abs(z));

test('without a far backdrop, trees past the drawn terrain are out of range', () => {
  const terrainView = { isChunkDrawn: (x, z) => distance(x, z) <= 3 };
  const grounded = groundedChunkDistance(terrainView, distance);
  assert.equal(grounded(2, -3), 3);
  assert.equal(grounded(4, 0), Infinity);
});

test('a far backdrop carries the horizon, so the distance is unchanged', () => {
  const terrainView = { isChunkDrawn: () => false, macroFarTerrain: { isActive: () => true } };
  assert.equal(groundedChunkDistance(terrainView, distance)(5, 5), 5);
});
