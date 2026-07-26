import assert from 'node:assert/strict';
import test from 'node:test';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';

function record() {
  return {
    version: 1,
    id: 'construction-1',
    revision: 3,
    seed: 11,
    kind: 'wall',
    label: 'Planner wall',
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 4, thickness: 1 },
    path: createCubicBezierPathFromStroke([
      [0, 0],
      [10, 4],
      [25, 0],
      [36, 3],
    ], { simplifyTolerance: 0.01 }),
    features: [],
  };
}

test('construction planning emits stable bounded semantic modules', () => {
  const first = planConstruction(record(), { maxModuleLength: 8 });
  const second = planConstruction(record(), { maxModuleLength: 8 });
  assert.deepEqual(first, second);
  assert.equal(first.constructionRevision, 3);
  assert.ok(first.totalLength > 25);
  assert.ok(first.modules.length >= 4);
  assert.equal(new Set(first.modules.map(({ id }) => id)).size, first.modules.length);
  for (const module of first.modules) {
    assert.ok(module.pathInterval[1] > module.pathInterval[0]);
    assert.ok(module.bounds.maxX > module.bounds.minX);
    assert.ok(module.bounds.maxZ > module.bounds.minZ);
  }
});

test('editing one segment leaves other segment module IDs stable', () => {
  const source = record();
  const before = planConstruction(source, { maxModuleLength: 8 });
  const changed = structuredClone(source);
  changed.path.anchors[0].position[1] = -4;
  changed.revision += 1;
  const after = planConstruction(changed, { maxModuleLength: 8 });
  const lastSegmentId = source.path.segments.at(-1).id;
  assert.deepEqual(
    before.modules.filter(({ segmentId }) => segmentId === lastSegmentId).map(({ id }) => id),
    after.modules.filter(({ segmentId }) => segmentId === lastSegmentId).map(({ id }) => id),
  );
});
