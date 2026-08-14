import assert from 'node:assert/strict';
import test from 'node:test';

import { ObjectMap } from '../src/editor/ObjectMap.js';

function createObjectMap() {
  const tileMap = {
    chunkSize: 16,
    inBounds: (x, z) => Number.isSafeInteger(x) && Number.isSafeInteger(z),
    indexOf: (x, z) => `${x}:${z}`,
    get: () => 1,
    getTileDefinition: () => ({ terrainClass: 'land' }),
  };
  return new ObjectMap({
    tileMap,
    objectCatalog: [{
      key: 'test-object',
      footprint: { width: 1, depth: 1 },
      allowedTileIds: [1],
      allowedTerrainClasses: ['land'],
    }],
  });
}

test('object placement rejects coercible non-integer coordinates', () => {
  const objectMap = createObjectMap();
  const validation = objectMap.validatePlacement({
    definitionKey: 'test-object',
    x: '5',
    z: 2,
  });

  assert.equal(validation.valid, false);
  assert.match(validation.reason, /safe integer cells/);
  assert.throws(
    () => objectMap.place({ definitionKey: 'test-object', x: '5', z: 2 }),
    /safe integer cells/,
  );
});

test('object document restore cannot retain string coordinates', () => {
  const objectMap = createObjectMap();

  assert.throws(
    () => objectMap.loadDocument([{
      id: 1,
      definitionKey: 'test-object',
      x: '5',
      z: 2,
      rotation: 0,
    }]),
    /safe integer cells/,
  );
  assert.equal(objectMap.size, 0);
});
