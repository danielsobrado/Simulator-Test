import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureCollisionP7QaFixture } from '../src/editor/collision/CollisionP7QaFixture.js';
import { constructionCollisionSource } from '../src/editor/collision/providers/ConstructionCollisionSource.js';
import { ConstructionStore } from '../src/editor/construction/ConstructionStore.js';
import { ConstructionCompilerClient } from '../src/editor/construction/compile/ConstructionCompilerClient.js';
import { parseQaParams } from '../src/editor/performance/qa/parseQaParams.js';
import { straightConstruction } from './helpers/constructionCollisionFixtures.js';

function colliderIds(plan) {
  return plan.collision.boxes.map((box) => `construction:${plan.constructionId}:${box.id}`);
}

test('construction compiler publishes the matching collision plan independently', async () => {
  constructionCollisionSource.clear();
  constructionCollisionSource.setConfig({ curveSegmentLength: 0.75 });
  const record = straightConstruction({ id: 'construction-compile' });
  const store = new ConstructionStore([record]);
  const compiler = new ConstructionCompilerClient();
  try {
    const plan = await compiler.compile(store.get(record.id), { masonry: false });
    assert.equal(plan.constructionRevision, record.revision);
    assert.equal(plan.collision.constructionRevision, record.revision);
    assert.equal(
      constructionCollisionSource.getPlan(record.id).signature,
      plan.collision.signature,
    );
    assert.deepEqual(constructionCollisionSource.getConfig(), { curveSegmentLength: 0.75 });
  } finally {
    compiler.dispose();
    constructionCollisionSource.clear();
  }
});

test('construction undo and save/load restore collider geometry and IDs', async () => {
  constructionCollisionSource.clear();
  constructionCollisionSource.setConfig({ curveSegmentLength: 1.25 });
  const record = straightConstruction({ id: 'construction-persistence' });
  const store = new ConstructionStore([record]);
  const compiler = new ConstructionCompilerClient();
  try {
    const initial = await compiler.compile(store.get(record.id), { masonry: false });
    const before = store.get(record.id);
    const after = store.update(record.id, {
      ...before,
      dimensions: { ...before.dimensions, thickness: 1.2 },
    });
    const edited = await compiler.compile(after, { masonry: false });
    assert.notEqual(edited.collision.signature, initial.collision.signature);

    store.applyChange({ before, after }, 'undo');
    const undone = await compiler.compile(store.get(record.id), { masonry: false });
    assert.equal(undone.collision.signature, initial.collision.signature);
    assert.deepEqual(colliderIds(undone), colliderIds(initial));

    const document = store.toDocument();
    const loadedStore = new ConstructionStore(document);
    const loaded = await compiler.compile(loadedStore.get(record.id), { masonry: false });
    assert.equal(loaded.collision.signature, initial.collision.signature);
    assert.deepEqual(colliderIds(loaded), colliderIds(initial));
  } finally {
    compiler.dispose();
    constructionCollisionSource.clear();
  }
});

test('P7 QA fixture is deterministic and survives repeated enforcement', () => {
  constructionCollisionSource.clear();
  const store = new ConstructionStore();
  const first = ensureCollisionP7QaFixture(store, '?qa=collision-p7');
  const second = ensureCollisionP7QaFixture(store, '?qa=collision-p7');

  assert.equal(first.id, 'collision-p7-wall');
  assert.deepEqual(second, first);
  assert.equal(store.size, 1);
  assert.equal(first.path.anchors[0].position[1], 0);
  assert.equal(first.path.anchors[1].position[1], 0);
  constructionCollisionSource.clear();
});

test('P7 movement QA runs directly into the compiled wall', () => {
  const config = parseQaParams('?qa=collision-p7&download=0');

  assert.equal(config.scenarioId, 'collision-p7');
  assert.equal(config.speed, 'run');
  assert.equal(config.running, true);
  assert.equal(config.durationSeconds, 1.2);
  assert.deepEqual(config.keys, ['KeyW', 'ShiftLeft']);
  assert.equal(config.download, false);
});
