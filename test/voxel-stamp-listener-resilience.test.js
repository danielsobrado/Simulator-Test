import assert from 'node:assert/strict';
import test from 'node:test';

import { VoxelStampStore } from '../src/editor/voxel/VoxelStampStore.js';

async function withCapturedErrors(run) {
  const originalError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args);
  try {
    await run(errors);
  } finally {
    console.error = originalError;
  }
}

test('voxel listener failures do not make committed stamps look failed', async () => {
  await withCapturedErrors(async (errors) => {
    const store = new VoxelStampStore({ cells: [16, 16, 16], maxStamps: 8 });
    const observed = [];
    store.subscribe(() => { throw new Error('voxel view failed'); });
    store.subscribe((snapshot) => observed.push(snapshot));

    const stamp = store.add({
      operation: 'add',
      center: [8, 8, 8],
      radius: 2,
      strength: 1,
      smoothness: 1,
    });

    assert.equal(stamp.id, 1);
    assert.equal(store.size, 1);
    assert.equal(observed.length, 1);
    assert.equal(observed[0].length, 1);
    assert.equal(errors.length, 1);
  });
});
