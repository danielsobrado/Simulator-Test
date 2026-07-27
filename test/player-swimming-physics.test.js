import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayerState, stepPlayerPhysics } from '../src/editor/player/PlayerPhysics.js';
import {
  PLAYER_WATER_SUBMERGED,
  PLAYER_WATER_SWIMMING,
  PLAYER_WATER_WADING,
} from '../src/editor/player/PlayerWaterState.js';

const config = Object.freeze({
  walkSpeed: 10,
  runMultiplier: 2,
  jumpSpeed: 8,
  gravity: 24,
  eyeHeight: 1.7,
  stepHeight: 1,
  groundSnapDistance: 0.6,
  water: Object.freeze({
    wadeDepth: 0.7,
    swimDepth: 1.35,
    transitionHysteresis: 0.12,
    wadeDrag: 0.35,
    swimSpeed: 5,
    verticalSwimSpeed: 3,
    buoyancy: 18,
    swimDrag: 4,
  }),
});

const forward = Object.freeze({ x: 1, z: 0 });
const right = Object.freeze({ x: 0, z: 1 });
const ground = () => 0;

function input(overrides = {}) {
  return {
    forward: 0,
    right: 0,
    running: false,
    jump: false,
    ascend: 0,
    descend: 0,
    ...overrides,
  };
}

function waterAt(surfaceHeight) {
  return () => ({ coverage: 1, surfaceHeight, bodyId: 5 });
}

test('wading applies horizontal drag without disabling ground contact', () => {
  const state = createPlayerState({ x: 0, z: 0, groundHeight: 0, eyeHeight: config.eyeHeight });
  const next = stepPlayerPhysics({
    state,
    input: input({ forward: 1 }),
    deltaSeconds: 0.05,
    config,
    forward,
    right,
    getGroundHeight: ground,
    getWaterSample: waterAt(1),
  });

  assert.equal(next.waterState, PLAYER_WATER_WADING);
  assert.equal(next.grounded, true);
  assert.ok(next.x > 0);
  assert.ok(next.x < config.walkSpeed * 0.05);
});

test('deep water switches to buoyant swimming and accepts vertical controls', () => {
  const state = createPlayerState({ x: 0, z: 0, groundHeight: 0, eyeHeight: config.eyeHeight });
  const floating = stepPlayerPhysics({
    state,
    input: input(),
    deltaSeconds: 0.05,
    config,
    forward,
    right,
    getGroundHeight: ground,
    getWaterSample: waterAt(1.8),
  });
  assert.equal(floating.waterState, PLAYER_WATER_SWIMMING);
  assert.equal(floating.grounded, false);
  assert.ok(floating.y > state.y);

  const descending = stepPlayerPhysics({
    state: floating,
    input: input({ descend: 1 }),
    deltaSeconds: 0.05,
    config,
    forward,
    right,
    getGroundHeight: ground,
    getWaterSample: waterAt(1.8),
  });
  assert.ok(descending.verticalVelocity < floating.verticalVelocity);
});

test('submerged players surface smoothly and leaving water restores gravity', () => {
  let state = {
    ...createPlayerState({ x: 0, z: 0, groundHeight: 0, eyeHeight: config.eyeHeight }),
    y: 1,
    grounded: false,
  };
  state = stepPlayerPhysics({
    state,
    input: input(),
    deltaSeconds: 0.05,
    config,
    forward,
    right,
    getGroundHeight: ground,
    getWaterSample: waterAt(3),
  });
  assert.equal(state.waterState, PLAYER_WATER_SUBMERGED);
  assert.ok(state.verticalVelocity > 0);

  const exited = stepPlayerPhysics({
    state,
    input: input(),
    deltaSeconds: 0.05,
    config,
    forward,
    right,
    getGroundHeight: ground,
    getWaterSample: () => ({ coverage: 0, surfaceHeight: 0, bodyId: 0 }),
  });
  assert.equal(exited.waterState, 'dry');
  assert.ok(exited.verticalVelocity < state.verticalVelocity);
});

test('legacy dry-land physics remains unchanged without water configuration', () => {
  const dryConfig = {
    walkSpeed: 10,
    runMultiplier: 2,
    jumpSpeed: 8,
    gravity: 24,
    eyeHeight: 1.7,
    stepHeight: 1,
    groundSnapDistance: 0.6,
  };
  const state = createPlayerState({ x: 0, z: 0, groundHeight: 0, eyeHeight: dryConfig.eyeHeight });
  const next = stepPlayerPhysics({
    state,
    input: input({ forward: 1 }),
    deltaSeconds: 0.05,
    config: dryConfig,
    forward,
    right,
    getGroundHeight: ground,
  });
  assert.equal(next.x, 0.5);
  assert.equal(next.grounded, true);
  assert.equal(next.waterState, 'dry');
});
