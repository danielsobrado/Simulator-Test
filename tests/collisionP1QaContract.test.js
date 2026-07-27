import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCollisionConfig } from '../src/editor/collision/CollisionConfig.js';
import { shouldCreateCollisionRuntime } from '../src/editor/collision/CollisionRuntime.js';
import { listQaScenarios, parseQaParams } from '../src/editor/performance/qa/parseQaParams.js';

test('P1 QA remains registered as a stationary broadphase scenario', () => {
  assert.equal(listQaScenarios().some((scenario) => scenario.id === 'collision-p1'), true);
  const config = parseQaParams('?qa=collision-p1&download=0');
  assert.equal(config.scenarioId, 'collision-p1');
  assert.equal(config.scenarioLabel, 'Collision P1 broadphase residency');
  assert.deepEqual(config.keys, []);
  assert.equal(config.download, false);
});

test('P2 QA drives the wall-stop fixture with deterministic defaults', () => {
  assert.equal(listQaScenarios().some((scenario) => scenario.id === 'collision-p2'), true);
  const config = parseQaParams('?qa=collision-p2&download=0');
  assert.equal(config.scenarioId, 'collision-p2');
  assert.equal(config.scenarioLabel, 'Collision P2 wall-stop motor');
  assert.deepEqual(config.spawn, { x: 8, z: -14 });
  assert.deepEqual(config.keys, ['KeyW', 'ShiftLeft']);
  assert.equal(config.download, false);
});

test('collision runtime stays inactive normally and activates for P1, P2, or debug', () => {
  const collision = createCollisionConfig({});
  assert.equal(shouldCreateCollisionRuntime(collision, ''), false);
  assert.equal(shouldCreateCollisionRuntime(collision, '?qa=collision-p1'), true);
  assert.equal(shouldCreateCollisionRuntime(collision, '?qa=collision-p2'), true);
  const debug = createCollisionConfig({}, '?collisionBroadphase=1');
  assert.equal(shouldCreateCollisionRuntime(debug, ''), true);
});

test('the application loads the visual fixture and unified P2 runtime bootstrap', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /CollisionP0QaBootstrap\.js/);
  assert.match(html, /CollisionP2Bootstrap\.js/);
  assert.doesNotMatch(html, /CollisionP1Bootstrap\.js/);

  const visualBootstrap = readFileSync(
    new URL('../src/editor/collision/CollisionP0QaBootstrap.js', import.meta.url),
    'utf8',
  );
  assert.match(visualBootstrap, /collision-p2/);

  const runtimeBootstrap = readFileSync(
    new URL('../src/editor/collision/CollisionP2Bootstrap.js', import.meta.url),
    'utf8',
  );
  assert.match(runtimeBootstrap, /subscribeCollisionComposition/);
  assert.match(runtimeBootstrap, /player\.attachCollision/);
  assert.doesNotMatch(runtimeBootstrap, /yaml|collisionConfigSource/);
  assert.doesNotMatch(runtimeBootstrap, /window\.__editor[\s\S]*requestAnimationFrame\(attach\)/);
});
