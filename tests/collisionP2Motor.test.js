import assert from 'node:assert/strict';
import test from 'node:test';
import { CharacterMotor } from '../src/editor/collision/character/CharacterMotor.js';
import { TerrainCollisionProvider } from '../src/editor/collision/providers/TerrainCollisionProvider.js';
import { COLLISION_LAYERS } from '../src/editor/collision/CollisionLayers.js';
import {
  COLLIDER_TYPE_BOX,
  createPrimitiveCollider,
} from '../src/editor/collision/colliders/ColliderRecords.js';

const MOTOR_CONFIG = Object.freeze({
  radius: 0.35,
  bodyHeight: 1.8,
  skinWidth: 0.03,
  maxSlopeDegrees: 50,
  maxSubstepDistance: 0.35,
  maxIterations: 4,
});

function box({ sourceId, x, y, z, width, height, depth, layers = COLLISION_LAYERS.solid }) {
  return createPrimitiveCollider({
    sourceId,
    type: COLLIDER_TYPE_BOX,
    layers,
    ownerChunkX: 0,
    ownerChunkZ: 0,
    position: [x, y + height / 2, z],
    dimensions: [width, height, depth],
    aabb: {
      minX: x - width / 2,
      maxX: x + width / 2,
      minY: y,
      maxY: y + height,
      minZ: z - depth / 2,
      maxZ: z + depth / 2,
    },
  });
}

function createHarness({ colliders = [], ready = true, getHeight = () => 0, config = MOTOR_CONFIG } = {}) {
  const runtime = {
    checkMovementReadiness: () => Object.freeze({
      ready,
      missing: ready ? Object.freeze([]) : Object.freeze(['0:0']),
      truncated: false,
      policy: 'retain-previous-valid-position',
    }),
    querySweptCapsule: ({ out = [] }) => {
      out.length = 0;
      out.push(...colliders);
      return out;
    },
  };
  const terrainProvider = new TerrainCollisionProvider({ getHeight, sampleDistance: config.radius });
  const motor = new CharacterMotor({
    collisionRuntime: runtime,
    terrainProvider,
    config,
    stepHeight: 1.1,
    groundSnapDistance: 0.6,
  });
  motor.reset({ x: 0, y: 0, z: 0 });
  return { motor, runtime, terrainProvider };
}

test('maximum-speed displacement cannot tunnel through a thin wall', () => {
  const wall = box({ sourceId: 'qa:wall', x: 2, y: 0, z: 0, width: 0.2, height: 3, depth: 20 });
  const { motor } = createHarness({ colliders: [wall] });
  const result = motor.move({
    start: { x: 0, y: 0, z: 0 },
    displacement: { x: 8, z: 0 },
    grounded: true,
  });
  assert.equal(result.ready, true);
  assert.equal(result.blocked, true);
  assert.ok(result.position.x <= 1.52, `wall penetration at x=${result.position.x}`);
  assert.deepEqual(result.contacts, ['qa:wall']);
  assert.ok(result.substeps > 1);
});

test('diagonal movement slides along a long wall', () => {
  const wall = box({ sourceId: 'qa:wall', x: 2, y: 0, z: 0, width: 0.2, height: 3, depth: 20 });
  const { motor } = createHarness({ colliders: [wall] });
  const result = motor.move({
    start: { x: 0, y: 0, z: 0 },
    displacement: { x: 4, z: 3 },
    grounded: true,
  });
  assert.ok(result.position.x <= 1.52);
  assert.ok(result.position.z > 2.5, `expected wall slide, z=${result.position.z}`);
});

test('inside corners resolve deterministically without unbounded iterations', () => {
  const colliders = [
    box({ sourceId: 'qa:wall-x', x: 2, y: 0, z: 0, width: 0.2, height: 3, depth: 20 }),
    box({ sourceId: 'qa:wall-z', x: 0, y: 0, z: 2, width: 20, height: 3, depth: 0.2 }),
  ];
  const { motor } = createHarness({ colliders });
  const result = motor.move({
    start: { x: 0, y: 0, z: 0 },
    displacement: { x: 4, z: 4 },
    grounded: true,
  });
  assert.ok(result.position.x <= 1.52);
  assert.ok(result.position.z <= 1.52);
  assert.deepEqual(result.contacts, ['qa:wall-x', 'qa:wall-z']);
  assert.ok(result.iterations <= result.substeps * MOTOR_CONFIG.maxIterations);
});

