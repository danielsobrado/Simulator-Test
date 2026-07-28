import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WORLD_COLLISION_SCHEMA_VERSION,
  createWorldDocument,
  loadWorldDocument,
} from '../src/editor/WorldDocument.js';
import { INFINITE_WORLD_FORMAT_VERSION } from '../src/editor/world/worldConstants.js';

function fixtures() {
  const state = {
    worldLoads: 0,
    objectLoads: 0,
    objects: [{ id: 1, definitionKey: 'cottage', x: 0, z: 0, rotation: 0 }],
  };
  const worldStore = {
    toDocument: () => ({ version: INFINITE_WORLD_FORMAT_VERSION, seed: 123 }),
    createSnapshot: () => ({ snapshot: true }),
    loadDocument: () => { state.worldLoads += 1; },
    restoreSnapshot() {},
  };
  const objectMap = {
    toDocument: () => structuredClone(state.objects),
    loadDocument: (objects) => {
      state.objectLoads += 1;
      state.objects = structuredClone(objects);
    },
    replaceAll: (objects) => { state.objects = structuredClone(objects); },
  };
  return {
    state,
    tileMap: { worldStore },
    objectMap,
  };
}

test('world saves version collision-affecting authored authority only', () => {
  const { tileMap, objectMap } = fixtures();
  const document = createWorldDocument(tileMap, objectMap);

  assert.deepEqual(document.collisionSchema, { version: WORLD_COLLISION_SCHEMA_VERSION });
  assert.deepEqual(document.objects, objectMap.toDocument());
  assert.equal('collisionChunks' in document, false);
  assert.equal('naturalColliders' in document, false);
});

test('current saves without an explicit collision schema remain loadable', () => {
  const { state, tileMap, objectMap } = fixtures();
  loadWorldDocument({
    version: INFINITE_WORLD_FORMAT_VERSION,
    objects: [],
  }, tileMap, objectMap);

  assert.equal(state.worldLoads, 1);
  assert.equal(state.objectLoads, 1);
  assert.deepEqual(state.objects, []);
});

test('unsupported collision schemas fail before mutating world authority', () => {
  const { state, tileMap, objectMap } = fixtures();
  assert.throws(() => loadWorldDocument({
    version: INFINITE_WORLD_FORMAT_VERSION,
    collisionSchema: { version: WORLD_COLLISION_SCHEMA_VERSION + 1 },
    objects: [],
  }, tileMap, objectMap), /Unsupported world collision schema/);

  assert.equal(state.worldLoads, 0);
  assert.equal(state.objectLoads, 0);
  assert.equal(state.objects.length, 1);
});
