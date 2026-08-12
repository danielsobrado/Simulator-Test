import assert from 'node:assert/strict';
import test from 'node:test';

import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import { WorkerBackedWorldStore } from '../src/editor/world/WorkerBackedWorldStore.js';

const CHUNK_SIZE = 8;

function createStore({ chunkWorker, contentProvider = null }) {
  return new WorkerBackedWorldStore({
    chunkWorker: {
      setBaseTerrain() {},
      dispose() {},
      ...chunkWorker,
    },
    contentProvider,
    chunkSize: CHUNK_SIZE,
    tileSize: 2,
    cacheLimit: 4,
    generator: new ProceduralWorldGenerator(),
  });
}

function createPage(chunkX, chunkZ) {
  return {
    key: `${chunkX}:${chunkZ}`,
    chunkX,
    chunkZ,
    originX: chunkX * CHUNK_SIZE,
    originZ: chunkZ * CHUNK_SIZE,
    tiles: new Uint8Array(CHUNK_SIZE ** 2),
    heights: new Float32Array((CHUNK_SIZE + 1) ** 2),
  };
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

test('worker pages with mismatched chunk identity never enter the cache', async () => {
  const store = createStore({
    chunkWorker: {
      request() { return Promise.resolve(createPage(1, 0)); },
    },
  });

  try {
    await assert.rejects(store.requestChunk(0, 0), /mismatched page metadata/);
    assert.equal(store.pendingChunks.size, 0);
    assert.equal(store.cache.size, 0);
  } finally {
    store.dispose();
  }
});

test('worker pages with invalid typed-array sizes never enter the cache', async () => {
  const invalidPage = createPage(0, 0);
  invalidPage.heights = new Float32Array(1);
  const store = createStore({
    chunkWorker: {
      request() { return Promise.resolve(invalidPage); },
    },
  });

  try {
    await assert.rejects(store.requestChunk(0, 0), /invalid height data/);
    assert.equal(store.pendingChunks.size, 0);
    assert.equal(store.cache.size, 0);
  } finally {
    store.dispose();
  }
});
