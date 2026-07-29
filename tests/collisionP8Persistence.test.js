import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix4 } from 'three';
import {
  WORLD_COLLISION_SCHEMA_VERSION,
  createWorldDocument,
  loadWorldDocument,
} from '../src/editor/WorldDocument.js';
import { ObjectCollisionProvider } from '../src/editor/collision/providers/ObjectCollisionProvider.js';
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

function objectProvider(object) {
  const definition = Object.freeze({
    key: 'wall',
    model: 'wall',
    footprint: Object.freeze({ width: 1, depth: 1 }),
    collision: Object.freeze({
      policy: 'solid',
      profile: 'wall',
      allowFootprintOverflow: false,
      scale: Object.freeze({ x: 1, y: 1, z: 1 }),
      offset: Object.freeze({ x: 0, y: 0, z: 0 }),
    }),
  });
  const objects = [structuredClone(object)];
  const objectMap = {
    definitionByKey: new Map([[definition.key, definition]]),
    queryBounds: () => objects.map((entry) => structuredClone(entry)),
    signatureForBounds: () => JSON.stringify(objects),
  };
  const placementResolver = {
    resolve: () => ({
      bounds: { width: 1, depth: 1 },
      surface: { baseHeight: 0 },
    }),
    canonicalCenter: () => ({ x: 8, z: -8 }),
    createCanonicalObjectMatrix: () => new Matrix4().makeTranslation(8, 0, -8),
  };
  return new ObjectCollisionProvider({
    objectMap,
    placementResolver,
    objectCatalog: [definition],
    tileSize: 16,
    chunkWorldSize: 128,
  });
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

test('placed-object provider reloads identical collider IDs and signatures', () => {
  const saved = {
    id: 27,
    definitionKey: 'wall',
    x: 0,
    z: 0,
    rotation: Math.PI / 2,
  };
  const before = objectProvider(saved).buildChunkData(0, -1);
  const after = objectProvider(structuredClone(saved)).buildChunkData(0, -1);

  assert.equal(before.signature, after.signature);
  assert.deepEqual(
    before.colliders.map(({ sourceId }) => sourceId),
    after.colliders.map(({ sourceId }) => sourceId),
  );
  assert.ok(before.colliders.every(({ sourceId }) => sourceId.startsWith('object:27:')));
});
