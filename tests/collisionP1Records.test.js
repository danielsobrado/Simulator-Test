import assert from 'node:assert/strict';
import test from 'node:test';
import { createCollisionSourceId } from '../src/editor/collision/CollisionIds.js';
import { COLLISION_LAYERS } from '../src/editor/collision/CollisionLayers.js';
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

test('collision source ids are stable and encode manifest separators', () => {
  assert.equal(createCollisionSourceId('tree', 42, 'trunk'), 'tree:42:trunk');
  assert.equal(createCollisionSourceId('qa', 'wall-corner'), 'qa:wall-corner');
  assert.equal(
    createCollisionSourceId('tree', 'planted:42', 'lower trunk'),
    'tree:planted%3A42:lower%20trunk',
  );
  assert.throws(() => createCollisionSourceId('tree', ''), /must not be empty/);
});

test('primitive records and canonical bounds are deeply immutable', () => {
  const collider = createPrimitiveCollider({
    sourceId: 'object:1',
    type: COLLIDER_TYPE_BOX,
    layers: COLLISION_LAYERS.solid,
    ownerChunkX: 0,
    ownerChunkZ: 0,
    aabb: BOUNDS,
    position: [1, 0, -1],
    rotationY: Math.PI / 2,
    dimensions: [2, 3, 2],
  });
  assert.equal(Object.isFrozen(collider), true);
  assert.equal(Object.isFrozen(collider.aabb), true);
  assert.equal(Object.isFrozen(collider.position), true);
  assert.throws(() => { collider.position[0] = 9; }, TypeError);
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
