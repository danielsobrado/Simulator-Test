import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayerState, stepPlayerPhysics } from '../src/editor/player/PlayerPhysics.js';

const CONFIG = Object.freeze({
  walkSpeed: 9,
  runMultiplier: 1.8,
  jumpSpeed: 8,
  gravity: 24,
  eyeHeight: 1.7,
  stepHeight: 1.1,
  groundSnapDistance: 0.6,
});

const FORWARD = Object.freeze({ x: 1, z: 0 });
const RIGHT = Object.freeze({ x: 0, z: 1 });
const INPUT = Object.freeze({
  forward: 1,
  right: 0,
  running: false,
  jump: false,
  ascend: 0,
  descend: 0,
});

test('player physics keeps foot and eye positions separate through collision resolution', () => {
  const state = createPlayerState({ x: 0, z: 0, groundHeight: 0, eyeHeight: CONFIG.eyeHeight });
  let received = null;
  const next = stepPlayerPhysics({
    state,
    input: INPUT,
    deltaSeconds: 0.05,
    config: CONFIG,
    forward: FORWARD,
    right: RIGHT,
    getGroundHeight: () => 0,
    resolveHorizontalMotion: (request) => {
      received = request;
      return {
        position: { x: 0.45, y: 0.75, z: 0 },
        ready: true,
        blocked: true,
        stepped: true,
        supportSourceId: 'qa:step',
        supportHeight: 0.75,
        supportNormal: { x: 0, y: 1, z: 0 },
        contacts: Object.freeze(['qa:step']),
        previousValidPosition: Object.freeze({ x: 0.45, y: 0.75, z: 0 }),
      };
    },
  });
  assert.equal(received.start.y, 0);
  assert.ok(Math.abs(next.footY - 0.75) < 1e-9);
  assert.ok(Math.abs(next.y - (0.75 + CONFIG.eyeHeight)) < 1e-9);
  assert.equal(next.supportSourceId, 'qa:step');
  assert.equal(next.collisionStepped, true);
});

test('jump and landing preserve existing gravity semantics with a motor callback', () => {
  let state = createPlayerState({ x: 0, z: 0, groundHeight: 0, eyeHeight: CONFIG.eyeHeight });
  const resolveHorizontalMotion = ({ start }) => ({
    position: start,
    ready: true,
    blocked: false,
    stepped: false,
    supportSourceId: 'terrain',
    supportHeight: 0,
    supportNormal: { x: 0, y: 1, z: 0 },
    contacts: Object.freeze([]),
    previousValidPosition: Object.freeze({ x: 0, y: 0, z: 0 }),
  });

  state = stepPlayerPhysics({
    state,
    input: { ...INPUT, forward: 0, jump: true },
    deltaSeconds: 0.05,
    config: CONFIG,
    forward: FORWARD,
    right: RIGHT,
    getGroundHeight: () => 0,
    resolveHorizontalMotion,
  });
  assert.equal(state.grounded, false);
  assert.ok(state.verticalVelocity > 0);

  for (let index = 0; index < 30 && !state.grounded; index += 1) {
    state = stepPlayerPhysics({
      state,
      input: { ...INPUT, forward: 0 },
      deltaSeconds: 0.05,
      config: CONFIG,
      forward: FORWARD,
      right: RIGHT,
      getGroundHeight: () => 0,
      resolveHorizontalMotion,
    });
  }
  assert.equal(state.grounded, true);
  assert.equal(state.footY, 0);
  assert.equal(state.verticalVelocity, 0);
});

test('not-ready motor output blocks horizontal motion without corrupting vertical state', () => {
  const state = createPlayerState({ x: 2, z: 3, groundHeight: 0, eyeHeight: CONFIG.eyeHeight });
  const next = stepPlayerPhysics({
    state,
    input: INPUT,
    deltaSeconds: 0.05,
    config: CONFIG,
    forward: FORWARD,
    right: RIGHT,
    getGroundHeight: () => 0,
    resolveHorizontalMotion: () => ({
      position: { x: 2, y: 0, z: 3 },
      ready: false,
      blocked: true,
      stepped: false,
      supportSourceId: 'terrain',
      supportHeight: 0,
      supportNormal: { x: 0, y: 1, z: 0 },
      contacts: Object.freeze([]),
      previousValidPosition: Object.freeze({ x: 2, y: 0, z: 3 }),
    }),
  });
  assert.equal(next.x, 2);
  assert.equal(next.z, 3);
  assert.equal(next.y, CONFIG.eyeHeight);
  assert.equal(next.collisionReady, false);
});
