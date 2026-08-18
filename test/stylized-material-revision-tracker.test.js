import assert from 'node:assert/strict';
import test from 'node:test';
import { StylizedChunkRevisionTracker } from '../src/editor/stylized/StylizedChunkRevisionTracker.js';

function createWorldStore(chunkSize = 4) {
  let listener = null;
  return {
    chunkSize,
    subscribe(next) {
      listener = next;
      return () => {
        listener = null;
      };
    },
    emit(change) {
      listener?.(change);
    },
  };
}

test('material revisions distinguish tile, height, water and canopy sources', () => {
  const worldStore = createWorldStore();
  const tracker = new StylizedChunkRevisionTracker({ worldStore });

  worldStore.emit({ kind: 'tile', cells: [{ x: 4, z: 0 }] });
  const neighbor = tracker.materialRevisionsFor(0, 0, { tileHalo: 1 });
  assert.ok(neighbor.tile > 0);
  assert.equal(neighbor.water, neighbor.tile);
  assert.equal(neighbor.height, 0);

  worldStore.emit({ kind: 'height', vertices: [{ x: 4, z: 4 }] });
  const edited = tracker.materialRevisionsFor(1, 1);
  assert.ok(edited.height > 0);
  assert.equal(edited.water, edited.height);

  tracker.touchMaterialField(1, 1, 'canopy');
  const canopy = tracker.materialRevisionsFor(1, 1);
  assert.ok(canopy.canopy > 0);
  tracker.dispose();
});

test('world reset advances epoch and clears local material revision maps', () => {
  const worldStore = createWorldStore();
  const tracker = new StylizedChunkRevisionTracker({ worldStore });
  worldStore.emit({ kind: 'tile', cells: [{ x: 0, z: 0 }] });
  tracker.touchMaterialField(0, 0, 'canopy');

  worldStore.emit({ kind: 'reset' });
  const revisions = tracker.materialRevisionsFor(0, 0, { tileHalo: 1 });
  assert.equal(revisions.world, 1);
  assert.equal(revisions.tile, 0);
  assert.equal(revisions.height, 0);
  assert.equal(revisions.water, 0);
  assert.equal(revisions.canopy, 0);
  tracker.dispose();
});
