import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveMaxInFlightPerWorker,
  resolveWorkerCount,
} from '../src/editor/world/WorldChunkWorkerClient.js';

test('explicit chunk worker count is bounded to production pool limits', () => {
  assert.equal(resolveWorkerCount(1), 1);
  assert.equal(resolveWorkerCount(4.9), 4);
  assert.equal(resolveWorkerCount(8), 8);
  assert.equal(resolveWorkerCount(100), 8);
});

test('automatic chunk worker count leaves capacity for the main thread', () => {
  assert.equal(resolveWorkerCount(null, 1), 1);
  assert.equal(resolveWorkerCount(null, 2), 1);
  assert.equal(resolveWorkerCount(null, 4), 3);
  assert.equal(resolveWorkerCount(null, 16), 8);
  assert.equal(resolveWorkerCount(null, Number.NaN), 3);
});

test('chunk worker concurrency rejects invalid values that would stall dispatch', () => {
  assert.equal(resolveMaxInFlightPerWorker(Number.NaN), 1);
  assert.equal(resolveMaxInFlightPerWorker(Number.POSITIVE_INFINITY), 1);
  assert.equal(resolveMaxInFlightPerWorker(0), 1);
  assert.equal(resolveMaxInFlightPerWorker(-2), 1);
  assert.equal(resolveMaxInFlightPerWorker(3.9), 3);
});