test('grounded players step onto a low primitive support', () => {
  const step = box({ sourceId: 'qa:low-step', x: 0.8, y: 0, z: 0, width: 1.6, height: 0.75, depth: 3 });
  const { motor } = createHarness({ colliders: [step] });
  const result = motor.move({
    start: { x: -0.5, y: 0, z: 0 },
    displacement: { x: 1.2, z: 0 },
    grounded: true,
  });
  assert.equal(result.stepped, true);
  assert.equal(result.supportSourceId, 'qa:low-step');
  assert.ok(Math.abs(result.supportHeight - 0.75) < 1e-8);
  assert.ok(Math.abs(result.position.y - 0.75) < 1e-8);
});

test('high steps and airborne movement do not autostep', () => {
  const high = box({ sourceId: 'qa:high-step', x: 0.8, y: 0, z: 0, width: 1.6, height: 1.35, depth: 3 });
  const highResult = createHarness({ colliders: [high] }).motor.move({
    start: { x: -0.5, y: 0, z: 0 },
    displacement: { x: 1.2, z: 0 },
    grounded: true,
  });
  assert.equal(highResult.stepped, false);
  assert.ok(highResult.position.x < 0);

  const low = box({ sourceId: 'qa:low-step', x: 0.8, y: 0, z: 0, width: 1.6, height: 0.75, depth: 3 });
  const airResult = createHarness({ colliders: [low] }).motor.move({
    start: { x: -0.5, y: 0.1, z: 0 },
    displacement: { x: 1.2, z: 0 },
    grounded: false,
    allowStep: false,
  });
  assert.equal(airResult.stepped, false);
  assert.ok(airResult.position.x < 0);
});

test('not-ready destinations retain the previous valid canonical position', () => {
  const { motor } = createHarness({ ready: false });
  motor.reset({ x: 4, y: 2, z: -3 });
  const result = motor.move({
    start: { x: 10, y: 2, z: -3 },
    displacement: { x: 2, z: 0 },
    grounded: true,
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.position, { x: 4, y: 2, z: -3 });
  assert.equal(result.readiness.policy, 'retain-previous-valid-position');
});

test('zero displacement remains finite and keeps terrain support', () => {
  const result = createHarness().motor.move({
    start: { x: 0, y: 0, z: 0 },
    displacement: { x: 0, z: 0 },
    grounded: true,
  });
  assert.deepEqual(result.position, { x: 0, y: 0, z: 0 });
  assert.equal(result.substeps, 0);
  assert.equal(result.supportSourceId, 'terrain');
});

test('solver iteration limits are bounded at construction', () => {
  assert.throws(
    () => createHarness({ config: { ...MOTOR_CONFIG, maxIterations: 17 } }),
    /solver configuration is invalid/,
  );
});

test('candidate query includes step-up and ground-snap vertical clearance', () => {
  let request = null;
  const runtime = {
    checkMovementReadiness: () => ({ ready: true, missing: [], truncated: false }),
    querySweptCapsule: (next) => {
      request = next;
      next.out.length = 0;
      return next.out;
    },
  };
  const terrainProvider = new TerrainCollisionProvider({ getHeight: () => 0 });
  const motor = new CharacterMotor({
    collisionRuntime: runtime,
    terrainProvider,
    config: MOTOR_CONFIG,
    stepHeight: 1.1,
    groundSnapDistance: 0.6,
  });
  motor.reset({ x: 0, y: 0, z: 0 });
  motor.move({
    start: { x: 0, y: 0, z: 0 },
    displacement: { x: 0.5, z: 0 },
    grounded: true,
  });
  assert.equal(request.start.y, -0.6);
  assert.ok(Math.abs(request.end.y - 1.13) < 1e-9);
});
