import assert from 'node:assert/strict';
import test from 'node:test';
import { CharacterMotor } from '../src/editor/collision/character/CharacterMotor.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { createSweptCapsuleAabb } from '../src/editor/collision/colliders/ColliderBounds.js';
import { ObjectCollisionProvider } from '../src/editor/collision/providers/ObjectCollisionProvider.js';
import { ObjectMap } from '../src/editor/ObjectMap.js';
import { createObjectCatalog } from '../src/editor/objectCatalogSchema.js';
import { ObjectPlacementResolver } from '../src/editor/placement/ObjectPlacementResolver.js';
import { FloatingOrigin } from '../src/editor/world/FloatingOrigin.js';

const TILE_SIZE = 2;
const CHUNK_WORLD_SIZE = 128;
const TILE_BY_KEY = new Map([[
  'grassland',
  Object.freeze({ id: 4, terrainClass: 'land' }),
]]);

function rawCottage() {
  return {
    key: 'cottage',
    label: 'Cottage',
    icon: 'house',
    category: 'building',
    color: '#ffffff',
    model: 'cottage',
    footprint: { width: 2, depth: 2 },
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
  const catalog = createObjectCatalog([rawCottage()], TILE_BY_KEY);
  const tileMap = {
    chunkSize: 64,
    tileSize: TILE_SIZE,
    inBounds: () => true,
    indexOf: (x, z) => `${x}:${z}`,
    get: () => 4,
    getTileDefinition: () => TILE_BY_KEY.get('grassland'),
  };
  const objectMap = new ObjectMap({ tileMap, objectCatalog: catalog });
  objectMap.place({ definitionKey: 'cottage', x: 0, z: 0, rotation: 0 });
  const placementResolver = new ObjectPlacementResolver({
    objectMap,
    definitionByKey: objectMap.definitionByKey,
    heightField: { getVertex: () => 0, sample: () => 0 },
    tileSize: TILE_SIZE,
    floatingOrigin: new FloatingOrigin({ threshold: 4096, snapSize: CHUNK_WORLD_SIZE }),
  });
  const provider = new ObjectCollisionProvider({
    objectMap,
    placementResolver,
    objectCatalog: catalog,
    tileSize: TILE_SIZE,
    chunkWorldSize: CHUNK_WORLD_SIZE,
  });
  const built = provider.buildChunkData(0, -1);
  const world = new CollisionWorld({ chunkWorldSize: CHUNK_WORLD_SIZE, binSize: 16 });
  world.replaceOwnerChunk({
    chunkX: 0,
    chunkZ: -1,
    revision: 1,
    colliders: built.colliders,
  });
  const runtime = {
    querySweptCapsule({ start, end, radius, bodyHeight, layers, out }) {
      return world.collectCandidates(
        createSweptCapsuleAabb({ start, end, radius, bodyHeight }),
        layers,
        out,
      );
    },
    checkMovementReadiness: () => Object.freeze({ ready: true, missing: Object.freeze([]) }),
  };
  const terrainProvider = {
    constrainMovement: ({ endX, endZ }) => ({ x: endX, z: endZ, constrained: false }),
    sample: () => Object.freeze({
      sourceId: 'terrain',
      height: 0,
      normal: Object.freeze({ x: 0, y: 1, z: 0 }),
      walkable: true,
    }),
  };
  const motor = new CharacterMotor({
    collisionRuntime: runtime,
    terrainProvider,
    config: Object.freeze({
      radius: 0.35,
      bodyHeight: 1.8,
      skinWidth: 0.03,
      maxSlopeDegrees: 50,
      maxSubstepDistance: 0.2,
      maxIterations: 6,
    }),
    stepHeight: 1.1,
    groundSnapDistance: 0.6,
  });
  return { motor, built };
}

test('the player passes through the cottage doorway without crossing a wall', () => {
  const { motor, built } = fixture();
  assert.equal(built.colliders.length >= 5, true);
  const result = motor.move({
    start: { x: 2, y: 0, z: 0.4 },
    displacement: { x: 0, z: -2.2 },
    grounded: true,
  });

  assert.equal(result.ready, true);
  assert.equal(result.blocked, false);
  assert.ok(result.position.z < -1.5, `doorway stopped movement at z=${result.position.z}`);
});

test('the same cottage front remains solid beside the doorway', () => {
  const { motor } = fixture();
  const result = motor.move({
    start: { x: 1.2, y: 0, z: 0.4 },
    displacement: { x: 0, z: -2.2 },
    grounded: true,
  });

  assert.equal(result.blocked, true);
  assert.ok(result.position.z > -0.5, `front wall was crossed at z=${result.position.z}`);
  assert.ok(result.contacts.some((contact) => contact.sourceId.includes('wall-front-left')));
});
