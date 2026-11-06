import assert from 'node:assert/strict';
import test from 'node:test';
import { Group } from 'three/webgpu';
import { SettlementPrototypePool } from '../src/editor/world/settlements/view/SettlementPrototypePool.js';

const source = { style: 'test', kind: 'house', variant: 0, surfaces: null };

test('settlement queue keeps nearest and equal-priority order without repeated sorts', () => {
  const worker = { available: false, inFlight: 0, dispose() {} };
  const pool = new SettlementPrototypePool({ root: new Group(), worker });
  let sorts = 0;
  pool.queue.sort = function (compare) { sorts++; return Array.prototype.sort.call(this, compare); };
  try {
    pool.request('far', source, 10);
    pool.request('equal-first', source, 2);
    pool.request('equal-last', source, 2);
    pool.request('middle', source, 5);
    assert.equal(pool.take(() => false), null);
    assert.equal(pool.take(() => false), null);
    assert.equal(sorts, 1, 'worker-only queues stay sorted while no work is eligible');
    assert.equal(pool.take(() => true).key, 'equal-last');
    assert.equal(pool.take(() => true).key, 'equal-first');
    assert.equal(sorts, 1);
    pool.request('far', source, 1);
    assert.equal(pool.take(() => true).key, 'far', 'a nearer request invalidates sorting');
    assert.equal(sorts, 2);
    pool.prune(key => key !== 'middle');
    assert.equal(pool.take(() => true), null, 'pruning cannot dispatch released work');
  } finally {
    pool.dispose();
  }
});

test('worker failure requeues variants in nearest order after the previous queue was sorted', async () => {
  const failures = [];
  const worker = {
    available: true, inFlight: 0, dispose() {},
    build() {
      this.inFlight++;
      return new Promise((_resolve, reject) => failures.push(reject));
    },
  };
  const pool = new SettlementPrototypePool({ root: new Group(), worker });
  try {
    pool.request('near', source, 1);
    pool.request('far', source, 10);
    pool.dispatch();
    assert.equal(failures.length, 2);
    assert.equal(pool.queue.length, 0);
    worker.available = false;
    // Return the jobs in their dispatch order, so appending alone is unsorted.
    for (const reject of failures) reject(new Error('worker stopped'));
    await Promise.resolve();
    assert.equal(pool.take(() => true).key, 'near');
    assert.equal(pool.take(() => true).key, 'far');
  } finally {
    pool.dispose();
  }
});
