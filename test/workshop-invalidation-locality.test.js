import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkshopCommandBus } from '../src/editor/workshop/kernel/WorkshopCommandBus.js';
import { createWorkshopDocumentFromRecipe } from '../src/editor/workshop/kernel/WorkshopRecipeBridge.js';
import { WorkshopLocalityState } from '../src/editor/workshop/locality/WorkshopLocalityState.js';

function recipe() {
  return {
    archetype: 'manor',
    style: 'granite',
    composition: {
      version: 1,
      primitives: [
        {
          id: 'hall',
          kind: 'rectangle',
          position: [0, 0],
          rotation: 0,
          dimensions: [4, 4],
          elevation: 0,
          height: 5,
          levels: 1,
          roofFamily: 'hip',
        },
        {
          id: 'wing',
          kind: 'rectangle',
          position: [12, 0],
          rotation: 0,
          dimensions: [4, 4],
          elevation: 0,
          height: 5,
          levels: 1,
          roofFamily: 'hip',
        },
      ],
    },
  };
}

test('command events expose exact local dirty entity/domain sets', () => {
  const bus = new WorkshopCommandBus(createWorkshopDocumentFromRecipe(recipe()));
  const hall = bus.document.getEntity('composition:hall');
  const event = bus.dispatch({
    type: 'entity.set-properties',
    id: hall.id,
    properties: {
      primitive: {
        ...hall.properties.primitive,
        position: [2, 0],
      },
    },
  });

  assert.deepEqual(event.dirty.entities, ['composition:hall']);
  assert.ok(event.dirty.domains.includes('GEOMETRY'));
  assert.ok(event.dirty.domains.includes('SPATIAL_INDEX'));
  assert.equal(event.dirty.entities.includes('composition:wing'), false);
});

test('locality state consumes dirty events and updates only spatially affected entities', () => {
  const bus = new WorkshopCommandBus(createWorkshopDocumentFromRecipe(recipe()));
  const locality = new WorkshopLocalityState(bus.document, { cellSize: 8 });
  locality.connect(bus);
  const hall = bus.document.getEntity('composition:hall');
  bus.dispatch({
    type: 'entity.set-properties',
    id: hall.id,
    properties: {
      primitive: {
        ...hall.properties.primitive,
        position: [30, 0],
      },
    },
  });
  assert.deepEqual(locality.queryNeighborhood('composition:hall', 8), []);
  locality.disconnect();
});
