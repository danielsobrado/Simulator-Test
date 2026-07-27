import assert from 'node:assert/strict';
import test from 'node:test';
import { createCharacterCapsule } from '../src/editor/collision/character/CharacterCapsule.js';
import { findPrimitiveSideContact } from '../src/editor/collision/character/CharacterContacts.js';
import { createCanonicalAabb } from '../src/editor/collision/colliders/ColliderBounds.js';
import {
  COLLIDER_TYPE_SPHERE,
  createPrimitiveCollider,
} from '../src/editor/collision/colliders/ColliderRecords.js';

function ellipsoid(rotationY) {
  return createPrimitiveCollider({
    sourceId: `rock:${rotationY}`,
    type: COLLIDER_TYPE_SPHERE,
    ownerChunkX: 0,
    ownerChunkZ: 0,
    aabb: createCanonicalAabb({
      minX: -2.5,
      maxX: 2.5,
      minY: 0,
      maxY: 2,
      minZ: -2.5,
      maxZ: 2.5,
    }),
    position: [0, 1, 0],
    rotationY,
    dimensions: [2, 1, 0.5],
    prototypeId: 'rock-tier-blocking:test:ellipsoid',
  });
}

function capsule(x, z) {
  return createCharacterCapsule({ x, y: 0, z, radius: 0.35, bodyHeight: 1.8 });
}

test('ellipsoid side contact respects Y rotation and both horizontal radii', () => {
  const unrotated = ellipsoid(0);
  assert.ok(findPrimitiveSideContact(capsule(2.1, 0), unrotated, 0.03, {}));
  assert.equal(findPrimitiveSideContact(capsule(0, 1), unrotated, 0.03, {}), null);

  const rotated = ellipsoid(Math.PI / 2);
  assert.equal(findPrimitiveSideContact(capsule(2.1, 0), rotated, 0.03, {}), null);
  const contact = findPrimitiveSideContact(capsule(0, 2.1), rotated, 0.03, {});
  assert.ok(contact);
  assert.ok(contact.normalZ > 0.9);
});

test('ellipsoid vertical cross-section allows a capsule to clear its top', () => {
  const collider = ellipsoid(0);
  const above = createCharacterCapsule({
    x: 0,
    y: 2.1,
    z: 0,
    radius: 0.35,
    bodyHeight: 1.8,
  });
  assert.equal(findPrimitiveSideContact(above, collider, 0.03, {}), null);
});
