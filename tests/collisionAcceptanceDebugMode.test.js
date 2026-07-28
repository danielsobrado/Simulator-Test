import assert from 'node:assert/strict';
import test from 'node:test';
import { collisionQaDebugConfig } from '../src/editor/collision/CollisionRuntime.js';

const DEBUG_DISABLED = Object.freeze({
  colliders: false,
  broadphase: false,
  contacts: false,
  support: false,
});

test('P8 performance QA preserves production debug settings', () => {
  assert.equal(collisionQaDebugConfig(DEBUG_DISABLED, 'collision-p8'), DEBUG_DISABLED);
});

test('headed collision fixtures force collider and broadphase debug views', () => {
  const debug = collisionQaDebugConfig(DEBUG_DISABLED, 'collision-p5');

  assert.notEqual(debug, DEBUG_DISABLED);
  assert.equal(debug.colliders, true);
  assert.equal(debug.broadphase, true);
  assert.equal(debug.contacts, false);
  assert.equal(debug.support, false);
});

test('normal gameplay preserves configured debug settings', () => {
  assert.equal(collisionQaDebugConfig(DEBUG_DISABLED, null), DEBUG_DISABLED);
});
