import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCollisionSourceId,
  parseCollisionChunkKey,
} from '../src/editor/collision/CollisionIds.js';
import { COLLISION_LAYERS } from '../src/editor/collision/CollisionLayers.js';
import { collisionChunkForCanonical } from '../src/editor/collision/colliders/ColliderBounds.js';
import {
  COLLIDER_TYPE_BOX,
  createColliderPrototype,
  createMeshInstanceCollider,
  createPrimitiveCollider,
} from '../src/editor/collision/colliders/ColliderRecords.js';

const BOUNDS = Object.freeze({
  minX: 0,
  minY: 0,
  minZ: -2,
  maxX: 2,
  maxY: 3,
  maxZ: 0,
});

function primitive(overrides = {}) {
  return createPrimitiveCollider({
    sourceId: 'object:1',
    type: COLLIDER_TYPE_BOX,
    layers: COLLISION_LAYERS.solid,
    ownerChunkX: 0,
    ownerChunkZ: 0,
    aabb: BOUNDS,
    position: [1, 0, -1],
    rotationY: Math.PI / 2,
    dimensions: [2, 3, 2],
    ...overrides,
  });
}

test('collision source ids are stable and encode manifest separators', () => {
  assert.equal(createCollisionSourceId('tree', 42, 'trunk'), 'tree:42:trunk');
  assert.equal(createCollisionSourceId('qa', 'wall-corner'), 'qa:wall-corner');
  assert.equal(
    createCollisionSourceId('tree', 'planted:42', 'lower trunk'),
    'tree:planted%3A42:lower%20trunk',
  );
  assert.throws(() => createCollisionSourceId('tree', ''), /must not be empty/);
});

test('chunk coordinates and keys reject values outside the safe integer range', () => {
  assert.deepEqual(parseCollisionChunkKey('-12:34'), { chunkX: -12, chunkZ: 34 });
  assert.throws(
    () => parseCollisionChunkKey('9007199254740992:0'),
    /safe integer range/,
  );
  assert.throws(
    () => collisionChunkForCanonical(Number.MAX_VALUE, 0, 128),
    /safe integer range/,
  );
});

test('primitive records and canonical bounds are deeply immutable', () => {
  const collider = primitive();
  assert.equal(Object.isFrozen(collider), true);
  assert.equal(Object.isFrozen(collider.aabb), true);
  assert.equal(Object.isFrozen(collider.position), true);
  assert.throws(() => { collider.position[0] = 9; }, TypeError);
});

test('primitive records reject invalid dimensions and layer bits', () => {
  assert.throws(() => primitive({ dimensions: [2, 0, 2] }), /positive finite/);
  assert.throws(() => primitive({ dimensions: [2, -1, 2] }), /positive finite/);
  assert.throws(() => primitive({ layers: 1 << 8 }), /supported collision-layer bits/);
  assert.throws(() => primitive({ layers: Number.MAX_SAFE_INTEGER }), /supported collision-layer bits/);
});

test('mesh instances reference prototype resources without embedding them', () => {
  const prototype = createColliderPrototype({
    id: 'rock-large',
    kind: 'mesh',
    bounds: BOUNDS,
    metadata: { triangles: 64 },
  });
  const collider = createMeshInstanceCollider({
    sourceId: 'rock:7',
    ownerChunkX: 0,
    ownerChunkZ: 0,
    aabb: BOUNDS,
    prototypeId: prototype.id,
    transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  });
  assert.equal(collider.prototypeId, prototype.id);
  assert.equal('metadata' in collider, false);
  assert.equal(Object.isFrozen(prototype.metadata), true);
});
