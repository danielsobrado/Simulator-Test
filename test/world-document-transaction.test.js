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

function createVoxelStore() {
  let stamps = [{ id: 'old-stamp' }];
  return {
    toDocument: () => structuredClone(stamps),
    loadDocument(next) { stamps = structuredClone(next); },
    replaceAll(next) { stamps = structuredClone(next); },
    list: () => structuredClone(stamps),
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

test('object and voxel rollback still run when world rollback fails', () => {
  const objectMap = createObjectMap();
  const voxelStore = createVoxelStore();
  let worldRestoreAttempts = 0;
  const worldStore = {
    createTransactionSnapshot() { return { id: 'old-world' }; },
    restoreTransactionSnapshot() {
      worldRestoreAttempts += 1;
      throw new Error('world restore failed');
    },
    loadDocument() {},
  };

  let thrown = null;
  try {
    loadWorldDocument(
      {
        version: 6,
        objects: [{ id: 'new-object' }],
        voxelStamps: [{ id: 'new-stamp' }],
      },
      { worldStore },
      null,
      objectMap,
      voxelStore,
      () => { throw new Error('validation failed'); },
    );
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof AggregateError);
  assert.match(thrown.message, /rollback was incomplete/);
  assert.deepEqual(thrown.errors.map((error) => error.message), [
    'validation failed',
    'world restore failed',
  ]);
  assert.equal(worldRestoreAttempts, 1);
  assert.deepEqual(objectMap.list(), [{ id: 'old-object' }]);
  assert.deepEqual(voxelStore.list(), [{ id: 'old-stamp' }]);
});
