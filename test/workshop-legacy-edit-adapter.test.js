import assert from 'node:assert/strict';
import test from 'node:test';

import { WorkshopCommandBus } from '../src/editor/workshop/kernel/index.js';
import {
  createWorkshopDocumentFromRecipe,
  resolveWorkshopRecipe,
} from '../src/editor/workshop/kernel/WorkshopRecipeBridge.js';
import { legacyWorkshopEditStateCommand } from '../src/editor/workshop/interaction/index.js';

test('legacy component edit state applies as one semantic batch', () => {
  const initial = createWorkshopDocumentFromRecipe({
    archetype: 'wall',
    componentTransforms: {
      'structure-main': {
        position: [0.1, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
      },
    },
    openingAttachments: {
      'copy-window-1-1': {
        sourceId: 'window-1',
        hostId: 'structure-main',
        position: [1, 1],
        scale: [1, 1],
      },
    },
    openingAssemblies: {
      'assembly-window-1': {
        kind: 'window',
        hostId: 'structure-main',
        memberIds: ['copy-window-1-1'],
      },
    },
  });
  const bus = new WorkshopCommandBus(initial);
  const beforeRevision = bus.document.revision;
  const command = legacyWorkshopEditStateCommand(bus.document, {
    componentTransforms: {},
    openingAttachments: {},
    openingAssemblies: {},
  });

  const removalIds = command.commands
    .filter(({ type }) => type === 'entity.remove')
    .map(({ id }) => id);
  assert.deepEqual(removalIds, [
    'opening-assembly:assembly-window-1',
    'opening-attachment:copy-window-1-1',
    'component-transform:structure-main',
  ]);

  bus.dispatch(command);
  assert.equal(bus.document.revision, beforeRevision + 1);
  const recipe = resolveWorkshopRecipe(bus.document);
  assert.deepEqual(recipe.componentTransforms, {});
  assert.deepEqual(recipe.openingAttachments, {});
  assert.deepEqual(recipe.openingAssemblies, {});
});
