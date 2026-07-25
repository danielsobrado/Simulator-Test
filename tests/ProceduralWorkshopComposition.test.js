import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeWorkshopComposition,
  planWorkshopComposition,
  serializeWorkshopComposition,
} from '../src/editor/workshop/ProceduralWorkshopComposition.js';
import { disposeModelParts } from '../src/editor/assets/modelParts.js';
import { createProceduralWorkshopComponentParts } from '../src/editor/workshop/ProceduralWorkshopComponentParts.js';

const composition = {
  primitives: [
    {
      id: 'volume-3',
      kind: 'rectangle',
      position: [2, -1],
      rotation: 15,
      dimensions: [8, 6],
      elevation: 0,
      height: 6,
      levels: 2,
      roofFamily: 'gable',
    },
    {
      id: 'volume-5',
      kind: 'circle',
      position: [-3, 1],
      radius: 2.5,
      elevation: 1,
      height: 8,
      levels: 3,
      roofFamily: 'cone',
    },
    {
      id: 'wall-4',
      kind: 'wall',
      points: [[0, 0], [4, 0], [5, 2]],
      elevation: 0,
      height: 4,
      thickness: 0.4,
      topFamily: 'battlements',
    },
  ],
};

test('composition primitives normalize and serialize in stable-id order', () => {
  const first = serializeWorkshopComposition(normalizeWorkshopComposition(composition));
  const second = serializeWorkshopComposition(normalizeWorkshopComposition({
    primitives: [...composition.primitives].reverse(),
  }));
  assert.deepEqual(first, second);
  assert.deepEqual(first.primitives.map(({ id }) => id), ['volume-3', 'volume-5', 'wall-4']);
  assert.throws(
    () => normalizeWorkshopComposition({
      primitives: [composition.primitives[0], composition.primitives[0]],
    }),
    /Duplicate composition primitive id/,
  );
});

test('composition planning emits stable material regions and RPG shells', () => {
  const plan = planWorkshopComposition({ composition }, ['volume-3']);
  assert.deepEqual(plan.dirtyIds, ['volume-3']);
  assert.ok(plan.materialRegions.some(({ id }) => id === 'volume-3:facade:north'));
  assert.ok(plan.materialRegions.some(({ id }) => id === 'volume-5:tower-shell'));
  assert.ok(plan.materialRegions.some(({ id }) => id === 'wall-4:battlements'));
  assert.equal(plan.rpg.walkableFloors.length, 5);
  assert.equal(plan.rpg.roomBoundaries.length, 5);
  assert.ok(plan.rpg.collisionSlabs.length >= 4);
  assert.ok(plan.rpg.foundationContacts.length >= 4);
  assert.equal(plan.revisionKey, planWorkshopComposition({ composition }, ['volume-3']).revisionKey);
  assert.throws(
    () => planWorkshopComposition({ composition }, ['missing-volume']),
    /Unknown dirty composition primitive/,
  );
});

test('v4 composition primitives compile into editable products with semantic material ownership', () => {
  const parts = createProceduralWorkshopComponentParts({
    composition,
    materialAreaOverrides: {
      'volume-3:facade:north': 'ochre-plaster',
      'volume-5:tower-shell': 'limestone-masonry',
    },
  }, { preserveComponents: true });
  try {
    assert.ok(parts.components.some(({ id }) => id === 'volume-3'));
    assert.ok(parts.components.some(({ id }) => id === 'volume-5'));
    assert.ok(parts.components.some(({ id }) => id === 'wall-4'));
    assert.ok(parts.materialRegions.some(({ id }) => id === 'volume-3:facade:north'));
    assert.ok(parts.materialRegions.some(({ id }) => id === 'volume-5:tower-shell'));
    assert.equal(
      parts.materialRegions.find(({ id }) => id === 'volume-3:facade:north').presetId,
      'ochre-plaster',
    );
    assert.equal(parts.semantics.walkableFloors.length, 5);
    assert.ok(parts.stats.drawParts <= 16);
  } finally {
    disposeModelParts(parts);
  }
});
