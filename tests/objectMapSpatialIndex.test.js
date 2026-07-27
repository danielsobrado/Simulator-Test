import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectMap } from '../src/editor/ObjectMap.js';

function createMap() {
  const tileMap = {
    chunkSize: 64,
    inBounds: () => true,
    indexOf: (x, z) => `${x}:${z}`,
    get: () => 1,
    getTileDefinition: () => null,
  };
  return new ObjectMap({
    tileMap,
    objectCatalog: [{
      key: 'house',
      footprint: { width: 2, depth: 2 },
      allowedTileIds: [1],
      allowedTerrainClasses: [],
    }],
  });
}

test('object spatial queries and local signatures follow transforms', () => {
  const map = createMap();
  const placed = map.place({ definitionKey: 'house', x: 70, z: 70 });
  const oldBounds = { minX: 64, minZ: 64, maxX: 127, maxZ: 127 };
  const oldSignature = map.signatureForBounds(oldBounds);
  assert.equal(map.queryBounds(oldBounds).length, 1);
  assert.ok(oldSignature > 0);

  map.transform(placed.id, { x: -70, z: -70, rotation: 0 });
  assert.equal(map.queryBounds(oldBounds).length, 0);
  assert.ok(map.signatureForBounds(oldBounds) > oldSignature);
  assert.equal(map.queryBounds({ minX: -128, minZ: -128, maxX: -64, maxZ: -64 }).length, 1);
});
