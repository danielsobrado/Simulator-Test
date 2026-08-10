import assert from 'node:assert/strict';
import test from 'node:test';

import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import { WorkerBackedWorldStore } from '../src/editor/world/WorkerBackedWorldStore.js';

function createStore() {
  const calls = { setBaseTerrain: 0, dispose: 0 };
  const chunkWorker = {
    setBaseTerrain() { calls.setBaseTerrain += 1; },
    dispose() { calls.dispose += 1; },
  };
  const store = new WorkerBackedWorldStore({
    chunkWorker,
    chunkSize: 8,
    tileSize: 2,
    cacheLimit: 16,
    generator: new ProceduralWorldGenerator(),
  });
  return { calls, store };
}

test('malformed sparse tile values are rejected before world state starts mutating', () => {
  const { calls, store } = createStore();
  try {
    const document = store.toDocument();
    document.chunks = [{
      x: 0,
      z: 0,
      tiles: [[0, 999]],
      heights: [],
    }];

    assert.throws(
      () => store.loadDocument(document),
      /tile override value must be an unsigned byte/,
    );
    assert.equal(store.baseTerrainRevision, 0);
    assert.equal(calls.setBaseTerrain, 0);
    assert.equal(store.tileOverrides.size, 0);
  } finally {
    store.dispose();
  }
});

test('the full unsigned-byte tile range remains valid for sparse saves', () => {
  const { store } = createStore();
  try {
    const document = store.toDocument();
    document.chunks = [{
      x: 0,
      z: 0,
      tiles: [[0, 255]],
      heights: [],
    }];

    store.loadDocument(document);
    assert.equal(store.getTile(0, 0), 255);
  } finally {
    store.dispose();
  }
});
