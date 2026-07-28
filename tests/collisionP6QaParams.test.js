import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQaParams } from '../src/editor/performance/qa/parseQaParams.js';

test('collision P6 walks through the doorway and stops before the rear wall', () => {
  const config = parseQaParams('?qa=collision-p6&download=0');

  assert.equal(config.scenarioId, 'collision-p6');
  assert.equal(config.speed, 'walk');
  assert.equal(config.running, false);
  assert.equal(config.durationSeconds, 0.5);
  assert.deepEqual(config.keys, ['KeyW']);
  assert.equal(config.download, false);
});
