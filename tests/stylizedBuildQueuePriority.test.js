import assert from 'node:assert/strict';
import test from 'node:test';
import { StylizedBuildQueue } from '../src/editor/stylized/StylizedBuildQueue.js';

test('priority jobs run nearest-first while equal priorities remain stable', () => {
  let now = 0;
  const queue = new StylizedBuildQueue({
    buildsPerFrame: 4,
    budgetMs: 10,
    now: () => now++,
  });
  queue.enqueue({ key: 'far', priority: 4 });
  queue.enqueue({ key: 'near-a', priority: 1 });
  queue.enqueue({ key: 'near-b', priority: 1 });
  queue.enqueue({ key: 'middle', priority: 2 });
  const order = [];
  queue.flush((job) => {
    order.push(job.key);
    return true;
  });
  assert.deepEqual(order, ['near-a', 'near-b', 'middle', 'far']);
});
