import assert from 'node:assert/strict';
import test from 'node:test';
import { StylizedBuildQueue } from '../src/editor/stylized/StylizedBuildQueue.js';

test('StylizedBuildQueue exposes the live budget to a running job', () => {
  let now = 0;
  const queue = new StylizedBuildQueue({
    buildsPerFrame: 4,
    budgetMs: 3,
    now: () => now,
  });
  queue.enqueue({ key: 'first', priority: 0 });
  queue.enqueue({ key: 'second', priority: 1 });

  const visited = [];
  const result = queue.flush((job, shouldYield) => {
    visited.push(job.key);
    now = 4;
    assert.equal(shouldYield(), true);
    return true;
  });

  assert.deepEqual(visited, ['first']);
  assert.deepEqual(result, { built: 1, remaining: 1 });
});

test('StylizedBuildQueue remains compatible with one-argument jobs', () => {
  const queue = new StylizedBuildQueue({
    buildsPerFrame: 2,
    budgetMs: 3,
    now: () => 0,
  });
  queue.enqueue({ key: 'job' });

  let visited = false;
  const result = queue.flush((job) => {
    visited = job.key === 'job';
    return true;
  });

  assert.equal(visited, true);
  assert.deepEqual(result, { built: 1, remaining: 0 });
});
