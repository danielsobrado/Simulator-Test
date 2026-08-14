import assert from 'node:assert/strict';
import test from 'node:test';

import {
  installBfcacheRecovery,
  recoverFromBackForwardCache,
} from '../src/editor/lifecycle/BfcacheRecovery.js';

test('BFCache recovery reloads only persisted page restores', () => {
  let reloads = 0;
  const locationValue = { reload: () => { reloads += 1; } };

  assert.equal(recoverFromBackForwardCache({ persisted: false }, locationValue), false);
  assert.equal(reloads, 0);
  assert.equal(recoverFromBackForwardCache({ persisted: true }, locationValue), true);
  assert.equal(reloads, 1);
});

test('BFCache recovery installation can be disposed', () => {
  const listeners = new Map();
  const target = {
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type, listener) {
      if (listeners.get(type) === listener) listeners.delete(type);
    },
  };
  let reloads = 0;
  const dispose = installBfcacheRecovery({
    target,
    locationValue: { reload: () => { reloads += 1; } },
  });

  listeners.get('pageshow')({ persisted: true });
  assert.equal(reloads, 1);
  dispose();
  assert.equal(listeners.has('pageshow'), false);
});
