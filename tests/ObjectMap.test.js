import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectMap } from '../src/editor/ObjectMap.js';
import { TileMap } from '../src/editor/TileMap.js';

const catalog = Object.freeze([
  Object.freeze({
    key: 'house',
    label: 'House',
    footprint: Object.freeze({ width: 2, depth: 3 }),
    allowedTileIds: Object.freeze([0]),
  }),
  Object.freeze({
    key: 'tree',
    label: 'Tree',
    footprint: Object.freeze({ width: 1, depth: 1 }),
    allowedTileIds: Object.freeze([0, 1]),
  }),
]);

function createMaps() {
  const tileMap = new TileMap({ width: 8, height: 8, tileSize: 2, defaultTileId: 0 });
  return { tileMap, objectMap: new ObjectMap({ tileMap, objectCatalog: catalog }) };
}

test('rotating an object swaps a non-square footprint', () => {
  const { objectMap } = createMaps();
  assert.deepEqual(objectMap.getFootprint('house', 0), { width: 2, depth: 3 });
  assert.deepEqual(objectMap.getFootprint('house', 1), { width: 3, depth: 2 });
});

test('object rotations remain integer quarter-turns', () => {
  const { objectMap } = createMaps();
  assert.equal(
    objectMap.place({ definitionKey: 'tree', x: 1, z: 1, rotation: -1 }).rotation,
    3,
  );
  for (const rotation of [0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(
      () => objectMap.place({ definitionKey: 'tree', x: 6, z: 6, rotation }),
      /integer quarter-turn/,
    );
  }
});

test('malformed object rotations roll back document replacement', () => {
  const { objectMap } = createMaps();
  const original = objectMap.place({ definitionKey: 'tree', x: 2, z: 2, rotation: 0 });

  assert.throws(
    () => objectMap.loadDocument([{
      id: 99,
      definitionKey: 'tree',
      x: 5,
      z: 5,
      rotation: 0.5,
    }]),
    /integer quarter-turn/,
  );
  assert.deepEqual(objectMap.toDocument(), [original]);
});

test('placement rejects occupied and unsupported terrain cells', () => {
  const { tileMap, objectMap } = createMaps();
  const house = objectMap.place({ definitionKey: 'house', x: 3, z: 3, rotation: 0 });

  assert.equal(objectMap.findAt(3, 3).id, house.id);
  assert.equal(
    objectMap.validatePlacement({ definitionKey: 'tree', x: 3, z: 3, rotation: 0 }).valid,
    false,
  );

  tileMap.paintSquare(6, 6, 1, 2);
  assert.match(
    objectMap.validatePlacement({ definitionKey: 'tree', x: 6, z: 6, rotation: 0 }).reason,
    /terrain/i,
  );
});

test('object changes are reversible with stable ids', () => {
  const { objectMap } = createMaps();
  const after = objectMap.place({ definitionKey: 'tree', x: 2, z: 2, rotation: 0 });
  const change = { before: null, after };

  objectMap.applyChange(change, 'undo');
  assert.equal(objectMap.size, 0);

  objectMap.applyChange(change, 'redo');
  assert.equal(objectMap.getById(after.id).definitionKey, 'tree');
});

test('terrain changes are rejected beneath incompatible objects', () => {
  const { objectMap } = createMaps();
  objectMap.place({ definitionKey: 'house', x: 3, z: 3, rotation: 0 });

  assert.equal(objectMap.canSetTerrain(3, 3, 2), false);
  assert.equal(objectMap.canSetTerrain(0, 0, 2), true);
});

test('custom Azgaar biomes use their semantic terrain class for placement and terrain edits', () => {
  const tileMap = new TileMap({ width: 8, height: 8, tileSize: 2, defaultTileId: 32 });
  tileMap.getTileDefinition = (tileId) => {
    if (tileId === 32 || tileId === 33) return { id: tileId, terrainClass: 'plains' };
    return { id: tileId, terrainClass: 'forest' };
  };
  const objectCatalog = [{
    ...catalog[0],
    allowedTileIds: Object.freeze([4]),
    allowedTerrainClasses: Object.freeze(['plains']),
  }];
  const objectMap = new ObjectMap({ tileMap, objectCatalog });
  assert.equal(
    objectMap.validatePlacement({ definitionKey: 'house', x: 3, z: 3, rotation: 0 }).valid,
    true,
  );

  objectMap.place({ definitionKey: 'house', x: 3, z: 3, rotation: 0 });
  assert.equal(objectMap.canSetTerrain(3, 3, 33), true);
  assert.equal(objectMap.canSetTerrain(3, 3, 34), false);
});

test('object documents round-trip without overlaps', () => {
  const { objectMap } = createMaps();
  objectMap.place({ definitionKey: 'house', x: 3, z: 3, rotation: 0 });
  objectMap.place({ definitionKey: 'tree', x: 7, z: 7, rotation: 0 });

  const { objectMap: target } = createMaps();
  target.loadDocument(objectMap.toDocument());
  assert.deepEqual(target.toDocument(), objectMap.toDocument());
});

test('runtime workshop definitions use the normal placement map', () => {
  const { objectMap } = createMaps();
  objectMap.registerDefinition(Object.freeze({
    key: 'workshop-wall',
    label: 'Workshop Wall',
    footprint: Object.freeze({ width: 3, depth: 1 }),
    allowedTileIds: Object.freeze([0]),
  }));
  const placed = objectMap.place({
    definitionKey: 'workshop-wall',
    x: 3,
    z: 3,
    rotation: 0,
  });
  assert.equal(placed.definitionKey, 'workshop-wall');
  assert.deepEqual(objectMap.getBounds(3, 3, 'workshop-wall', 0), {
    minX: 2,
    minZ: 3,
    maxX: 4,
    maxZ: 3,
    width: 3,
    depth: 1,
  });
});
