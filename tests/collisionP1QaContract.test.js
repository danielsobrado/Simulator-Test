import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCollisionConfig } from '../src/editor/collision/CollisionConfig.js';
import { shouldCreateCollisionRuntime } from '../src/editor/collision/CollisionRuntime.js';
import { listQaScenarios, parseQaParams } from '../src/editor/performance/qa/parseQaParams.js';

test('P1 QA is registered as a stationary broadphase scenario', () => {
  assert.equal(listQaScenarios().some((scenario) => scenario.id === 'collision-p1'), true);
  const config = parseQaParams('?qa=collision-p1&download=0');
  assert.equal(config.scenarioId, 'collision-p1');
  assert.equal(config.scenarioLabel, 'Collision P1 broadphase residency');
  assert.deepEqual(config.keys, []);
  assert.equal(config.download, false);
});

test('collision runtime stays inactive normally and activates for P1 or debug', () => {
  const collision = createCollisionConfig({});
  assert.equal(shouldCreateCollisionRuntime(collision, ''), false);
  assert.equal(shouldCreateCollisionRuntime(collision, '?qa=collision-p1'), true);
  const debug = createCollisionConfig({}, '?collisionBroadphase=1');
  assert.equal(shouldCreateCollisionRuntime(debug, ''), true);
});

test('the application loads both P0 fixture and P1 broadphase bootstraps', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /CollisionP0QaBootstrap\.js/);
  assert.match(html, /CollisionP1Bootstrap\.js/);
  const p0Bootstrap = readFileSync(
    new URL('../src/editor/collision/CollisionP0QaBootstrap.js', import.meta.url),
    'utf8',
  );
  assert.match(p0Bootstrap, /collision-p1/);
});

test('the P1 bootstrap never polls the development-only editor API in production', () => {
  const bootstrap = readFileSync(
    new URL('../src/editor/collision/CollisionP1Bootstrap.js', import.meta.url),
    'utf8',
  );
  assert.match(bootstrap, /if \(!import\.meta\.env\.DEV\) \{/);
  assert.match(bootstrap, /if \(qaMode\) publish\('unavailable'\);/);
  assert.match(
    bootstrap,
    /\} else \{[\s\S]*frameId = requestAnimationFrame\(attach\);[\s\S]*\}/,
  );
});
