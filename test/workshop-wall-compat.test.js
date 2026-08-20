import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeProceduralRecipe } from '../src/editor/workshop/ProceduralAssetStore.js';
import { WorkshopCommandBus } from '../src/editor/workshop/kernel/WorkshopCommandBus.js';
import {
  createWorkshopDocumentFromRecipe,
  resolveWorkshopRecipe,
} from '../src/editor/workshop/kernel/WorkshopRecipeBridge.js';
import { projectWorkshopComposition } from '../src/editor/workshop/model/composition/WorkshopCompositionProjection.js';

const recipe = {
  archetype: 'wall',
  composition: {
    version: 1,
    primitives: [{
      id: 'keep-wall',
      kind: 'wall',
      points: [[-4, 0], [0, 0], [4, 2]],
      elevation: 0.25,
      height: 4.5,
      thickness: 0.6,
      topFamily: 'battlements',
    }],
  },
};

test('legacy wall recipe promotes to semantic paths without compatibility drift', () => {
  const expected = normalizeProceduralRecipe(recipe);
  const document = createWorkshopDocumentFromRecipe(recipe);
  const entity = document.getEntity('composition:keep-wall');

  assert.equal(entity.type, 'composition-wall');
  assert.equal(entity.properties.wall.id, 'keep-wall');
  assert.deepEqual(entity.properties.wall.path.segments.map(({ kind }) => kind), ['line', 'line']);
  assert.deepEqual(resolveWorkshopRecipe(document), expected);

  const projection = projectWorkshopComposition(document);
  assert.equal(projection.wallPlans.length, 1);
  assert.equal(projection.wallPlans[0].wallId, 'keep-wall');
  assert.deepEqual(projection.wallPlans[0].modifiers, [
    { kind: 'legacy-battlements', topFamily: 'battlements' },
  ]);
  assert.deepEqual(projection.rpg.collisionSlabs, expected.composition.primitives[0].points.slice(0, -1).map((start, index) => ({
    id: `keep-wall:segment-${index + 1}`,
    primitiveId: 'keep-wall',
    start,
    end: expected.composition.primitives[0].points[index + 1],
    elevation: 0.25,
    height: 4.5,
    thickness: 0.6,
    gaps: [],
  })));
});

test('legacy direct primitive wall edits re-promote instead of being shadowed by stale semantic data', () => {
  const bus = new WorkshopCommandBus(createWorkshopDocumentFromRecipe(recipe));
  const entity = bus.document.getEntity('composition:keep-wall');
  const primitive = {
    ...entity.properties.primitive,
    points: [[-5, 0], [0, 1], [5, 3]],
    height: 5,
  };
  const event = bus.dispatch({
    type: 'entity.set-properties',
    id: entity.id,
    properties: { primitive },
  });

  assert.deepEqual(event.dirty.entities, ['composition:keep-wall']);
  assert.ok(event.dirty.domains.includes('TOPOLOGY'));
  assert.deepEqual(resolveWorkshopRecipe(bus.document).composition.primitives[0], primitive);

  const projection = projectWorkshopComposition(bus.document);
  assert.deepEqual(
    projection.wallPlans[0].path.points.map(({ position }) => position),
    primitive.points,
  );
  assert.equal(projection.wallPlans[0].wall.height, 5);
});
