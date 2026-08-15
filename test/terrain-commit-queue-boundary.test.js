import assert from 'node:assert/strict';
import test from 'node:test';

import { TerrainCommitQueue } from '../src/editor/world/TerrainCommitQueue.js';

function createJob(slotIndex) {
  return {
    slot: { slotIndex },
    priority: 0,
    enqueuedAt: 0,
  };
}

test('terrain commit queue rejects malformed configured limits', () => {
  for (const maxCommitsPerFrame of [Number.NaN, Infinity, -1, 1.5]) {
    assert.throws(
      () => new TerrainCommitQueue({ maxCommitsPerFrame }),
      /commit limit/,
    );
  }
  for (const commitBudgetMs of [Number.NaN, Infinity, -1]) {
    assert.throws(
      () => new TerrainCommitQueue({ commitBudgetMs }),
      /commit budget/,
    );
  }
});

test('terrain commit queue rejects malformed per-flush limits', () => {
  const queue = new TerrainCommitQueue({ now: () => 0 });
  queue.enqueue(createJob(0));

  assert.throws(() => queue.flush(() => {}, null, { maxCommits: Number.NaN }), /commit limit/);
  assert.throws(() => queue.flush(() => {}, null, { budgetMs: Number.NaN }), /commit budget/);
  assert.equal(queue.size, 1);
});

test('terrain commit drain keeps its intentional unbounded limits', () => {
  const queue = new TerrainCommitQueue({ now: () => 0 });
  queue.enqueue(createJob(0));
  queue.enqueue(createJob(1));
  let committed = 0;

  const result = queue.drain(() => { committed += 1; });

  assert.equal(committed, 2);
  assert.equal(result.remaining, 0);
});
