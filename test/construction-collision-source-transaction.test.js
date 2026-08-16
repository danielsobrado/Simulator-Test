import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ConstructionCollisionSource,
} from '../src/editor/collision/providers/ConstructionCollisionSource.js';

function record(id, revision = 1) {
  return { id, revision };
}

function plan(id, revision = 1, bounds = { minX: 0, minZ: 0, maxX: 1, maxZ: 1 }) {
  return {
    version: 1,
    constructionId: id,
    constructionRevision: revision,
    bounds,
    boxes: [],
  };
}

test('replaceActive validates the full replacement before changing live state', () => {
  const source = new ConstructionCollisionSource();
  const existing = record('existing');
  source.setActive(existing);

  assert.throws(
    () => source.replaceActive([record('next'), { id: 'invalid', revision: 1.5 }]),
    /active record revision/,
  );

  assert.equal(source.applyPlan(existing, plan(existing.id)), true);
  assert.equal(source.getPlan(existing.id)?.constructionId, existing.id);
});

test('invalid compiled plan cannot replace the last valid collision plan', () => {
  const source = new ConstructionCollisionSource();
  const active = record('wall');
  const validPlan = plan(active.id);
  source.setActive(active);
  source.configure(16);
  assert.equal(source.applyPlan(active, validPlan), true);

  assert.throws(
    () => source.applyPlan(active, plan(active.id, 1, {
      minX: 0,
      minZ: 0,
      maxX: Number.POSITIVE_INFINITY,
      maxZ: 1,
    })),
    /bounds maxX must be finite/,
  );

  assert.equal(source.getPlan(active.id), validPlan);
  assert.deepEqual(source.list(0, 0), [active.id]);
});

test('collision numeric configuration rejects non-finite values', () => {
  const source = new ConstructionCollisionSource();

  assert.throws(() => source.configure(Number.POSITIVE_INFINITY), /positive finite chunk size/);
  assert.throws(
    () => source.setConfig({ curveSegmentLength: Number.POSITIVE_INFINITY }),
    /positive and finite/,
  );
});
