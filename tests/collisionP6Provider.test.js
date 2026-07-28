import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { ObjectMap } from '../src/editor/ObjectMap.js';
import { createObjectCatalog } from '../src/editor/objectCatalogSchema.js';
import { ObjectPlacementResolver } from '../src/editor/placement/ObjectPlacementResolver.js';
import { ObjectCollisionProvider } from '../src/editor/collision/providers/ObjectCollisionProvider.js';
import { FloatingOrigin } from '../src/editor/world/FloatingOrigin.js';
import { collisionChunkForCanonical } from '../src/editor/collision/colliders/ColliderBounds.js';

const TILE_SIZE = 2;
const CHUNK_WORLD_SIZE = 128;
const TILE_BY_KEY = new Map([[
  'grassland',
  Object.freeze({ id: 4, terrainClass: 'land' }),
]]);

function rawDefinition() {
  return {
    key: 'wall',
    label: 'Wall',
    icon: 'wall',
    category: 'defense',
    color: '#777777',
    model: 'wall',
    footprint: { width: 1, depth: 1 },
    foundation: {
      mode: 'terrace',
      maxSlopeDegrees: 30,
      maxDepth: 2,
      alignToNormal: false,
      color: '#555555',
    },
    collision: { policy: 'solid' },
    allowedTerrain: ['grassland'],
  };
}

function fixture() {
  const catalog = createObjectCatalog([rawDefinition()], TILE_BY_KEY);
  const tileMap = {
    chunkSize: 64,
    tileSize: TILE_SIZE,
    inBounds: () => true,
    indexOf: (x, z) => `${x}:${z}`,
    get: () => 4,
    getTileDefinition: () => TILE_BY_KEY.get('grassland'),
  };
  const objectMap = new ObjectMap({ tileMap, objectCatalog: catalog });
  const heightField = {
    getVertex: () => 5,
    sample: () => 5,
  };
  const floatingOrigin = new FloatingOrigin({ threshold: 4096, snapSize: CHUNK_WORLD_SIZE });
  const placementResolver = new ObjectPlacementResolver({
    objectMap,
    definitionByKey: objectMap.definitionByKey,
    heightField,
    tileSize: TILE_SIZE,
    floatingOrigin,
  });
  const provider = new ObjectCollisionProvider({
    objectMap,
    placementResolver,
    objectCatalog: catalog,
    tileSize: TILE_SIZE,
    chunkWorldSize: CHUNK_WORLD_SIZE,
  });
  return { objectMap, placementResolver, provider };
}

function close(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

test('object chunk ownership matches the window residency loads', () => {
  const { objectMap, provider } = fixture();
  const placed = objectMap.place({ definitionKey: 'wall', x: 0, z: 0, rotation: 0 });

  // Cell Z and chunk Z run together: canonical Z is already mirrored against
  // cell Z, and `collisionChunkForCanonical` mirrors chunk Z against canonical
  // Z, so the two cancel. Chunk 0 is cells 0..63, which are canonical -126..0.
  assert.deepEqual(provider.cellBounds(0, 0), {
    minX: 0,
    maxX: 63,
    minZ: 0,
    maxZ: 63,
  });
  const built = provider.buildChunkData(0, 0);
  assert.equal(built.colliders.length, 1);
  assert.equal(built.colliders[0].sourceId, `object:${placed.id}:wall`);
  assert.equal(built.colliders[0].ownerChunkX, 0);
  // A wall at canonical z -1 belongs to chunk 0 — the same chunk
  // `CollisionResidency` loads for a player standing there. Filing it under -1
  // put its colliders in a chunk that is never resident where the wall is, so
  // the wall existed but never blocked.
  assert.equal(built.colliders[0].ownerChunkZ, 0);
  assert.deepEqual(built.colliders[0].position, [1, 6.15, -1]);
  assert.deepEqual(
    collisionChunkForCanonical(1, -1, CHUNK_WORLD_SIZE),
    { chunkX: 0, chunkZ: 0 },
  );
  assert.equal(provider.buildChunkData(0, -1).colliders.length, 0);
});

test('quarter-turn transforms preserve stable IDs and rotate the collider', () => {
  const { objectMap, provider } = fixture();
  const placed = objectMap.place({ definitionKey: 'wall', x: 0, z: 0, rotation: 0 });
  provider.buildChunkData(0, 0);
  assert.deepEqual(provider.consumeDirtyOwnerChunks(['0:0']), []);

  const rotated = objectMap.transform(placed.id, { x: 0, z: 0, rotation: 1 });
  assert.deepEqual(provider.consumeDirtyOwnerChunks(['0:0']), ['0:0']);
  const built = provider.buildChunkData(0, 0);
  assert.equal(built.colliders[0].sourceId, `object:${placed.id}:wall`);
  close(built.colliders[0].rotationY, -Math.PI / 2);
  assert.equal(rotated.rotation, 1);
  assert.deepEqual(provider.consumeDirtyOwnerChunks(['0:0']), []);
});

test('remove, undo, redo, and save/load rebuild only content signatures', () => {
  const { objectMap, provider } = fixture();
  const before = objectMap.place({ definitionKey: 'wall', x: 0, z: 0, rotation: 0 });
  const initial = provider.buildChunkData(0, 0);
  const initialIds = initial.colliders.map((collider) => collider.sourceId);

  const after = objectMap.transform(before.id, { x: 2, z: 0, rotation: 1 });
  const transformed = provider.buildChunkData(0, 0);
  assert.notEqual(transformed.signature, initial.signature);

  const change = Object.freeze({ before, after });
  objectMap.applyChange(change, 'undo');
  const undone = provider.buildChunkData(0, 0);
  assert.equal(undone.signature, initial.signature);
  assert.deepEqual(undone.colliders.map((collider) => collider.sourceId), initialIds);

  objectMap.applyChange(change, 'redo');
  assert.equal(provider.buildChunkData(0, 0).signature, transformed.signature);

  const document = objectMap.toDocument();
  const saved = provider.buildChunkData(0, 0);
  objectMap.clear();
  assert.equal(provider.buildChunkData(0, 0).colliders.length, 0);
  objectMap.loadDocument(document);
  const loaded = provider.buildChunkData(0, 0);
  assert.equal(loaded.signature, saved.signature);
  assert.deepEqual(
    loaded.colliders.map((collider) => collider.sourceId),
    saved.colliders.map((collider) => collider.sourceId),
  );
});

test('canonical placement matrix is independent from floating-origin render offsets', () => {
  const { objectMap, placementResolver } = fixture();
  const placed = objectMap.place({ definitionKey: 'wall', x: 64, z: 64, rotation: 1 });
  placementResolver.floatingOrigin.setOrigin(128, -128);
  const canonical = placementResolver.createCanonicalObjectMatrix(placed);
  const render = placementResolver.createObjectMatrix(placed);
  const canonicalPosition = new THREE.Vector3();
  const renderPosition = new THREE.Vector3();
  canonical.decompose(canonicalPosition, new THREE.Quaternion(), new THREE.Vector3());
  render.decompose(renderPosition, new THREE.Quaternion(), new THREE.Vector3());

  assert.deepEqual(canonicalPosition.toArray(), [129, 5, -129]);
  assert.deepEqual(renderPosition.toArray(), [1, 5, -1]);
});
