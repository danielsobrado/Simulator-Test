import assert from 'node:assert/strict';
import test from 'node:test';
import { listQaScenarios, parseQaParams } from '../src/editor/performance/qa/parseQaParams.js';

test('collision P0 is a registered stationary QA scenario', () => {
  const scenarios = listQaScenarios();
  assert.equal(scenarios.some((scenario) => scenario.id === 'collision-p0'), true);

  const config = parseQaParams('?qa=collision-p0&download=0');
  assert.equal(config.scenarioId, 'collision-p0');
  assert.equal(config.scenarioLabel, 'Collision P0 fixture baseline');
  assert.equal(config.speed, 'walk');
  assert.equal(config.running, false);
  assert.deepEqual(config.keys, []);
  assert.equal(config.warmupSeconds, 2);
  assert.equal(config.durationSeconds, 1);
  assert.equal(config.download, false);
});
