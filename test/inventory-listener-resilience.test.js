import assert from 'node:assert/strict';
import test from 'node:test';

import { InventoryStore } from '../src/editor/inventory/InventoryStore.js';
import { ItemCatalog } from '../src/editor/inventory/ItemCatalog.js';

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

test('inventory listener failures do not make committed mutations look failed', async () => {
  await withCapturedErrors(async (errors) => {
    const store = new InventoryStore(new ItemCatalog(new Map()));
    const observed = [];
    store.subscribe(() => { throw new Error('inventory panel failed'); });
    store.subscribe((change) => observed.push(change));

    const result = store.setGold(25);

    assert.equal(result.ok, true);
    assert.equal(store.getState().currency.gold, 25);
    assert.equal(observed.length, 1);
    assert.equal(observed[0].kind, 'currency');
    assert.equal(errors.length, 1);
  });
});
