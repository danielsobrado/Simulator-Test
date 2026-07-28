import assert from 'node:assert/strict';
import test from 'node:test';
import { collisionQaDebugConfig } from '../src/editor/collision/CollisionRuntime.js';

const DEBUG_DISABLED = Object.freeze({
  colliders: false,
  broadphase: false,
  contacts: false,
  support: false,
});
const DEBUG_VISUAL = Object.freeze({
  colliders: true,
  broadphase: true,
  contacts: false,
  support: false,
});

test('headless collision QA preserves production debug settings', () => {
  assert.equal(collisionQaDebugConfig(DEBUG_DISABLED), DEBUG_DISABLED);
});

test('headed collision QA preserves explicit visual debug settings', () => {
  assert.equal(collisionQaDebugConfig(DEBUG_VISUAL), DEBUG_VISUAL);
});
