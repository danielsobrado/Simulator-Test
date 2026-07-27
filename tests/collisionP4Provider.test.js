import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { COLLISION_LAYERS } from '../src/editor/collision/CollisionLayers.js';
import {
  COLLIDER_TYPE_MESH_INSTANCE,
  COLLIDER_TYPE_SPHERE,
  createColliderPrototype,
} from '../src/editor/collision/colliders/ColliderRecords.js';
import { RockCollisionProvider } from '../src/editor/collision/providers/RockCollisionProvider.js';

function placement(overrides = {}) {
  return Object.freeze({
    stableId: 'rock:0:0:7',
    ownerChunkX: 0,
    ownerChunkZ: 0,
    x: 10,
    z: 20,
    height: 5,
    scale: 2,
    rotationY: Math.PI / 2,
    prototypeIndex: 0,
    ...overrides,
  });
}

function profile(overrides = {}) {
  return Object.freeze({
    id: 'assets/rocks/ridge.glb',
    prototypeIndex: 0,
    width: 2,
    height: 1,
    depth: 1,
    shape: 'ellipsoid',
    forcedTier: null,
    parts: Object.freeze([Object.freeze({
      type: 'ellipsoid',
      centerX: 1,
      centerY: 0.5,
      centerZ: 0,
      radiusX: 1,
      radiusY: 0.5,
      radiusZ: 0.5,
    })]),
    ...overrides,
  });
}

const config = Object.freeze({
  minimumCollidableHeight: 0.3,
  minimumCollidableWidth: 0.4,
  minimumWalkableHeight: 3,
  minimumWalkableWidth: 3,
  maximumProxyTriangles: 96,
  bvhMaxLeafTriangles: 4,
  minimumProxyOverlapRatio: 0.35,
  allowGeneratedProxyFallback: true,
  requireAuthoredProxy: false,
  prototypeOverrides: Object.freeze({}),
});

function meshPrototype(world) {
  const prototype = createColliderPrototype({
    id: 'rock-walkable:test',
    kind: 'mesh-bvh',
    bounds: { minX: -1, minY: 0, minZ: -0.5, maxX: 1, maxY: 1, maxZ: 0.5 },
    metadata: { generated: false, triangleCount: 8 },
    resource: { triangleCount: 8, dispose() {} },
  });
  return world.registerPrototype(prototype);
}

function providerFor({ placements, profiles = [profile()], burial = 0.4, nextConfig = config }) {
  const frozenProfiles = Object.freeze(profiles);
  const source = Object.freeze({
    descriptor: Object.freeze({ id: 'production-rock-collision' }),
    getProfiles: () => frozenProfiles,
    getCachedProfileCount: () => frozenProfiles.length,
    getProfileSignature: () => 'profiles:1',
    getMeshPrototype: (_index, world) => meshPrototype(world),
    getMeshPrototypeStatus: () => Object.freeze({ count: 1, triangles: 8, generated: 0 }),
    epoch: () => 'epoch:1',
    resolvePrototypeIndex: (record) => record.prototypeIndex,
    burialFor: () => burial,
    snapshotChunk: (chunkX, chunkZ) => Object.freeze({
      chunkX,
      chunkZ,
      signature: 'manifest:1',
      placements: Object.freeze(placements),
    }),
    dispose() {},
  });
  return new RockCollisionProvider({ source, config: nextConfig });
}

test('rock ellipsoid preserves rendering burial, scale, rotation, and stable ID', () => {
  const provider = providerFor({ placements: [placement()] });
  const built = provider.buildChunkData(0, 0);
  assert.equal(built.colliders.length, 1);
  const collider = built.colliders[0];

  assert.equal(collider.type, COLLIDER_TYPE_SPHERE);
  assert.equal(collider.layers, COLLISION_LAYERS.blocking);
  assert.equal(collider.sourceId, 'rock:rock%3A0%3A0%3A7:primitive-0');
  assert.deepEqual(collider.position, [10, 5.6, 18]);
  assert.deepEqual(collider.dimensions, [2, 1, 1]);
  assert.ok(Math.abs(collider.aabb.minX - 9) < 1e-12);
  assert.ok(Math.abs(collider.aabb.maxX - 11) < 1e-12);
  assert.ok(Math.abs(collider.aabb.minZ - 16) < 1e-12);
  assert.ok(Math.abs(collider.aabb.maxZ - 20) < 1e-12);
  assert.equal(built.stats.blocking, 1);
  assert.equal(built.stats.decorative, 0);
});

test('decorative rocks generate no solid collider', () => {
  const provider = providerFor({ placements: [placement({ scale: 0.1 })] });
  const built = provider.buildChunkData(0, 0);
  assert.equal(built.colliders.length, 0);
  assert.equal(built.stats.decorative, 1);
  assert.equal(built.stats.blocking, 0);
});

test('walkable-class rocks emit a solid mesh instance instead of the P4 fallback', () => {
  const provider = providerFor({
    placements: [placement()],
    nextConfig: {
      ...config,
      minimumWalkableHeight: 0.7,
      minimumWalkableWidth: 1.2,
    },
  });
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  provider.attachWorld(world);
  const built = provider.buildChunkData(0, 0);
  assert.equal(built.stats.walkable, 1);
  assert.equal(built.stats.walkablePending, 0);
  assert.equal(built.colliders[0].type, COLLIDER_TYPE_MESH_INSTANCE);
  assert.equal(built.colliders[0].layers, COLLISION_LAYERS.solid);
  assert.equal(world.getStatus().prototypes, 1);
});

test('compound profiles emit deterministic per-part source IDs', () => {
  const compound = profile({
    shape: 'compound',
    parts: Object.freeze([
      Object.freeze({
        type: 'ellipsoid', centerX: -0.5, centerY: 0.5, centerZ: 0,
        radiusX: 1, radiusY: 0.5, radiusZ: 0.5,
      }),
      Object.freeze({
        type: 'ellipsoid', centerX: 0.5, centerY: 0.5, centerZ: 0,
        radiusX: 1, radiusY: 0.5, radiusZ: 0.5,
      }),
    ]),
  });
  const provider = providerFor({ placements: [placement()], profiles: [compound] });
  const colliders = provider.buildChunkData(0, 0).colliders;
  assert.deepEqual(colliders.map((collider) => collider.sourceId), [
    'rock:rock%3A0%3A0%3A7:primitive-0',
    'rock:rock%3A0%3A0%3A7:primitive-1',
  ]);
});
