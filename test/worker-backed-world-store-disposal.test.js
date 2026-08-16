import assert from 'node:assert/strict';
import test from 'node:test';

import { ProceduralWorldGenerator } from '../src/editor/world/ProceduralWorldGenerator.js';
import { WorkerBackedWorldStore } from '../src/editor/world/WorkerBackedWorldStore.js';

const CHUNK_SIZE = 8;

function createStore({ chunkWorker, contentProvider = null }) {
  return new WorkerBackedWorldStore({
    chunkWorker,
    contentProvider,
    chunkSize: CHUNK_SIZE,
    tileSize: 2,
    cacheLimit: 4,
    generator: new ProceduralWorldGenerator(),
  });
}

test('immediate disposal prevents deferred worker and content requests', async () => {
  let workerCalls = 0;
  let contentCalls = 0;
  const store = createStore({
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

test('worker cleanup still runs when content-provider cleanup fails', () => {
  const contentError = new Error('content cleanup failed');
  let workerDisposed = 0;
  const store = createStore({
    chunkWorker: {
      request() { return new Promise(() => {}); },
      setBaseTerrain() {},
      dispose() { workerDisposed += 1; },
    },
    contentProvider: {
      getChunk() { return null; },
      dispose() { throw contentError; },
    },
  });

  assert.throws(() => store.dispose(), (error) => error === contentError);
  assert.equal(workerDisposed, 1);
  assert.equal(store.disposed, true);
});

test('multiple cleanup failures are reported together', () => {
  const contentError = new Error('content cleanup failed');
  const workerError = new Error('worker cleanup failed');
  const store = createStore({
    chunkWorker: {
      request() { return new Promise(() => {}); },
      setBaseTerrain() {},
      dispose() { throw workerError; },
    },
    contentProvider: {
      getChunk() { return null; },
      dispose() { throw contentError; },
    },
  });

  assert.throws(
    () => store.dispose(),
    (error) => error instanceof AggregateError
      && error.errors[0] === contentError
      && error.errors[1] === workerError,
  );
  assert.equal(store.disposed, true);
});
