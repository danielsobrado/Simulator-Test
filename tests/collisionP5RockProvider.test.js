import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry } from 'three';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { COLLIDER_TYPE_MESH_INSTANCE } from '../src/editor/collision/colliders/ColliderRecords.js';
import { RockCollisionProvider } from '../src/editor/collision/providers/RockCollisionProvider.js';
import { createRockCollisionSource } from '../src/editor/collision/providers/RockCollisionSource.js';

const CONFIG = Object.freeze({
  minimumCollidableHeight: 0.3,
  minimumCollidableWidth: 0.4,
  minimumWalkableHeight: 0.7,
  minimumWalkableWidth: 1.2,
  maximumProxyTriangles: 96,
  bvhMaxLeafTriangles: 4,
  minimumProxyOverlapRatio: 0.35,
  allowGeneratedProxyFallback: true,
  requireAuthoredProxy: false,
  prototypeOverrides: Object.freeze({
    'prototype:0': Object.freeze({ tier: 'walkable' }),
  }),
});

function rockView() {
  const geometry = new BoxGeometry(3, 1.5, 2);
  geometry.translate(0, 0.75, 0);
  const placement = Object.freeze({
    stableId: 'large-rock',
    x: 8,
    height: 4,
    z: 9,
    scale: 1.5,
    rotationY: Math.PI / 3,
    prototypeIndex: 0,
    ownerChunkX: 0,
    ownerChunkZ: 0,
  });
  return {
    prototypes: [{ geometry }],
    prototypeHeights: [1.5],
    prototypeIndicesByAsset: new Map(),
    prototypeRevision: 1,
    revisionTracker: { revision: 1 },
    config: { rocks: { burial: 0.1 } },
    manifestForChunk: () => Object.freeze([placement]),
  };
}

test('walkable rocks emit one mesh instance and share one prototype BVH', () => {
  const view = rockView();
  const source = createRockCollisionSource({ rockView: view, config: CONFIG });
  const provider = new RockCollisionProvider({ source, config: CONFIG });
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  provider.attachWorld(world);

  const first = provider.buildChunkData(0, 0);
  assert.equal(first.colliders.length, 1);
  assert.equal(first.colliders[0].type, COLLIDER_TYPE_MESH_INSTANCE);
  assert.equal(first.stats.walkable, 1);
  assert.equal(first.stats.walkablePending, 0);
  assert.equal(first.stats.generatedProxies, 1);
  assert.equal(world.getStatus().prototypes, 1);

  const second = provider.buildChunkData(0, 0);
  assert.equal(second.colliders[0].prototypeId, first.colliders[0].prototypeId);
  assert.equal(world.getStatus().prototypes, 1);
  assert.equal(provider.getStatus().meshPrototypes.count, 1);

  provider.dispose();
  view.prototypes[0].geometry.dispose();
});

test('authored-only mode rejects a walkable visual without a proxy', () => {
  const view = rockView();
  const config = Object.freeze({
    ...CONFIG,
    allowGeneratedProxyFallback: false,
    requireAuthoredProxy: true,
  });
  const source = createRockCollisionSource({ rockView: view, config });
  const provider = new RockCollisionProvider({ source, config });
  provider.attachWorld(new CollisionWorld({ chunkWorldSize: 128, binSize: 16 }));
  assert.throws(() => provider.buildChunkData(0, 0), /COLLIDER_WALKABLE/);
  provider.dispose();
  view.prototypes[0].geometry.dispose();
});
