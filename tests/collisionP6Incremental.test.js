import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { NaturalCollisionProvider } from '../src/editor/collision/providers/NaturalCollisionProvider.js';
import { ObjectCollisionProvider } from '../src/editor/collision/providers/ObjectCollisionProvider.js';
import { ObjectMap } from '../src/editor/ObjectMap.js';
import { createObjectCatalog } from '../src/editor/objectCatalogSchema.js';
import { ObjectPlacementResolver } from '../src/editor/placement/ObjectPlacementResolver.js';
import { FloatingOrigin } from '../src/editor/world/FloatingOrigin.js';

const TILE_BY_KEY = new Map([[
  'grassland',
  Object.freeze({ id: 4, terrainClass: 'land' }),
]]);

function rawWall() {
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
  const catalog = createObjectCatalog([rawWall()], TILE_BY_KEY);
  const tileMap = {
    chunkSize: 64,
    tileSize: 2,
    inBounds: () => true,
    indexOf: (x, z) => `${x}:${z}`,
    get: () => 4,
    getTileDefinition: () => TILE_BY_KEY.get('grassland'),
  };
  const objectMap = new ObjectMap({ tileMap, objectCatalog: catalog });
  const placed = objectMap.place({ definitionKey: 'wall', x: 0, z: 0, rotation: 0 });
  const resolver = new ObjectPlacementResolver({
    objectMap,
    definitionByKey: objectMap.definitionByKey,
    heightField: { getVertex: () => 0, sample: () => 0 },
    tileSize: 2,
    floatingOrigin: new FloatingOrigin({ threshold: 4096, snapSize: 128 }),
  });
  const objectProvider = new ObjectCollisionProvider({
    objectMap,
    placementResolver: resolver,
    objectCatalog: catalog,
    tileSize: 2,
    chunkWorldSize: 128,
  });
  const natural = new NaturalCollisionProvider({
    components: [Object.freeze({ id: 'objects', counterName: 'Object', provider: objectProvider })],
    buildsPerFrame: 4,
    buildBudgetMs: 100,
    now: () => 0,
  });
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  return { objectMap, placed, objectProvider, natural, world };
}

function commitInitial(provider, world, chunkX, chunkZ) {
  const built = provider.buildOwnerChunk(chunkX, chunkZ);
  world.replaceOwnerChunk({ chunkX, chunkZ, ...built });
  provider.commitOwnerChunk({ chunkX, chunkZ, ...built });
}

test('object mutation refreshes only the dirty resident owner chunk', () => {
  const { objectMap, placed, objectProvider, natural, world } = fixture();
  commitInitial(natural, world, 0, 0);
  commitInitial(natural, world, 1, 0);
  const untouchedRevision = natural.chunkStates.get('1:0').revision;
  const sourceId = `object:${placed.id}:wall`;
  assert.equal(world.getCollider(sourceId).rotationY, 0);

  objectMap.transform(placed.id, { x: 0, z: 0, rotation: 1 });
  const activeKeys = [...natural.chunkStates.keys()];
  const dirty = objectProvider.consumeDirtyOwnerChunks(activeKeys);
  assert.deepEqual(dirty, ['0:0']);
  for (const key of dirty) natural.enqueueRefreshKey(key);

  const refreshed = natural.refresh(world);
  assert.equal(refreshed.attempted, 1);
  assert.equal(refreshed.rebuilt, 1);
  assert.equal(natural.chunkStates.get('1:0').revision, untouchedRevision);
  assert.ok(Math.abs(world.getCollider(sourceId).rotationY + Math.PI / 2) < 1e-9);
});
