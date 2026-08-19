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

function disposable() {
  return { dispose() {} };
}

test('terrain view disposal cancels only in-flight chunk requests', () => {
  const cancelled = [];
  const view = Object.create(InfiniteTerrainView.prototype);
  view.disposed = false;
  view.commitQueue = { clear() {} };
  view.pendingFetches = new Set([Promise.resolve()]);
  view.streamingListeners = new Set([() => {}]);
  view.setAnimationLoop = () => {};
  view.unsubscribeWorld = () => {};
  view.worldStore = {
    cancelChunk(chunkX, chunkZ) {
      cancelled.push([chunkX, chunkZ]);
    },
  };
  view.preview = {
    geometry: disposable(),
    material: disposable(),
  };
  view.scene = { remove() {} };
  view.slots = [
    {
      loading: true,
      descriptor: { chunkX: 4, chunkZ: -2 },
      mesh: {},
      material: disposable(),
      tileTexture: disposable(),
      surfaceMaskTexture: disposable(),
      heightTexture: disposable(),
      forestFloorTexture: disposable(),
    },
    {
      loading: false,
      descriptor: { chunkX: 8, chunkZ: 9 },
      mesh: {},
      material: disposable(),
      tileTexture: disposable(),
      surfaceMaskTexture: disposable(),
      heightTexture: disposable(),
      forestFloorTexture: disposable(),
    },
  ];
  view.geometry = disposable();
  view.godRays = disposable();
  view.renderer = {
    dispose() {},
    domElement: { remove() {} },
  };

  view.dispose();

  assert.deepEqual(cancelled, [[4, -2]]);
  assert.equal(view.pendingFetches.size, 0);
  assert.equal(view.streamingListeners.size, 0);
  assert.doesNotThrow(() => view.dispose());
});
