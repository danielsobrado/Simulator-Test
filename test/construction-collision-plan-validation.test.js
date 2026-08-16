import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConstructionCollisionSource,
} from '../src/editor/collision/providers/ConstructionCollisionSource.js';

function record(id = 'wall', revision = 1) {
  return { id, revision };
}

function box(overrides = {}) {
  return {
    id: 'segment:box',
    segmentId: 'segment',
    center: [0, 0],
    tangent: [1, 0],
    length: 2,
    thickness: 0.2,
    bottom: -0.08,
    top: 2,
    foundationOverlap: 0.08,
    bounds: { minX: -1, minZ: -0.1, maxX: 1, maxZ: 0.1 },
    openingIds: [],
    ...overrides,
  };
}

function plan(sourceRecord, overrides = {}) {
  return {
    version: 1,
    constructionId: sourceRecord.id,
    constructionRevision: sourceRecord.revision,
    bounds: { minX: -1, minZ: -0.1, maxX: 1, maxZ: 0.1 },
    boxes: [box()],
    ...overrides,
  };
}

test('collision source rejects malformed box collections before publishing them', () => {
  const source = new ConstructionCollisionSource();
  const active = record();
  const validPlan = plan(active);
  source.setActive(active);
  source.configure(16);
  assert.equal(source.applyPlan(active, validPlan), true);

  assert.throws(
    () => source.applyPlan(active, plan(active, { boxes: null })),
    /boxes must be an array/,
  );

  assert.equal(source.getPlan(active.id), validPlan);
  assert.deepEqual(source.list(0, 0), [active.id]);
});

test('collision source rejects non-finite box geometry before publishing it', () => {
  const source = new ConstructionCollisionSource();
  const active = record();
  source.setActive(active);

  assert.throws(
    () => source.applyPlan(active, plan(active, {
      boxes: [box({ center: [0, Number.POSITIVE_INFINITY] })],
    })),
    /center must contain two finite values/,
  );

  assert.equal(source.getPlan(active.id), null);
});

test('collision source rejects invalid box dimensions and vertical ranges', () => {
  const source = new ConstructionCollisionSource();
  const active = record();
  source.setActive(active);

  assert.throws(
    () => source.applyPlan(active, plan(active, { boxes: [box({ length: 0 })] })),
    /length must be positive and finite/,
  );
  assert.throws(
    () => source.applyPlan(active, plan(active, { boxes: [box({ top: 0, bottom: 1 })] })),
    /vertical range must be finite and positive/,
  );
  assert.throws(
    () => source.applyPlan(active, plan(active, { boxes: [box({ foundationOverlap: -0.01 })] })),
    /foundation overlap must be finite and non-negative/,
  );
});
