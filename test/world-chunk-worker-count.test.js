import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveWorkerCount } from '../src/editor/world/WorldChunkWorkerClient.js';

test('explicit chunk worker count is bounded to production pool limits', () => {
  assert.equal(resolveWorkerCount(1), 1);
  assert.equal(resolveWorkerCount(4.9), 4);
  assert.equal(resolveWorkerCount(8), 8);
  assert.equal(resolveWorkerCount(100), 8);
});
