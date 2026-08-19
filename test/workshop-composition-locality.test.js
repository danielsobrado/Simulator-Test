import assert from 'node:assert/strict';
import test from 'node:test';

import { planWorkshopComposition } from '../src/editor/workshop/ProceduralWorkshopComposition.js';
import {
  createWorkshopDocumentFromRecipe,
  resolveWorkshopRecipe,
} from '../src/editor/workshop/kernel/WorkshopRecipeBridge.js';
import { projectWorkshopComposition } from '../src/editor/workshop/model/composition/WorkshopCompositionProjection.js';

const recipe = {
  archetype: 'manor',
  style: 'granite',
  topStyle: 'slate',
  seed: 4101,
  composition: {
    version: 1,
    primitives: [
      {
        id: 'hall',
        kind: 'rectangle',
        position: [0, 0],
        rotation: 0,
        dimensions: [8, 4],
        elevation: 0,
        height: 5,
        levels: 2,
        roofFamily: 'hip',
      },
      {
        id: 'tower',
        kind: 'circle',
        position: [6, 0],
        rotation: 0,
        radius: 2,
        elevation: 0,
        height: 8,
        levels: 2,
        roofFamily: 'cone',
      },
      {
        id: 'wall',
        kind: 'wall',
        points: [[-4, -4], [4, -4], [5, -1]],
        elevation: 0,
        height: 4,
        thickness: 0.5,
        topFamily: 'battlements',
      },
    ],
  },
};

test('composition primitives are promoted to stable semantic entities', () => {
  const document = createWorkshopDocumentFromRecipe(recipe);
  assert.equal(document.getEntity('composition:hall').type, 'composition-rectangle');
  assert.equal(document.getEntity('composition:tower').type, 'composition-circle');
  assert.equal(document.getEntity('composition:wall').type, 'composition-wall');
  assert.deepEqual(
    resolveWorkshopRecipe(document).composition.primitives.map(({ id }) => id),
    ['hall', 'tower', 'wall'],
  );
});

test('composition projection preserves legacy material regions and RPG semantics exactly', () => {
  const document = createWorkshopDocumentFromRecipe(recipe);
  const normalizedRecipe = resolveWorkshopRecipe(document);
  const legacy = planWorkshopComposition(normalizedRecipe, ['hall']);
  const projected = projectWorkshopComposition(document, ['composition:hall']);

  assert.deepEqual(projected.materialRegions, legacy.materialRegions);
  assert.deepEqual(projected.rpg, legacy.rpg);
  assert.deepEqual(projected.structural, legacy.structural);
  assert.deepEqual(projected.dirtyEntityIds, ['composition:hall']);
  assert.deepEqual(projected.entityIds, [
    'composition:hall',
    'composition:tower',
    'composition:wall',
  ]);
});
