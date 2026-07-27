import assert from 'node:assert/strict';
import test from 'node:test';
import { COLLISION_LAYERS } from '../src/editor/collision/CollisionLayers.js';
import { createCharacterCapsule } from '../src/editor/collision/character/CharacterCapsule.js';
import {
  capsuleOverlapsPrimitive,
  findPrimitiveSideContact,
  findPrimitiveTopSupport,
} from '../src/editor/collision/character/CharacterContacts.js';
import {
  COLLIDER_TYPE_BOX,
  COLLIDER_TYPE_CAPSULE,
  COLLIDER_TYPE_SPHERE,
  createPrimitiveCollider,
} from '../src/editor/collision/colliders/ColliderRecords.js';

function primitive({
  sourceId,
  type,
  position,
  dimensions,
  aabb,
  rotationY = 0,
  layers = COLLISION_LAYERS.solid,
}) {
  return createPrimitiveCollider({
    sourceId,
    type,
    ownerChunkX: 0,
    ownerChunkZ: 0,
    position,
    dimensions,
    rotationY,
    layers,
    aabb,
  });
}

test('capsule resolves a vertical box wall with a stable horizontal normal', () => {
  const wall = primitive({
    sourceId: 'qa:wall',
    type: COLLIDER_TYPE_BOX,
    position: [0, 1.5, 0],
    dimensions: [2, 3, 8],
    aabb: { minX: -1, maxX: 1, minY: 0, maxY: 3, minZ: -4, maxZ: 4 },
  });
  const capsule = createCharacterCapsule({
    x: 1.2,
    y: 0,
    z: 0,
    radius: 0.35,
    bodyHeight: 1.8,
  });
  const contact = findPrimitiveSideContact(capsule, wall, 0.03);
  assert.ok(contact);
  assert.ok(Math.abs(contact.depth - 0.18) < 1e-6);
  assert.deepEqual(
    { x: contact.normalX, y: contact.normalY, z: contact.normalZ },
    { x: 1, y: 0, z: 0 },
  );
});

test('rotated boxes return world-space side normals', () => {
  const wall = primitive({
    sourceId: 'qa:rotated',
    type: COLLIDER_TYPE_BOX,
    position: [0, 1.5, 0],
    dimensions: [2, 3, 8],
    rotationY: Math.PI / 2,
    aabb: { minX: -4, maxX: 4, minY: 0, maxY: 3, minZ: -1, maxZ: 1 },
  });
  const capsule = createCharacterCapsule({
    x: 0,
    y: 0,
    z: 1.2,
    radius: 0.35,
    bodyHeight: 1.8,
  });
  const contact = findPrimitiveSideContact(capsule, wall, 0.03);
  assert.ok(contact);
  assert.ok(contact.normalZ > 0.999);
  assert.ok(Math.abs(contact.normalX) < 1e-8);
});

test('sphere and vertical capsule blockers use their canonical vertical bounds', () => {
  const sphere = primitive({
    sourceId: 'qa:sphere',
    type: COLLIDER_TYPE_SPHERE,
    position: [0, 1, 0],
    dimensions: [1, 1, 1],
    aabb: { minX: -1, maxX: 1, minY: 0, maxY: 2, minZ: -1, maxZ: 1 },
  });
  const trunk = primitive({
    sourceId: 'qa:trunk',
    type: COLLIDER_TYPE_CAPSULE,
    position: [4, 0, 0],
    dimensions: [0.5, 5, 0.5],
    aabb: { minX: 3.5, maxX: 4.5, minY: 0, maxY: 5, minZ: -0.5, maxZ: 0.5 },
  });
  const sphereCapsule = createCharacterCapsule({
    x: 1.2,
    y: 0,
    z: 0,
    radius: 0.35,
    bodyHeight: 1.8,
  });
  const trunkCapsule = createCharacterCapsule({
    x: 4.7,
    y: 0,
    z: 0,
    radius: 0.35,
    bodyHeight: 1.8,
  });
  assert.equal(capsuleOverlapsPrimitive(sphereCapsule, sphere, 0.03), true);
  assert.equal(capsuleOverlapsPrimitive(trunkCapsule, trunk, 0.03), true);
});

test('box tops are support surfaces without becoming side contacts while standing', () => {
  const step = primitive({
    sourceId: 'qa:step',
    type: COLLIDER_TYPE_BOX,
    position: [0, 0.4, 0],
    dimensions: [3, 0.8, 3],
    aabb: { minX: -1.5, maxX: 1.5, minY: 0, maxY: 0.8, minZ: -1.5, maxZ: 1.5 },
  });
  const capsule = createCharacterCapsule({
    x: 0,
    y: 0.8,
    z: 0,
    radius: 0.35,
    bodyHeight: 1.8,
  });
  assert.equal(findPrimitiveSideContact(capsule, step, 0.03), null);
  const support = findPrimitiveTopSupport({
    x: 0,
    z: 0,
    radius: capsule.radius,
    collider: step,
    maximumSlopeCosine: 0.5,
  });
  assert.equal(support.height, 0.8);
  assert.equal(support.sourceId, 'qa:step');
});

test('non-walkable primitive layers never become support', () => {
  const blocker = primitive({
    sourceId: 'qa:blocker',
    type: COLLIDER_TYPE_BOX,
    layers: COLLISION_LAYERS.blocking,
    position: [0, 0.4, 0],
    dimensions: [3, 0.8, 3],
    aabb: { minX: -1.5, maxX: 1.5, minY: 0, maxY: 0.8, minZ: -1.5, maxZ: 1.5 },
  });
  assert.equal(findPrimitiveTopSupport({
    x: 0,
    z: 0,
    radius: 0.35,
    collider: blocker,
    maximumSlopeCosine: 0.5,
  }), null);
});

test('sphere side contacts respect rounded vertical separation', () => {
  const sphere = primitive({
    sourceId: 'qa:high-sphere',
    type: COLLIDER_TYPE_SPHERE,
    position: [0, 2.7, 0],
    dimensions: [1, 1, 1],
    aabb: { minX: -1, maxX: 1, minY: 1.7, maxY: 3.7, minZ: -1, maxZ: 1 },
  });
  const capsule = createCharacterCapsule({
    x: 1.2,
    y: 0,
    z: 0,
    radius: 0.35,
    bodyHeight: 1.8,
  });
  assert.equal(findPrimitiveSideContact(capsule, sphere, 0.03), null);
});

test('narrow primitive tops cannot support the full character capsule', () => {
  const narrow = primitive({
    sourceId: 'qa:narrow',
    type: COLLIDER_TYPE_BOX,
    position: [0, 0.4, 0],
    dimensions: [0.5, 0.8, 3],
    aabb: { minX: -0.25, maxX: 0.25, minY: 0, maxY: 0.8, minZ: -1.5, maxZ: 1.5 },
  });
  assert.equal(findPrimitiveTopSupport({
    x: 0,
    z: 0,
    radius: 0.35,
    collider: narrow,
    maximumSlopeCosine: 0.5,
  }), null);
});
