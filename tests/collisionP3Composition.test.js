import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createCollisionConfig } from '../src/editor/collision/CollisionConfig.js';
import { shouldCreateCollisionRuntime } from '../src/editor/collision/CollisionRuntime.js';
import { listQaScenarios, parseQaParams } from '../src/editor/performance/qa/parseQaParams.js';

test('P3 QA is registered as a production tree-trunk route', () => {
  assert.equal(listQaScenarios().some((scenario) => scenario.id === 'collision-p3'), true);
  const config = parseQaParams('?qa=collision-p3&download=0');
  assert.equal(config.scenarioId, 'collision-p3');
  assert.equal(config.scenarioLabel, 'Collision P3 production tree trunk');
  assert.deepEqual(config.keys, ['KeyW', 'ShiftLeft']);
  assert.equal(config.download, false);
});

test('P3 runtime activation includes QA and enabled production configuration', () => {
  assert.equal(
    shouldCreateCollisionRuntime(createCollisionConfig({}), '?qa=collision-p3'),
    true,
  );
  assert.equal(
    shouldCreateCollisionRuntime(createCollisionConfig({ enabled: true }), ''),
    true,
  );
});

test('production configuration enables tree collision and keeps overrides explicit', () => {
  const yaml = readFileSync(new URL('../config/collision.yaml', import.meta.url), 'utf8');
  assert.match(yaml, /^enabled: true$/m);
  assert.match(yaml, /^trees:\n  enabled: true\n  minimumTrunkRadius:/m);
  assert.match(yaml, /^  prototypeOverrides: \{\}$/m);
});

test('stylized trees publish manifests and the unified bootstrap waits for them', () => {
  const surface = readFileSync(
    new URL('../src/editor/stylized/StylizedSurfaceView.js', import.meta.url),
    'utf8',
  );
  assert.match(surface, /registerCollisionTreeSource/);
  assert.match(surface, /treeView: this\.treeView/);
  assert.match(surface, /releaseCollisionTreeSource/);

  const bootstrap = readFileSync(
    new URL('../src/editor/collision/CollisionP2Bootstrap.js', import.meta.url),
    'utf8',
  );
  assert.match(bootstrap, /collision-p3/);
  assert.match(bootstrap, /waiting-trees/);
  assert.match(bootstrap, /treeSource/);
  assert.match(bootstrap, /window\.__collisionP3Qa/);
});
