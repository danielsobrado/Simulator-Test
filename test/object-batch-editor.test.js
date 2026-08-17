import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ObjectBatchEditor,
  createObjectBatchHistory,
} from '../src/editor/interaction/ObjectBatchEditor.js';

class FakeObjectMap {
  constructor(objects) {
    this.objects = new Map(objects.map((object) => [object.id, { ...object }]));
    this.nextId = Math.max(0, ...this.objects.keys()) + 1;
  }

  list() {
    return [...this.objects.values()].map((object) => ({ ...object }));
  }

  getBounds(x, z) {
    return { minX: x, maxX: x, minZ: z, maxZ: z, width: 1, depth: 1 };
  }

  remove(id) {
    const object = this.objects.get(id);
    this.objects.delete(id);
    return object ? { ...object } : null;
  }

  restore(object) {
    if (this.objects.has(object.id)) throw new Error('duplicate id');
    this.objects.set(object.id, { ...object });
    this.nextId = Math.max(this.nextId, object.id + 1);
    return { ...object };
  }

  place(candidate) {
    const object = { ...candidate, id: this.nextId++ };
    this.objects.set(object.id, object);
    return { ...object };
  }

  replaceAll(objects) {
    this.objects = new Map(objects.map((object) => [object.id, { ...object }]));
    this.nextId = Math.max(0, ...this.objects.keys()) + 1;
  }
}

function fixture() {
  const objectMap = new FakeObjectMap([
    { id: 1, definitionKey: 'tree', x: 2, z: 3, rotation: 0 },
    { id: 2, definitionKey: 'rock', x: 5, z: 7, rotation: 1 },
  ]);
  const controller = {
    objectMap,
    validateObjectPlacement: ({ x }) => ({
      valid: x !== 99,
      reason: x === 99 ? 'blocked' : null,
    }),
  };
  return { objectMap, editor: new ObjectBatchEditor(controller) };
}

test('object batch transform is atomic and keeps ids', () => {
  const { objectMap, editor } = fixture();
  const originals = objectMap.list();
  const result = editor.transform(originals, (object) => ({ ...object, x: object.x + 4 }));

  assert.equal(result.ok, true);
  assert.deepEqual(objectMap.list().map(({ id, x }) => [id, x]), [[1, 6], [2, 9]]);
  assert.deepEqual(result.changes.map(({ before, after }) => [before.id, after.id]), [[1, 1], [2, 2]]);
});

test('object batch transform rolls back every object on failure', () => {
  const { objectMap, editor } = fixture();
  const before = objectMap.list();
  const result = editor.transform(before, (object) => ({
    ...object,
    x: object.id === 2 ? 99 : object.x + 1,
  }));

  assert.equal(result.ok, false);
  assert.equal(result.error.message, 'blocked');
  assert.deepEqual(objectMap.list(), before);
});

test('object batch history restores transactional changes', () => {
  const { objectMap, editor } = fixture();
  const originals = objectMap.list();
  const transformed = editor.transform(originals, (object) => ({ ...object, z: object.z + 2 }));
  const history = createObjectBatchHistory(transformed.changes);

  const undoTargets = editor.applyHistory(history, 'undo');
  assert.deepEqual(objectMap.list(), originals);
  assert.deepEqual(undoTargets.map(({ id }) => id), [1, 2]);

  editor.applyHistory(history, 'redo');
  assert.deepEqual(objectMap.list().map(({ id, z }) => [id, z]), [[1, 5], [2, 9]]);
});
