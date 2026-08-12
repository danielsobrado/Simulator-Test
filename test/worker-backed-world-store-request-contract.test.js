import assert from 'node:assert/strict';
import test from 'node:test';

import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import { WorkerBackedWorldStore } from '../src/editor/world/WorkerBackedWorldStore.js';

function createStore({ chunkWorker, contentProvider = null }) {
  return new WorkerBackedWorldStore({
    chunkWorker: {
      setBaseTerrain() {},
      dispose() {},
      ...chunkWorker,
    },
    contentProvider,
    chunkSize: 8,
    tileSize: 2,
    cacheLimit: 4,
    generator: new ProceduralWorldGenerator(),
  });
}

test('synchronous worker failures are returned as rejected chunk promises', async () => {
  const store = createStore({
    chunkWorker: {
      request() { throw new Error('worker unavailable'); },
    },
  });

  try {
    const request = store.requestChunk(0, 0);
    assert.ok(request instanceof Promise);
    await assert.rejects(request, /worker unavailable/);
    assert.equal(store.pendingChunks.size, 0);
  } finally {
    store.dispose();
  }
});

test('synchronous content-provider failures are returned as rejected chunk promises', async () => {
  const store = createStore({
    chunkWorker: {
      request() { return new Promise(() => {}); },
    },
    contentProvider: {
      getChunk() { throw new Error('content unavailable'); },
      dispose() {},
    },
  });

  try {
    const request = store.requestChunk(0, 0);
    assert.ok(request instanceof Promise);
    await assert.rejects(request, /content unavailable/);
    assert.equal(store.pendingChunks.size, 0);
  } finally {
    store.dispose();
  }
});
