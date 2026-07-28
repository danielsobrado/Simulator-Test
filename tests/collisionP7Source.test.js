import assert from 'node:assert/strict';
import test from 'node:test';
import { ConstructionCollisionSource } from '../src/editor/collision/providers/ConstructionCollisionSource.js';
import { compileConstructionCollision } from '../src/editor/construction/compile/ConstructionCollisionCompiler.js';
import { sampleCubicBezierPath } from '../src/editor/construction/curve/CubicBezierPath.js';
import { straightConstruction } from './helpers/constructionCollisionFixtures.js';

function collisionPlan(record) {
  return compileConstructionCollision(record, sampleCubicBezierPath(record.path));
}

test('construction edits keep old collision until the matching revision is ready', () => {
  const source = new ConstructionCollisionSource().configure(128);
  const first = straightConstruction({ id: 'construction-atomic', revision: 1 });
  const second = straightConstruction({
    id: first.id,
    revision: 2,
    start: [130, 0],
    end: [146, 0],
  });
  source.setActive(first);
  assert.equal(source.applyPlan(first, collisionPlan(first)), true);
  const firstPlan = source.getPlan(first.id);
  assert.deepEqual(source.list(0, 0), [first.id]);

  source.setActive(second);
  assert.equal(source.getPlan(first.id), firstPlan);
  assert.deepEqual(source.list(0, 0), [first.id]);
  assert.equal(source.getStatus().stalePlans, 1);

  assert.equal(source.applyPlan(second, collisionPlan(second)), true);
  assert.equal(source.getPlan(first.id).constructionRevision, 2);
  assert.deepEqual(source.list(0, 0), []);
  assert.deepEqual(source.list(1, 0), [first.id]);
  assert.ok(source.signature(0, 0) > 0);
  assert.ok(source.signature(1, 0) > 0);
  assert.equal(source.getStatus().stalePlans, 0);
});

test('construction deletion removes collision and rejects a late worker plan', () => {
  const source = new ConstructionCollisionSource().configure(128);
  const record = straightConstruction({ id: 'construction-delete' });
  const plan = collisionPlan(record);
  source.setActive(record);
  source.applyPlan(record, plan);

  assert.equal(source.remove(record.id), true);
  assert.equal(source.getPlan(record.id), null);
  assert.deepEqual(source.list(0, 0), []);
  assert.equal(source.applyPlan(record, plan), false);
  assert.equal(source.getStatus().rejectedPlans, 1);
});

test('construction collision source validates and retains registered configuration', () => {
  const source = new ConstructionCollisionSource();
  assert.deepEqual(source.getConfig(), { curveSegmentLength: 1.25 });
  assert.deepEqual(source.setConfig({ curveSegmentLength: 0.75 }), { curveSegmentLength: 0.75 });
  assert.throws(() => source.setConfig({ curveSegmentLength: 0 }), /must be positive/);
});
