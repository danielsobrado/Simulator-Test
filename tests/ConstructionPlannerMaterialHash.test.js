import assert from 'node:assert/strict';
import test from 'node:test';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';

function record(materials = {}) {
  return {
    version: 1,
    id: 'construction-material-hash',
    revision: 1,
    seed: 41,
    kind: 'wall',
    style: { key: 'soft-limestone-rubble', version: 1, materials },
    dimensions: { height: 3.5, thickness: 0.8 },
    path: createCubicBezierPathFromStroke([
      [0, 0],
      [10, 3],
      [24, 0],
      [38, 4],
    ], { simplifyTolerance: 0.01 }),
    features: [],
  };
}

function hashes(plan) {
  return plan.modules.map(({ id, contentHash }) => [id, contentHash]);
}

test('material changes do not alter geometry hashes', () => {
  const before = planConstruction(record(), { maxModuleLength: 8 });
  const painted = planConstruction(record({
    stone: 'granite-masonry',
    mortar: 'limestone-masonry',
    roof: null,
  }), { maxModuleLength: 8 });

  assert.equal(painted.contentHash, before.contentHash);
  assert.deepEqual(hashes(painted), hashes(before));
  assert.deepEqual(
    painted.modules.map(({ placements }) => placements),
    before.modules.map(({ placements }) => placements),
  );
});

test('painting before a local edit does not invalidate unrelated modules', () => {
  const source = record({ stone: 'granite-masonry' });
  const before = planConstruction(source, { maxModuleLength: 8 });
  const changed = structuredClone(source);
  changed.path.anchors[0].position[1] = -4;
  changed.revision += 1;
  const after = planConstruction(changed, { maxModuleLength: 8 });

  const beforeHashes = new Map(hashes(before));
  const segmentOf = new Map(before.modules.map(({ id, segmentId }) => [id, segmentId]));
  const reachable = new Set(source.path.segments.slice(0, 2).map(({ id }) => id));
  let changedCount = 0;

  for (const module of after.modules) {
    if (module.contentHash === beforeHashes.get(module.id)) continue;
    changedCount += 1;
    assert.ok(
      reachable.has(segmentOf.get(module.id)),
      `material state widened the edit to unrelated module ${module.id}`,
    );
  }
  assert.ok(changedCount > 0);
});
