import assert from 'node:assert/strict';
import test from 'node:test';

import { loadWorldDocument } from '../src/editor/WorldDocument.js';

function createObjectMap() {
  let objects = [{ id: 'old-object' }];
  return {
    toDocument: () => structuredClone(objects),
    loadDocument(next) { objects = structuredClone(next); },
    replaceAll(next) { objects = structuredClone(next); },
    list: () => structuredClone(objects),
  };
}

test('world document rollback prefers lightweight transaction snapshots', () => {
  const marker = { id: 'old-world' };
  let restored = null;
  const worldStore = {
    createTransactionSnapshot() { return marker; },
    restoreTransactionSnapshot(snapshot) { restored = snapshot; },
    createSnapshot() { throw new Error('full snapshot should not be used'); },
    loadDocument() {},
  };
  const objectMap = createObjectMap();

  assert.throws(
    () => loadWorldDocument(
      { version: 6, objects: [{ id: 'new-object' }] },
      { worldStore },
      objectMap,
      null,
      null,
      () => { throw new Error('validation failed'); },
    ),
    /validation failed/,
  );

  assert.equal(restored, marker);
  assert.deepEqual(objectMap.list(), [{ id: 'old-object' }]);
});

test('world document rollback retains the generic snapshot fallback', () => {
  const marker = { id: 'generic-world' };
  let restored = null;
  const worldStore = {
    createSnapshot() { return marker; },
    restoreSnapshot(snapshot) { restored = snapshot; },
    loadDocument() { throw new Error('load failed'); },
  };
  const objectMap = createObjectMap();

  assert.throws(
    () => loadWorldDocument({ version: 6 }, { worldStore }, objectMap),
    /load failed/,
  );
  assert.equal(restored, marker);
});
