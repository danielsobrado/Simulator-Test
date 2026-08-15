import assert from 'node:assert/strict';
import test from 'node:test';

import { ObjectMap } from '../src/editor/ObjectMap.js';
import { ObjectSpatialIndex } from '../src/editor/ObjectSpatialIndex.js';

function createTileMap() {
  return {
    chunkSize: 16,
    inBounds: () => true,
    indexOf: (x, z) => `${x}:${z}`,
    get: () => 1,
    getTileDefinition: () => ({ terrainClass: 'grassland' }),
  };
}

function createDefinition(key = 'test', footprint = { width: 1, depth: 1 }) {
  return {
    key,
    footprint,
    allowedTileIds: [1],
    allowedTerrainClasses: [],
  };
}

test('object map rejects invalid footprint dimensions at registration', () => {
  const map = new ObjectMap({ tileMap: createTileMap(), objectCatalog: [] });
  const invalidDimensions = [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY];

  for (const width of invalidDimensions) {
    assert.throws(
      () => map.registerDefinition(createDefinition(`width-${width}`, { width, depth: 1 })),
      /positive safe integer dimensions/,
    );
  }
});

test('object map validates catalog definitions during construction', () => {
  assert.throws(
    () => new ObjectMap({
      tileMap: createTileMap(),
      objectCatalog: [createDefinition('invalid', { width: 1, depth: Number.POSITIVE_INFINITY })],
    }),
    /positive safe integer dimensions/,
  );
});

test('object map revalidates definitions after registration', () => {
  const definition = createDefinition();
  const map = new ObjectMap({ tileMap: createTileMap(), objectCatalog: [definition] });
  definition.footprint.width = Number.POSITIVE_INFINITY;

  assert.throws(
    () => map.getCells(0, 0, definition.key, 0),
    /positive safe integer dimensions/,
  );
});

test('object map rejects pathological footprint area before enumerating cells', () => {
  const map = new ObjectMap({ tileMap: createTileMap(), objectCatalog: [] });

  assert.throws(
    () => map.registerDefinition(createDefinition('oversized', { width: 257, depth: 256 })),
    /footprint exceeds/,
  );
});

test('object spatial index rejects non-finite and unordered bounds', () => {
  const index = new ObjectSpatialIndex({ bucketSize: 16, boundsForObject: () => null });

  assert.throws(
    () => index.query({ minX: 0, maxX: Number.POSITIVE_INFINITY, minZ: 0, maxZ: 1 }),
    /must be finite/,
  );
  assert.throws(
    () => index.query({ minX: 2, maxX: 1, minZ: 0, maxZ: 1 }),
    /ordered minimum and maximum/,
  );
});

test('object spatial index rejects unsafe or pathological bucket ranges', () => {
  const index = new ObjectSpatialIndex({ bucketSize: 1, boundsForObject: () => null });

  assert.throws(
    () => index.query({
      minX: Number.MAX_SAFE_INTEGER + 1,
      maxX: Number.MAX_SAFE_INTEGER + 1,
      minZ: 0,
      maxZ: 0,
    }),
    /safe integer/,
  );
  assert.throws(
    () => index.query({ minX: 0, maxX: 262_144, minZ: 0, maxZ: 0 }),
    /exceeds 262144 buckets/,
  );
});
