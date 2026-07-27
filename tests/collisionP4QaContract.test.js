import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQaParams } from '../src/editor/performance/qa/parseQaParams.js';
import { shouldCreateCollisionRuntime } from '../src/editor/collision/CollisionRuntime.js';

const disabledConfig = Object.freeze({
  enabled: false,
  debug: Object.freeze({
    colliders: false,
    broadphase: false,
    support: false,
    contacts: false,
  }),
});

test('collision-p4 activates runtime and production movement QA', () => {
  const config = parseQaParams('?qa=collision-p4&download=0');
  assert.equal(config.scenarioId, 'collision-p4');
  assert.equal(config.warmupSeconds, 8);
  assert.equal(config.durationSeconds, 4);
  assert.deepEqual(config.keys, ['KeyW', 'ShiftLeft']);
  assert.equal(shouldCreateCollisionRuntime(disabledConfig, '?qa=collision-p4'), true);
});
