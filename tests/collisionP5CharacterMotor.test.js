import assert from 'node:assert/strict';
import test from 'node:test';
import { BoxGeometry } from 'three';
import { CharacterMotor } from '../src/editor/collision/character/CharacterMotor.js';
import { CollisionWorld } from '../src/editor/collision/CollisionWorld.js';
import { COLLISION_LAYERS } from '../src/editor/collision/CollisionLayers.js';
import { createSweptCapsuleAabb } from '../src/editor/collision/colliders/ColliderBounds.js';
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
  const geometry = new BoxGeometry(4, 2, 4);
  geometry.translate(0, 1, 0);
  const prototype = createMeshColliderPrototype({
    id: 'rock:motor',
    geometry,
    maximumTriangles: 12,
  });
  geometry.dispose();
  const transform = composeUniformTransform({ x: 0, y: 0, z: 0, rotationY: 0, scale: 1 });
  const instance = createMeshInstanceTransform(transform);
  const collider = createMeshInstanceCollider({
    sourceId: 'rock:motor:walkable',
    layers: COLLISION_LAYERS.solid,
    ownerChunkX: 0,
    ownerChunkZ: 0,
    aabb: transformPrototypeBounds(prototype.bounds, instance.matrix),
    prototypeId: prototype.id,
    transform,
  });
  const world = new CollisionWorld({ chunkWorldSize: 128, binSize: 16 });
  world.registerPrototype(prototype);
  world.replaceOwnerChunk({ chunkX: 0, chunkZ: 0, revision: 1, colliders: [collider] });
  const runtime = {
    querySweptCapsule({ start, end, radius, bodyHeight, layers, out }) {
      return world.collectCandidates(
        createSweptCapsuleAabb({ start, end, radius, bodyHeight }),
        layers,
        out,
      );
    },
    checkMovementReadiness: () => Object.freeze({ ready: true, missing: Object.freeze([]) }),
    findMeshSideContact(capsule, record, skinWidth, out) {
      return findMeshSideContact({ capsule, collider: record, prototype, skinWidth, out });
    },
    findMeshTopSupport(options) {
      return findMeshTopSupport({ ...options, prototype });
    },
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
      maxSubstepDistance: 0.25,
      maxIterations: 6,
    }),
    stepHeight: 1.1,
    groundSnapDistance: 0.6,
  });
  return { motor, prototype };
}

test('a tall rock side blocks without teleporting the player onto the top', () => {
  const { motor, prototype } = fixture();
  const result = motor.move({
    start: { x: 0, y: 0, z: -3 },
    displacement: { x: 0, z: 2 },
    grounded: true,
  });
  assert.equal(result.blocked, true);
  assert.equal(result.stepped, false);
  assert.equal(result.supportSourceId, 'terrain');
  assert.ok(result.position.z < -2.2);
  prototype.resource.dispose();
});

test('the motor retains walkable mesh support across a rock top', () => {
  const { motor, prototype } = fixture();
  const result = motor.move({
    start: { x: -0.5, y: 2, z: 0 },
    displacement: { x: 1, z: 0 },
    grounded: true,
  });
  assert.equal(result.ready, true);
  assert.equal(result.supportSourceId, 'rock:motor:walkable');
  assert.ok(Math.abs(result.supportHeight - 2) < 1e-5);
  assert.ok(result.supportNormal.y > 0.99);
  prototype.resource.dispose();
});

test('airborne support search captures a descending rock landing', () => {
  const { motor, prototype } = fixture();
  const result = motor.move({
    start: { x: 0, y: 2.8, z: 0 },
    displacement: { x: 0, z: 0 },
    grounded: false,
    allowStep: false,
    supportDownDistance: 1,
  });
  assert.equal(result.supportSourceId, 'rock:motor:walkable');
  assert.ok(Math.abs(result.supportHeight - 2) < 1e-5);
  prototype.resource.dispose();
});
