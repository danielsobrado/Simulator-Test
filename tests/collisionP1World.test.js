import assert from 'node:assert/strict';
import test from 'node:test';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { COLLISION_LAYERS } from '../src/editor/collision/CollisionLayers.js';
import {
  COLLIDER_TYPE_BOX,
  createPrimitiveCollider,
} from '../src/editor/collision/colliders/ColliderRecords.js';
import { createCanonicalAabb } from '../src/editor/collision/colliders/ColliderBounds.js';
import { FloatingOrigin } from '../src/editor/world/FloatingOrigin.js';

function box({ sourceId, ownerChunkX, ownerChunkZ, minX, maxX, minZ, maxZ }) {
  return createPrimitiveCollider({
    sourceId,
    type: COLLIDER_TYPE_BOX,
    layers: COLLISION_LAYERS.blocking,
    ownerChunkX,
    ownerChunkZ,
    aabb: createCanonicalAabb({ minX, maxX, minY: 0, maxY: 3, minZ, maxZ }),
    position: [(minX + maxX) / 2, 0, (minZ + maxZ) / 2],
    rotationY: 0,
    dimensions: [maxX - minX, 3, maxZ - minZ],
  });
}

function queryBounds(minX, maxX, minZ, maxZ) {
  return createCanonicalAabb({ minX, maxX, minY: 0, maxY: 2, minZ, maxZ });
}

test('cross-boundary colliders are referenced from both chunks and returned once', () => {
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  const crossing = box({
    sourceId: 'qa:crossing',
    ownerChunkX: 0,
    ownerChunkZ: 0,
    minX: 125,
    maxX: 129,
    minZ: -12,
    maxZ: -8,
  });
  world.replaceOwnerChunk({ chunkX: 0, chunkZ: 0, revision: 1, colliders: [crossing] });
  assert.equal(world.chunks.has('0:0'), true);
  assert.equal(world.chunks.has('1:0'), true);
  assert.equal(world.isCollisionChunkReady(1, 0), false, 'a reference is not owner readiness');

  world.replaceOwnerChunk({ chunkX: 1, chunkZ: 0, revision: 1, colliders: [] });
  assert.equal(world.isCollisionChunkReady(1, 0), true);
  const candidates = world.collectCandidates(queryBounds(126, 130, -13, -7));
  assert.deepEqual(candidates.map((entry) => entry.sourceId), ['qa:crossing']);
});

test('failed atomic replacement retains the previous valid collision data', () => {
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  const previous = box({
    sourceId: 'qa:previous',
    ownerChunkX: 0,
    ownerChunkZ: 0,
    minX: 4,
    maxX: 8,
    minZ: -8,
    maxZ: -4,
  });
  const elsewhere = box({
    sourceId: 'qa:elsewhere',
    ownerChunkX: 1,
    ownerChunkZ: 0,
    minX: 132,
    maxX: 136,
    minZ: -8,
    maxZ: -4,
  });
  world.replaceOwnerChunk({ chunkX: 0, chunkZ: 0, revision: 1, colliders: [previous] });
  world.replaceOwnerChunk({ chunkX: 1, chunkZ: 0, revision: 1, colliders: [elsewhere] });
  const duplicate = box({
    sourceId: 'qa:elsewhere',
    ownerChunkX: 0,
    ownerChunkZ: 0,
    minX: 10,
    maxX: 12,
    minZ: -12,
    maxZ: -10,
  });
  assert.throws(
    () => world.replaceOwnerChunk({ chunkX: 0, chunkZ: 0, revision: 2, colliders: [duplicate] }),
    /already owned elsewhere/,
  );
  assert.equal(world.getCollider('qa:previous'), previous);
  assert.deepEqual(
    world.collectCandidates(queryBounds(3, 9, -9, -3)).map((entry) => entry.sourceId),
    ['qa:previous'],
  );
});

test('negative canonical chunks, unloading, and floating origin remain deterministic', () => {
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  const negative = box({
    sourceId: 'qa:negative',
    ownerChunkX: -1,
    ownerChunkZ: -1,
    minX: -12,
    maxX: -8,
    minZ: 8,
    maxZ: 12,
  });
  world.replaceOwnerChunk({ chunkX: -1, chunkZ: -1, revision: 1, colliders: [negative] });
  const origin = new FloatingOrigin({ threshold: 100, snapSize: 128 });
  origin.setOrigin(4096, -2048);
  assert.deepEqual(
    world.collectCandidates(queryBounds(-13, -7, 7, 13)).map((entry) => entry.sourceId),
    ['qa:negative'],
  );
  assert.deepEqual(origin.toRender(-10, 10), { x: -4106, z: 2058 });
  assert.equal(world.getCollider('qa:negative').position[0], -10);
  world.unloadOwnerChunk(-1, -1);
  assert.equal(world.getCollider('qa:negative'), null);
  assert.equal(world.collectCandidates(queryBounds(-13, -7, 7, 13)).length, 0);
});
