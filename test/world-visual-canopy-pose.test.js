import test from 'node:test';
import assert from 'node:assert/strict';
import { findCanopyPose, habitatAt } from '../src/editor/performance/qa/WorldVisualCanopyPose.js';

test('canopy search checks canonical biome cells and skips open or foreign patches', () => {
  const editor = { stylizedSurface: { treeView: { manifestStore: { forestField: {
    sample: (x, z) => ({ tileId: 7, profileKey: 'closed_forest', patchCoverage: x === 16 && z === -16 ? 0.9 : 0.3, elevationWeight: 0.4 }),
  } } } }, terrainView: { worldStore: { tileSize: 16, getTile: (x, y) => x === 1 && y === 1 ? 7 : 6 } } };
  assert.deepEqual(findCanopyPose(editor, { x: 0, z: 0, tileId: 7, radius: 16 }), { x: 16, z: -16, patchCoverage: 0.9 });
  assert.equal(habitatAt(editor, 0, 0).elevationWeight, 0.4);
  assert.equal(findCanopyPose(editor, { x: 0, z: 0, tileId: 7, radius: 0 }), null);
  assert.throws(() => findCanopyPose(editor, { x: 0, z: 0, tileId: 7, step: 0 }));
  editor.stylizedSurface.treeView = null;
  assert.equal(findCanopyPose(editor, { x: 0, z: 0, tileId: 7 }), null);
  assert.equal(habitatAt(editor, 0, 0), null);
});
