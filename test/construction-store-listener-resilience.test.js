import assert from 'node:assert/strict';
import test from 'node:test';

import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';

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

test('construction listener failures do not make committed changes look failed', async () => {
  await withCapturedErrors(async (errors) => {
    const store = new ConstructionStore();
    const observed = [];
    store.subscribe(() => { throw new Error('construction view failed'); });
    store.subscribe((change) => observed.push(change));

    store.replaceAll([]);

    assert.equal(store.size, 0);
    assert.equal(observed.length, 1);
    assert.equal(observed[0].kind, 'replace');
    assert.equal(errors.length, 1);
  });
});
