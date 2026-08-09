import assert from 'node:assert/strict';
import test from 'node:test';

import { InventoryController } from '../src/editor/inventory/InventoryController.js';

function createConsumableStore() {
  const token = Object.freeze({ operationId: 'op-1' });
  const calls = [];
  const store = {
    catalog: {
      get: (itemKey) => (itemKey === 'healing-potion'
        ? { category: 'consumable', equipmentSlots: [] }
        : null),
    },
    subscribe: () => () => {},
    getState: () => ({
      bagSlots: [{ itemKey: 'healing-potion', quantity: 2 }],
    }),
    useItem: (location) => {
      calls.push(['use', location]);
      return { ok: true, pending: true, token };
    },
    confirmUse: (stagedToken) => {
      calls.push(['confirm', stagedToken]);
      return { ok: true };
    },
  };
  return { calls, store, token };
}

test('double-activating a consumable confirms the staged use', () => {
  const { calls, store, token } = createConsumableStore();
  const controller = new InventoryController({ store });
  const location = Object.freeze({ kind: 'bag', index: 0 });

  const result = controller.doubleActivate(location);

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls, [
    ['use', location],
    ['confirm', token],
  ]);
});
