import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IndexedDbWorldContentProvider,
  LocalFirstWorldContentProvider,
} from '../src/editor/world/WorldContentProvider.js';

async function withCapturedWarnings(run) {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  try {
    await run(warnings);
  } finally {
    console.warn = originalWarn;
  }
}

test('local cache read failures fall through to remote content and warn once', async () => {
  await withCapturedWarnings(async (warnings) => {
    const provider = new LocalFirstWorldContentProvider({
      local: {
        async getChunk() { throw new Error('indexeddb unavailable'); },
        async putChunk() {},
      },
      remote: {
        async getChunk(_worldId, chunkX, chunkZ) { return { chunkX, chunkZ }; },
      },
    });

    assert.deepEqual(await provider.getChunk('world', 1, 2), { chunkX: 1, chunkZ: 2 });
    assert.deepEqual(await provider.getChunk('world', 3, 4), { chunkX: 3, chunkZ: 4 });
    assert.equal(warnings.length, 1);
  });
});

test('remote content failures fall back to generated terrain and back off repeated requests', async () => {
  await withCapturedWarnings(async (warnings) => {
    let remoteCalls = 0;
    const provider = new LocalFirstWorldContentProvider({
      local: { async getChunk() { return null; } },
      remote: {
        async getChunk() {
          remoteCalls += 1;
          throw new Error('HTTP 500');
        },
      },
    });

    assert.equal(await provider.getChunk('world', 0, 0), null);
    assert.equal(await provider.getChunk('world', 1, 0), null);
    assert.equal(remoteCalls, 1);
    assert.equal(warnings.length, 1);
  });
});

test('a failed local cache write does not discard successfully loaded remote content', async () => {
  await withCapturedWarnings(async (warnings) => {
    const remoteContent = { encounter: 'bridge' };
    const provider = new LocalFirstWorldContentProvider({
      local: {
        async getChunk() { return null; },
        async putChunk() { throw new Error('quota exceeded'); },
      },
      remote: { async getChunk() { return remoteContent; } },
    });

    assert.deepEqual(await provider.getChunk('world', 5, 6), remoteContent);
    assert.equal(warnings.length, 1);
  });
});

test('explicit content writes still report persistence failures', async () => {
  const provider = new LocalFirstWorldContentProvider({
    local: {
      async getChunk() { return null; },
      async putChunk() { throw new Error('write failed'); },
    },
  });

  await assert.rejects(provider.putChunk('world', 0, 0, { value: 1 }), /write failed/);
});

test('IndexedDB content provider reuses one connection and closes it on dispose', async () => {
  const originalIndexedDb = globalThis.indexedDB;
  let openCalls = 0;
  let closeCalls = 0;
  const database = {
    objectStoreNames: { contains: () => true },
    addEventListener() {},
    close() { closeCalls += 1; },
  };

  globalThis.indexedDB = {
    open() {
      openCalls += 1;
      const listeners = new Map();
      const request = {
        result: database,
        error: null,
        addEventListener(type, listener) {
          listeners.set(type, listener);
          if (type === 'success') queueMicrotask(listener);
        },
      };
      return request;
    },
  };

  const provider = new IndexedDbWorldContentProvider();
  try {
    const [first, second] = await Promise.all([provider.open(), provider.open()]);
    assert.equal(first, database);
    assert.equal(second, database);
    assert.equal(await provider.open(), database);
    assert.equal(openCalls, 1);

    provider.dispose();
    assert.equal(closeCalls, 1);
    assert.equal(await provider.open(), null);
  } finally {
    provider.dispose();
    if (originalIndexedDb === undefined) delete globalThis.indexedDB;
    else globalThis.indexedDB = originalIndexedDb;
  }
});
