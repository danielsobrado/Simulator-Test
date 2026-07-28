import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQaParams } from '../src/editor/performance/qa/parseQaParams.js';

test('P8 QA uses a settled twelve-second production collision run', () => {
  const config = parseQaParams('?qa=collision-p8&download=0');

  assert.equal(config.scenarioId, 'collision-p8');
  assert.equal(config.scenarioLabel, 'Collision P8 streaming and performance gate');
  assert.equal(config.warmupSeconds, 10);
  assert.equal(config.durationSeconds, 12);
  assert.equal(config.speed, 'run');
  assert.equal(config.running, true);
  assert.deepEqual(config.keys, ['KeyW', 'ShiftLeft']);
  assert.equal(config.download, false);
});
