import assert from 'node:assert/strict';
import test from 'node:test';

import { GpuVoxelWorld } from '../src/editor/voxel/GpuVoxelWorld.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function fakeChunk(initialize) {
  return {
    initialize,
    disposeCalls: 0,
    dispose() { this.disposeCalls += 1; },
    setVisible() {},
  };
}

test('gpu voxel world does not continue initialization or subscribe after disposal', async () => {
  const firstInitialization = deferred();
  let firstCalls = 0;
  let secondCalls = 0;
  let subscriptions = 0;
  const firstChunk = fakeChunk(() => {
    firstCalls += 1;
    return firstInitialization.promise;
  });
  const secondChunk = fakeChunk(async () => { secondCalls += 1; });

  const world = Object.create(GpuVoxelWorld.prototype);
  Object.assign(world, {
    slots: [
      { key: '0:0', chunk: firstChunk },
      { key: '1:0', chunk: secondChunk },
    ],
    stampStore: {
      subscribe() {
        subscriptions += 1;
        return () => {};
      },
    },
    visible: true,
    initialized: false,
    disposed: false,
    pendingFocusWorld: null,
    unsubscribeStamps: null,
    updateAssignments() {},
    positionSlot() {},
    getStatus: () => Object.freeze({ ready: false }),
  });

  const initialization = world.initialize();
  await Promise.resolve();
  world.dispose();
  firstInitialization.resolve();
  await initialization;

  assert.equal(firstCalls, 1);
  assert.equal(secondCalls, 0);
  assert.equal(subscriptions, 0);
  assert.equal(world.initialized, false);
  assert.equal(firstChunk.disposeCalls, 1);
  assert.equal(secondChunk.disposeCalls, 1);
});
