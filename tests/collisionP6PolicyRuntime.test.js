import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { COLLISION_LAYERS } from '../src/editor/collision/CollisionLayers.js';
import { ObjectCollisionProvider } from '../src/editor/collision/providers/ObjectCollisionProvider.js';
import { ObjectMap } from '../src/editor/ObjectMap.js';
import { createObjectCatalog } from '../src/editor/objectCatalogSchema.js';
import { ObjectPlacementResolver } from '../src/editor/placement/ObjectPlacementResolver.js';
import { FloatingOrigin } from '../src/editor/world/FloatingOrigin.js';

const TILE_BY_KEY = new Map([[
  'grassland',
  Object.freeze({ id: 4, terrainClass: 'land' }),
]]);

function definition(key, model, category) {
  return {
    key,
    label: key,
    icon: key,
    category,
    color: '#ffffff',
    model,
    footprint: { width: 1, depth: 1 },
    foundation: {
      mode: 'conform', maxSlopeDegrees: 30, maxDepth: 0, alignToNormal: true, color: '#555555',
    },
    allowedTerrain: ['grassland'],
  };
}

test('triggers remain queryable but do not block, and decorative objects emit nothing', () => {
  const catalog = createObjectCatalog([
    definition('campfire', 'campfire', 'civic'),
    definition('bush', 'bush', 'nature'),
  ], TILE_BY_KEY);
  const tileMap = {
    chunkSize: 64,
    tileSize: 2,
    inBounds: () => true,
    indexOf: (x, z) => `${x}:${z}`,
    get: () => 4,
    getTileDefinition: () => TILE_BY_KEY.get('grassland'),
  };
  const objectMap = new ObjectMap({ tileMap, objectCatalog: catalog });
  objectMap.place({ definitionKey: 'campfire', x: 0, z: 0, rotation: 0 });
  objectMap.place({ definitionKey: 'bush', x: 2, z: 0, rotation: 0 });
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

  const built = provider.buildChunkData(0, 0);
  assert.equal(built.stats.trigger, 1);
  assert.equal(built.stats.none, 1);
  assert.equal(built.colliders.length, 1);
  assert.equal(built.colliders[0].layers, COLLISION_LAYERS.trigger);

  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  world.replaceOwnerChunk({ chunkX: 0, chunkZ: 0, revision: 1, colliders: built.colliders });
  assert.equal(world.collectCandidates(built.colliders[0].aabb, COLLISION_LAYERS.solid, []).length, 0);
  assert.equal(world.collectCandidates(built.colliders[0].aabb, COLLISION_LAYERS.trigger, []).length, 1);
});
