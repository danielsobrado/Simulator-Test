import assert from 'node:assert/strict';
import test from 'node:test';
import { StylizedChunkRevisionTracker } from '../src/editor/stylized/StylizedChunkRevisionTracker.js';

function createTracker() {
  let listener = null;
  const tracker = new StylizedChunkRevisionTracker({
    worldStore: {
      chunkSize: 64,
      subscribe(callback) {
        listener = callback;
        return () => { listener = null; };
      },
    },
  });
  return {
    tracker,
    emit(change) { listener(change); },
  };
}

test('stylized edit revision changes only for reset or edited coordinates', () => {
  const harness = createTracker();
  assert.equal(harness.tracker.revision, 0);

  harness.emit({ kind: 'commit', cells: [], vertices: [] });
  assert.equal(harness.tracker.revision, 0);

  harness.emit({ kind: 'edit', cells: [{ x: 4, z: 8 }] });
  assert.equal(harness.tracker.revision, 1);

  harness.emit({ kind: 'edit', vertices: [{ x: 64, z: 64 }] });
  assert.ok(harness.tracker.revision > 1);

  const beforeReset = harness.tracker.revision;
  harness.emit({ kind: 'reset' });
  assert.equal(harness.tracker.revision, beforeReset + 1);
  assert.equal(harness.tracker.revisions.size, 0);
  harness.tracker.dispose();
});
