import assert from 'node:assert/strict';
import test from 'node:test';
import { ObjectMap } from '../src/editor/ObjectMap.js';
import { createObjectCatalog } from '../src/editor/objectCatalogSchema.js';
import { ObjectPlacementResolver } from '../src/editor/placement/ObjectPlacementResolver.js';
import { ObjectCollisionProvider } from '../src/editor/collision/providers/ObjectCollisionProvider.js';
import { FloatingOrigin } from '../src/editor/world/FloatingOrigin.js';

const TILE_BY_KEY = new Map([[
  'grassland',
  Object.freeze({ id: 4, terrainClass: 'land' }),
]]);

function configuredWall() {
  return {
    key: 'wall',
    label: 'Wall',
    icon: 'wall',
    category: 'defense',
    color: '#777777',
    model: 'wall',
    footprint: { width: 1, depth: 1 },
    foundation: {
      mode: 'terrace', maxSlopeDegrees: 30, maxDepth: 2, alignToNormal: false, color: '#555555',
    },
    allowedTerrain: ['grassland'],
  };
}

function fixture() {
  const catalog = createObjectCatalog([configuredWall()], TILE_BY_KEY);
  const tileMap = {
    chunkSize: 64,
    tileSize: 2,
    inBounds: () => true,
    indexOf: (x, z) => `${x}:${z}`,
    get: () => 4,
    getTileDefinition: () => TILE_BY_KEY.get('grassland'),
  };
  const objectMap = new ObjectMap({ tileMap, objectCatalog: catalog });
  const resolver = new ObjectPlacementResolver({
    objectMap,
    definitionByKey: objectMap.definitionByKey,
    heightField: { getVertex: () => 0, sample: () => 0 },
    tileSize: 2,
    floatingOrigin: new FloatingOrigin({ threshold: 4096, snapSize: 128 }),
  });
  const provider = new ObjectCollisionProvider({
    objectMap,
    placementResolver: resolver,
    objectCatalog: catalog,
    tileSize: 2,
    chunkWorldSize: 128,
  });
  return { objectMap, provider };
}

test('a workshop definition registered after boot receives a bounded solid envelope', () => {
  const { objectMap, provider } = fixture();
  const definition = Object.freeze({
    key: 'workshop:gatehouse',
    label: 'Gatehouse',
    icon: 'gate',
    category: 'workshop',
    color: '#888888',
    model: 'workshop',
    footprint: Object.freeze({ width: 3, depth: 2 }),
    foundation: Object.freeze({
      mode: 'terrace', maxSlopeDegrees: 18, maxDepth: 4, alignToNormal: false, color: '#555555',
    }),
    allowedTileIds: Object.freeze([4]),
    allowedTerrainClasses: Object.freeze(['land']),
    procedural: true,
  });
  objectMap.registerDefinition(definition);
  const placed = objectMap.place({
    definitionKey: definition.key,
    x: 4,
    z: 0,
    rotation: 0,
  });

  const built = provider.buildChunkData(0, 0);
  assert.equal(provider.getProfileCount(), 2);
  assert.equal(built.colliders.length, 1);
  assert.equal(built.colliders[0].sourceId, `object:${placed.id}:wall`);
  assert.equal(built.colliders[0].layers, 1);
  assert.ok(built.colliders[0].dimensions[0] <= definition.footprint.width * 2);
  assert.ok(built.colliders[0].dimensions[2] <= definition.footprint.depth * 2);
});
