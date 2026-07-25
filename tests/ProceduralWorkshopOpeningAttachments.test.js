import assert from 'node:assert/strict';
import test from 'node:test';
import { disposeModelParts } from '../src/editor/assets/modelParts.js';
import { normalizeProceduralRecipe } from '../src/editor/workshop/ProceduralAssetStore.js';
import { getCastleWallOpenings } from '../src/editor/workshop/ProceduralCastleWallLayout.js';
import { createProceduralWorkshopComponentParts } from '../src/editor/workshop/ProceduralWorkshopComponentParts.js';
import {
  nextOpeningCopyId,
  normalizeOpeningAttachments,
  serializeOpeningAttachments,
} from '../src/editor/workshop/ProceduralWorkshopOpeningAttachments.js';
import { resolveWorkshopOpeningLayout } from '../src/editor/workshop/ProceduralWorkshopOpeningLayout.js';

test('opening attachments normalize canonically and reject coerced placement values', () => {
  const normalized = normalizeOpeningAttachments({
    'window-2': {
      sourceId: 'window-2',
      hostId: 'structure-right',
      position: [1.25, 2.5],
      scale: [1.2, 0.9],
    },
    'door-1': {
      sourceId: 'door-1',
      hostId: 'structure-main',
      position: [0, 0],
      scale: [1, 1],
    },
  });

  assert.deepEqual(Object.keys(normalized), ['door-1', 'window-2']);
  assert.ok(Object.isFrozen(normalized['door-1']));
  assert.deepEqual(serializeOpeningAttachments(normalized), {
    'door-1': {
      sourceId: 'door-1',
      hostId: 'structure-main',
      position: [0, 0],
      scale: [1, 1],
    },
    'window-2': {
      sourceId: 'window-2',
      hostId: 'structure-right',
      position: [1.25, 2.5],
      scale: [1.2, 0.9],
    },
  });
  assert.throws(() => normalizeOpeningAttachments({
    'door-1': {
      sourceId: 'door-1',
      hostId: 'structure-main',
      position: ['0', 0],
      scale: [1, 1],
    },
  }), /finite numbers/);
  assert.throws(() => normalizeOpeningAttachments(null), /must be an object/);
});

test('copy identifiers remain deterministic across attachment documents', () => {
  const attachments = {
    'copy-window-1-1': {
      sourceId: 'window-1',
      hostId: 'structure-main',
      position: [0, 1],
      scale: [1, 1],
    },
  };
  assert.equal(nextOpeningCopyId('window-1', attachments), 'copy-window-1-2');
});

test('opening layout routes originals and copies to planar and radial hosts', () => {
  const recipe = {
    componentTransforms: {},
    openingAttachments: normalizeOpeningAttachments({
      'door-1': {
        sourceId: 'door-1',
        hostId: 'structure-left',
        position: [1, 0],
        scale: [1, 1],
      },
      'copy-door-1-1': {
        sourceId: 'door-1',
        hostId: 'structure-main',
        position: [2, 0],
        scale: [0.8, 1],
      },
    }),
  };
  const layout = resolveWorkshopOpeningLayout(recipe, [{
    centerX: 0,
    bottom: 0,
    width: 1.2,
    springHeight: 1.6,
    radius: 0.6,
    componentId: 'door-1',
    componentLabel: 'Gate',
    hostId: 'structure-main',
  }], [
    { id: 'structure-main', type: 'planar', width: 8, height: 5 },
    {
      id: 'structure-left',
      type: 'round',
      width: Math.PI * 4,
      height: 6,
      radius: 2,
    },
  ]);

  assert.deepEqual(layout.get('structure-main').map(({ componentId }) => componentId), [
    'copy-door-1-1',
  ]);
  const radial = layout.get('structure-left')[0];
  assert.equal(radial.componentId, 'door-1');
  assert.equal(radial.surfaceX, 1);
  assert.equal(radial.angle, 0.5);
});

test('gatehouse generation reparents a door to a tower and preserves host metadata', () => {
  const recipe = normalizeProceduralRecipe({
    archetype: 'gatehouse',
    width: 8,
    depth: 2,
    height: 5,
    windows: true,
    openingAttachments: {
      'door-1': {
        sourceId: 'door-1',
        hostId: 'structure-left',
        position: [0.4, 0],
        scale: [0.8, 1],
      },
    },
  });
  const parts = createProceduralWorkshopComponentParts(recipe, { preserveComponents: true });
  try {
    const door = parts.components.find(({ id }) => id === 'door-1');
    const leftTower = parts.components.find(({ id }) => id === 'structure-left');
    assert.equal(door.parentId, 'structure-left');
    assert.equal(leftTower.attachmentSurface.type, 'round');
    assert.deepEqual(door.attachmentPosition, [0.4, 0]);
    assert.ok(door.attachmentSize[0] > 0);
    assert.ok(door.attachmentSize[1] > door.attachmentSize[0]);
  } finally {
    disposeModelParts(parts);
  }
});

test('classic generators materialize duplicated openings as editable hosted components', () => {
  const recipe = normalizeProceduralRecipe({
    archetype: 'wall',
    shape: 'classic',
    width: 9,
    depth: 2,
    height: 5,
    windows: true,
    openingAttachments: {
      'copy-window-1-1': {
        sourceId: 'window-1',
        hostId: 'structure-main',
        position: [0, 2],
        scale: [1, 1],
      },
    },
  });
  const parts = createProceduralWorkshopComponentParts(recipe, { preserveComponents: true });
  try {
    const copy = parts.components.find(({ id }) => id === 'copy-window-1-1');
    assert.equal(copy.kind, 'window');
    assert.equal(copy.parentId, 'structure-main');
    assert.equal(copy.transformPolicy, 'opening2d');
  } finally {
    disposeModelParts(parts);
  }
});

test('advanced castle walls generate persisted arch copies inside the hard opening cap', () => {
  const recipe = normalizeProceduralRecipe({
    archetype: 'wall',
    shape: 'stepped',
    width: 12,
    depth: 2,
    height: 6,
    windows: true,
    openingAttachments: {
      'copy-arch-1-1': {
        sourceId: 'arch-1',
        hostId: 'structure-main',
        position: [4.2, 0],
        scale: [0.8, 1],
      },
    },
  });
  const openings = getCastleWallOpenings(recipe);
  assert.ok(openings.some(({ componentId }) => componentId === 'copy-arch-1-1'));
  assert.ok(openings.length <= 6);
});
