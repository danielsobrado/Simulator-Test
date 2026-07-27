import assert from 'node:assert/strict';
import test from 'node:test';
import { StylizedBuildQueue } from '../src/editor/stylized/StylizedBuildQueue.js';

function createQueue(buildsPerFrame = 4) {
  let now = 0;
  return new StylizedBuildQueue({
    buildsPerFrame,
    budgetMs: 20,
    now: () => now++,
  });
}

test('priority jobs run nearest-first while equal priorities remain stable', () => {
  const queue = createQueue();
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

test('same-priority rescheduling updates payload without duplicating work', () => {
  const queue = createQueue(1);
  assert.equal(queue.enqueue({ key: 'tree:0:0', priority: 1, revision: 1 }), true);
  assert.equal(queue.enqueue({ key: 'tree:0:0', priority: 1, revision: 2 }), false);
  assert.equal(queue.size, 1);

  let revision = null;
  queue.flush((job) => {
    revision = job.revision;
    return true;
  });
  assert.equal(revision, 2);
  assert.equal(queue.size, 0);
});

test('rescheduling can promote an existing job without duplicating it', () => {
  const queue = createQueue(2);
  queue.enqueue({ key: 'tree', priority: 4 });
  queue.enqueue({ key: 'rock', priority: 2 });
  assert.equal(queue.enqueue({ key: 'tree', priority: 1 }), true);
  assert.equal(queue.size, 2);

  const order = [];
  queue.flush((job) => {
    order.push(job.key);
    return true;
  });
  assert.deepEqual(order, ['tree', 'rock']);
});
