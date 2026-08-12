import assert from 'node:assert/strict';
import test from 'node:test';

import { GpuVoxelChunk } from '../src/editor/voxel/GpuVoxelChunk.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createChunk({ computeAsync = async () => {} } = {}) {
  const chunk = Object.create(GpuVoxelChunk.prototype);
  Object.assign(chunk, {
    renderer: { computeAsync },
    computeInit: 'init',
    computeDensity: 'density',
    computeSmooth: 'smooth',
    computeClassify: 'classify',
    computeEmit: 'emit',
    activeComputePromise: null,
    regenerationRequested: false,
    disposed: false,
    group: { visible: true },
  });
  return chunk;
}

test('gpu voxel chunk defers resource disposal until active compute settles', async () => {
  const firstPass = deferred();
  const calls = [];
  const chunk = createChunk({
    computeAsync(node) {
      calls.push(node);
      return node === 'init' ? firstPass.promise : Promise.resolve();
    },
  });
  let disposeCalls = 0;
  chunk.disposeGpuResources = () => {
    disposeCalls += 1;
    chunk.group = null;
  };

  const regeneration = chunk.regeneratePasses();
  await Promise.resolve();
  assert.deepEqual(calls, ['init']);

  chunk.dispose();
  assert.equal(chunk.disposed, true);
  assert.equal(chunk.group.visible, false);
  assert.equal(disposeCalls, 0);

  firstPass.resolve();
  await regeneration;

  assert.deepEqual(calls, ['init']);
  assert.equal(chunk.activeComputePromise, null);
  assert.equal(disposeCalls, 1);
});

test('gpu voxel chunk disposes immediately when no compute is active', () => {
  const chunk = createChunk();
  let disposeCalls = 0;
  chunk.disposeGpuResources = () => { disposeCalls += 1; };

  chunk.dispose();

  assert.equal(disposeCalls, 1);
  assert.equal(chunk.disposed, true);
  assert.equal(chunk.regenerationRequested, false);
});
