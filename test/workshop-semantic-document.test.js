import assert from 'node:assert/strict';
import test from 'node:test';

import {
  WorkshopDocument,
  WorkshopEntity,
  WorkshopPatch,
  applyWorkshopPatch,
} from '../src/editor/workshop/kernel/index.js';

function baseDocument() {
  return new WorkshopDocument({
    entities: [
      { id: 'root', type: 'structure', properties: { width: 8 } },
      { id: 'roof', type: 'roof', parentId: 'root', properties: { pitch: 38 } },
    ],
  });
}

test('workshop document canonicalizes entity order and JSON properties', () => {
  const document = new WorkshopDocument({
    entities: [
      { id: 'z-child', type: 'detail', parentId: 'a-root', properties: { z: 2, a: 1 } },
      { id: 'a-root', type: 'structure', properties: {} },
    ],
  });

  assert.deepEqual(document.listEntities().map(({ id }) => id), ['a-root', 'z-child']);
  assert.deepEqual(Object.keys(document.getEntity('z-child').properties), ['a', 'z']);
  assert.deepEqual(document.rootIds(), ['a-root']);
});

test('workshop document rejects missing references and parent cycles', () => {
  assert.throws(() => new WorkshopDocument({
    entities: [{ id: 'child', type: 'detail', parentId: 'missing' }],
  }), /missing parent/i);

  assert.throws(() => new WorkshopDocument({
    entities: [
      { id: 'a', type: 'detail', parentId: 'b' },
      { id: 'b', type: 'detail', parentId: 'a' },
    ],
  }), /cycle/i);
});

test('workshop patch is atomic and inverse restores the document', () => {
  const before = baseDocument();
  const patch = new WorkshopPatch({
    label: 'Change roof',
    operations: [{
      op: 'put',
      entity: new WorkshopEntity({
        ...before.getEntity('roof').toJSON(),
        properties: { pitch: 45 },
      }),
    }],
  });
  const applied = applyWorkshopPatch(before, patch);
  assert.equal(applied.document.revision, 1);
  assert.equal(applied.document.getEntity('roof').properties.pitch, 45);

  const restored = applyWorkshopPatch(applied.document, applied.inverse).document;
  assert.deepEqual(restored.listEntities(), before.listEntities());
});

test('invalid patch leaves original document untouched', () => {
  const before = baseDocument();
  const patch = new WorkshopPatch({ operations: [{ op: 'remove', id: 'root' }] });
  assert.throws(() => applyWorkshopPatch(before, patch), /missing parent/i);
  assert.equal(before.hasEntity('root'), true);
  assert.equal(before.revision, 0);
});
