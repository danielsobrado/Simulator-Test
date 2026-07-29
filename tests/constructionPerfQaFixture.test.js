import assert from 'node:assert/strict';
import test from 'node:test';
import { constructionCollisionSource } from '../src/editor/collision/providers/ConstructionCollisionSource.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { ensureConstructionPerfQaFixture } from '../src/editor/construction/ConstructionPerfQaFixture.js';
import { parseQaParams } from '../src/editor/performance/qa/parseQaParams.js';

test('construction-ring QA fixture creates a deterministic wall corridor', () => {
  constructionCollisionSource.clear();
  const store = new ConstructionStore();
  const first = ensureConstructionPerfQaFixture(store, '?qa=construction-ring');
  const second = ensureConstructionPerfQaFixture(store, '?qa=construction-ring');

  assert.equal(first.length, 12);
  assert.equal(store.size, 12);
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.map((record) => record.path.anchors[0].position[0]),
    [-36, -30, -24, -18, -12, -6, 6, 12, 18, 24, 30, 36],
  );
  assert.ok(first.every((record) => record.path.anchors[0].position[1] === -48));
  assert.ok(first.every((record) => record.path.anchors[1].position[1] === 48));
  constructionCollisionSource.clear();
});

test('construction-ring movement stays in the open center corridor', () => {
  const config = parseQaParams('?qa=construction-ring&density=dense-mixed');
  assert.equal(config.scenarioId, 'construction-ring');
  assert.equal(config.densityProfile, 'dense-mixed');
  assert.deepEqual(config.spawn, { x: 0, z: -24 });
  assert.deepEqual(config.keys, ['KeyW', 'ShiftLeft']);
});
