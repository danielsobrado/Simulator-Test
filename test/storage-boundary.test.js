import assert from 'node:assert/strict';
import test from 'node:test';

import {
  listBrowserDocuments,
  loadFromBrowser,
  parseDocument,
  saveToBrowser,
} from '../src/editor/storage.js';

function installBrowserStorage({ indexedDbOpenError = null } = {}) {
  const originalIndexedDb = globalThis.indexedDB;
  const originalLocalStorage = globalThis.localStorage;
  const originalWarn = console.warn;
  const values = new Map();

  globalThis.indexedDB = {
    open() {
      if (indexedDbOpenError) throw indexedDbOpenError;
      throw new Error('Unexpected IndexedDB open in test.');
    },
  };
  globalThis.localStorage = {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
  console.warn = () => {};

  return {
    values,
    restore() {
      if (originalIndexedDb === undefined) delete globalThis.indexedDB;
      else globalThis.indexedDB = originalIndexedDb;
      if (originalLocalStorage === undefined) delete globalThis.localStorage;
      else globalThis.localStorage = originalLocalStorage;
      console.warn = originalWarn;
    },
  };
}

test('parseDocument rejects JSON arrays as map documents', () => {
  assert.throws(() => parseDocument('[]'), /not a valid map document/);
});

test('browser storage falls back when IndexedDB exists but cannot open', async () => {
  const storage = installBrowserStorage({ indexedDbOpenError: new Error('blocked') });
  try {
    await saveToBrowser('world:a', { version: 6, name: 'A' });
    assert.deepEqual(await loadFromBrowser('world:a'), { version: 6, name: 'A' });
    assert.deepEqual(await listBrowserDocuments('world:'), [
      { key: 'world:a', document: { version: 6, name: 'A' } },
    ]);
  } finally {
    storage.restore();
  }
});

test('browser reads do not report missing data when IndexedDB itself failed', async () => {
  const storage = installBrowserStorage({ indexedDbOpenError: new Error('blocked') });
  try {
    await assert.rejects(
      loadFromBrowser('world:missing'),
      /Unable to load the browser document/,
    );
    await assert.rejects(
      listBrowserDocuments('world:'),
      /Unable to list browser documents/,
    );
  } finally {
    storage.restore();
  }
});
