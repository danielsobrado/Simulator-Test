import assert from 'node:assert/strict';
import test from 'node:test';

import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import { WorkerBackedWorldStore } from '../src/editor/world/WorkerBackedWorldStore.js';

const CHUNK_SIZE = 8;

test('immediate disposal prevents deferred worker and content requests', async () => {
  let workerCalls = 0;
  let contentCalls = 0;
  const store = new WorkerBackedWorldStore({
    chunkWorker: {
      request() {
        workerCalls += 1;
        return new Promise(() => {});
      },
      setBaseTerrain() {},
      dispose() {},
    },
    contentProvider: {
      getChunk() {
        contentCalls += 1;
        return null;
      },
      dispose() {},
    },
    chunkSize: CHUNK_SIZE,
    tileSize: 2,
    cacheLimit: 4,
    generator: new ProceduralWorldGenerator(),
  });

  const request = store.requestChunk(0, 0);
  store.dispose();

  await assert.rejects(
    request,
    (error) => error?.cancelled === true && /store disposal/.test(error.message),
  );
  assert.equal(workerCalls, 0);
  assert.equal(contentCalls, 0);
  assert.equal(store.pendingChunks.size, 0);
});
