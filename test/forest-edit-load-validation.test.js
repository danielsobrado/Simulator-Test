import assert from 'node:assert/strict';
import test from 'node:test';

import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import { WorkerBackedWorldStore } from '../src/editor/world/WorkerBackedWorldStore.js';

function createStore() {
  return new WorkerBackedWorldStore({
    chunkWorker: {
      setBaseTerrain() {},
      dispose() {},
    },
    chunkSize: 8,
    tileSize: 2,
    cacheLimit: 4,
    generator: new ProceduralWorldGenerator(),
  });
}

test('malformed planted forest edits fail inside the world load transaction', () => {
  const store = createStore();
  try {
    const document = store.toDocument();
    document.forestEdits = {
      version: 1,
      felled: [],
      planted: [{ stableId: 'tree-1', x: Number.NaN, z: 4 }],
      patches: [],
    };

    assert.throws(
      () => store.loadDocument(document),
      /Planted forest coordinates must be finite/,
    );
    assert.deepEqual(store.forestEdits, {
      version: 1,
      felled: [],
      planted: [],
      patches: [],
    });
  } finally {
    store.dispose();
  }
});
