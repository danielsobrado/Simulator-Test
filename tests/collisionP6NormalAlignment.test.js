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

function rawFence() {
  return {
    key: 'fence',
    label: 'Fence',
    icon: 'fence',
    category: 'defense',
    color: '#777777',
    model: 'fence',
    footprint: { width: 1, depth: 1 },
    foundation: {
      mode: 'conform',
      maxSlopeDegrees: 30,
      maxDepth: 0,
      alignToNormal: true,
      color: '#555555',
    },
    collision: { policy: 'solid' },
    allowedTerrain: ['grassland'],
  };
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test('normal-aligned parts use conservative upright bounds for primitive narrowphase', () => {
  const catalog = createObjectCatalog([rawFence()], TILE_BY_KEY);
  const tileMap = {
    chunkSize: 64,
    tileSize: 2,
    inBounds: () => true,
    indexOf: (x, z) => `${x}:${z}`,
    get: () => 4,
    getTileDefinition: () => TILE_BY_KEY.get('grassland'),
  };
  const objectMap = new ObjectMap({ tileMap, objectCatalog: catalog });
  objectMap.place({ definitionKey: 'fence', x: 0, z: 0, rotation: 0 });
  const heightAt = (x) => x * 0.25;
  const placementResolver = new ObjectPlacementResolver({
    objectMap,
    definitionByKey: objectMap.definitionByKey,
    heightField: {
      getVertex: (x) => heightAt(x),
      sample: (x) => heightAt(x),
    },
    tileSize: 2,
    floatingOrigin: new FloatingOrigin({ threshold: 4096, snapSize: 128 }),
  });
  const provider = new ObjectCollisionProvider({
    objectMap,
    placementResolver,
    objectCatalog: catalog,
    tileSize: 2,
    chunkWorldSize: 128,
  });

  const built = provider.buildChunkData(0, -1);
  const post = built.colliders.find((collider) => collider.sourceId.endsWith(':post-left'));
  assert.ok(post);
  assert.equal(post.rotationY, 0);
  assert.ok(post.dimensions[1] > 1.28, 'tilt must expand the conservative world-space height');
  close(post.position[0] - post.dimensions[0] / 2, post.aabb.minX);
  close(post.position[0] + post.dimensions[0] / 2, post.aabb.maxX);
  close(post.position[1] - post.dimensions[1] / 2, post.aabb.minY);
  close(post.position[1] + post.dimensions[1] / 2, post.aabb.maxY);
  close(post.position[2] - post.dimensions[2] / 2, post.aabb.minZ);
  close(post.position[2] + post.dimensions[2] / 2, post.aabb.maxZ);
  assert.equal(post.ownerChunkX, 0);
  assert.equal(post.ownerChunkZ, -1);
});
