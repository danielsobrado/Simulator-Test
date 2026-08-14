import assert from 'node:assert/strict';
import test from 'node:test';

import {
  registerCollisionConfig,
  registerCollisionPlayer,
  subscribeCollisionComposition,
} from '../src/editor/collision/CollisionPlayerBridge.js';

test('collision composition isolates failing subscribers', () => {
  const originalError = console.error;
  const received = [];
  console.error = () => {};

  registerCollisionConfig({ constructions: {} });
  const unsubscribeFailing = subscribeCollisionComposition(() => {
    throw new Error('listener failed');
  });
  const unsubscribeHealthy = subscribeCollisionComposition((value) => {
    received.push(value);
  });

  let releasePlayer = null;
  try {
    assert.doesNotThrow(() => {
      releasePlayer = registerCollisionPlayer({ id: 'player' });
    });
    assert.equal(received.length, 1);
    assert.equal(received[0].player.id, 'player');
  } finally {
    releasePlayer?.();
    unsubscribeHealthy();
    unsubscribeFailing();
    console.error = originalError;
  }
});
