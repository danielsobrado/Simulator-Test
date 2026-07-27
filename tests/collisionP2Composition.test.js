import assert from 'node:assert/strict';
import test from 'node:test';
import {
  registerCollisionConfig,
  registerCollisionPlayer,
  subscribeCollisionComposition,
} from '../src/editor/collision/CollisionPlayerBridge.js';

test('collision composition waits for and publishes the shared config and player', () => {
  const seen = [];
  const collisionConfig = Object.freeze({ enabled: false });
  const player = Object.freeze({ id: 'player' });
  registerCollisionConfig(collisionConfig);
  const unsubscribe = subscribeCollisionComposition((value) => seen.push(value));
  assert.equal(seen.length, 0);
  const release = registerCollisionPlayer(player);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].player, player);
  assert.equal(seen[0].collisionConfig, collisionConfig);
  assert.equal(Object.isFrozen(seen[0]), true);
  release();
  unsubscribe();
});
