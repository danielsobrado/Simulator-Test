import assert from 'node:assert/strict';
import test from 'node:test';

import { InfiniteTerrainView } from '../src/editor/InfiniteTerrainView.js';

test('terrain streaming listener failures do not escape or block later listeners', () => {
  const view = Object.create(InfiniteTerrainView.prototype);
  view.streamingListeners = new Set();
  const event = Object.freeze({ kind: 'chunk-streamed-in', chunkX: 2, chunkZ: -3 });
  const received = [];
  const errors = [];
  const originalError = console.error;

  view.streamingListeners.add(() => {
    throw new Error('listener boom');
  });
  view.streamingListeners.add((next) => received.push(next));
  console.error = (...args) => errors.push(args);

  try {
    assert.doesNotThrow(() => view.emitStreaming(event));
  } finally {
    console.error = originalError;
  }

  assert.deepEqual(received, [event]);
  assert.equal(errors.length, 1);
  assert.match(errors[0][0], /Terrain streaming listener failed/);
  assert.match(errors[0][1]?.message ?? '', /listener boom/);
});
