import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry } from 'three';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { COLLISION_LAYERS } from '../src/editor/collision/CollisionLayers.js';
import { createCharacterCapsule } from '../src/editor/collision/character/CharacterCapsule.js';
import { createMeshInstanceCollider } from '../src/editor/collision/colliders/ColliderRecords.js';
import { createMeshColliderPrototype } from '../src/editor/collision/mesh/MeshColliderPrototype.js';
import {
  composeUniformTransform,
  createMeshInstanceTransform,
  transformPrototypeBounds,
} from '../src/editor/collision/mesh/MeshInstanceTransform.js';
import {
  findMeshSideContact,
  findMeshTopSupport,
} from '../src/editor/collision/mesh/MeshCapsuleQuery.js';

function fixture() {
  const geometry = new BoxGeometry(4, 1, 4);
  geometry.translate(0, 0.5, 0);
  const prototype = createMeshColliderPrototype({
    id: 'rock:test',
    geometry,
    maximumTriangles: 12,
    maxLeafTriangles: 2,
    metadata: { generated: false },
  });
  geometry.dispose();
  const transform = composeUniformTransform({
    x: 10,
    y: 0,
    z: -5,
    rotationY: Math.PI / 2,
    scale: 2,
  });
  const instance = createMeshInstanceTransform(transform);
  const collider = createMeshInstanceCollider({
    sourceId: 'rock:test:walkable',
    layers: COLLISION_LAYERS.solid,
    ownerChunkX: 0,
    ownerChunkZ: 0,
    aabb: transformPrototypeBounds(prototype.bounds, instance.matrix),
    prototypeId: prototype.id,
    transform,
  });
  return { prototype, collider };
}

test('mesh BVH prototype is shared by every registered instance', () => {
  const { prototype } = fixture();
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  assert.equal(world.registerPrototype(prototype), prototype);
  assert.equal(world.registerPrototype(prototype), prototype);
  assert.equal(world.getPrototype(prototype.id), prototype);
  assert.equal(prototype.resource.triangleCount, 12);
  prototype.resource.dispose();
});

test('rotated scaled mesh instance produces a horizontal side contact', () => {
  const { prototype, collider } = fixture();
  const capsule = createCharacterCapsule({
    x: 10,
    y: 0,
    z: -9.25,
    radius: 0.5,
    bodyHeight: 1.8,
  });
  const contact = findMeshSideContact({
    capsule,
    collider,
    prototype,
    skinWidth: 0.03,
  });
  assert.ok(contact);
  assert.equal(contact.sourceId, collider.sourceId);
  assert.ok(contact.depth > 0);
  assert.ok(contact.normalZ < -0.9);
  prototype.resource.dispose();
});

test('mesh support returns the top and rejects the underside', () => {
  const { prototype, collider } = fixture();
  const support = findMeshTopSupport({
    x: 10,
    z: -5,
    radius: 0.35,
    referenceY: 2.2,
    maximumUp: 0,
    maximumDown: 0.5,
    maximumSlopeCosine: Math.cos(50 * Math.PI / 180),
    collider,
    prototype,
  });
  assert.ok(support);
  assert.ok(Math.abs(support.height - 2) < 1e-5);
  assert.ok(support.normal.y > 0.99);

  const below = findMeshTopSupport({
    x: 10,
    z: -5,
    radius: 0.35,
    referenceY: -0.2,
    maximumUp: 0.3,
    maximumDown: 0.3,
    maximumSlopeCosine: 0.5,
    collider,
    prototype,
  });
  assert.equal(below, null);
  prototype.resource.dispose();
});
