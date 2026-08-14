import assert from 'node:assert/strict';
import test from 'node:test';

import { createInMemorySaveStore } from '../../src/sim/persistence/snapshot.js';

test('overlapping save transactions commit the payload they began with', async () => {
  const store = createInMemorySaveStore();
  const first = await store.beginSave('slot', { revision: 1 });
  const second = await store.beginSave('slot', { revision: 2 });

  assert.equal((await store.commitSave('slot', first.transactionId)).ok, true);
  assert.deepEqual((await store.load('slot')).payload, { revision: 1 });

  assert.equal((await store.commitSave('slot', second.transactionId)).ok, true);
  assert.deepEqual((await store.load('slot')).payload, { revision: 2 });
});

test('legacy slot-only commits remain FIFO under overlap', async () => {
  const store = createInMemorySaveStore();
  await store.beginSave('slot', { revision: 1 });
  await store.beginSave('slot', { revision: 2 });

  assert.equal((await store.commitSave('slot')).ok, true);
  assert.deepEqual((await store.load('slot')).payload, { revision: 1 });
  assert.equal((await store.commitSave('slot')).ok, true);
  assert.deepEqual((await store.load('slot')).payload, { revision: 2 });
});

test('concurrent save helper calls do not cross-commit payloads', async () => {
  const store = createInMemorySaveStore();
  await Promise.all([
    store.save('slot', { revision: 1 }),
    store.save('slot', { revision: 2 }),
  ]);

  assert.deepEqual((await store.load('slot')).payload, { revision: 2 });
});
