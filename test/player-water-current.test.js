import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlayerState, stepPlayerPhysics } from '../src/editor/player/PlayerPhysics.js';
import { getCanonicalWater } from '../src/editor/water/TerrainWaterQueries.js';
import { createWaterSample } from '../src/editor/water/WaterSample.js';

const playerConfig = Object.freeze({
  walkSpeed: 8,
  runMultiplier: 1.5,
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
    currentDriftSpeed: 2,
  }),
});

const riverSample = Object.freeze({
  kind: 3,
  bodyId: 5,
  coverage: 1,
  surfaceHeight: 2,
  flowX: 1,
  flowZ: 0,
});

test('swimmers drift with the bounded canonical current when idle', () => {
  const state = createPlayerState({ x: 0, z: 0, groundHeight: 0, eyeHeight: 1.7 });
  const next = stepPlayerPhysics({
    state,
    input: { forward: 0, right: 0, running: false, jump: false, ascend: 0, descend: 0 },
    deltaSeconds: 0.05,
    config: playerConfig,
    forward: { x: 1, z: 0 },
    right: { x: 0, z: 1 },
    getGroundHeight: () => 0,
    getWaterSample: () => riverSample,
  });
  assert.equal(next.waterState, 'swimming');
  assert.ok(Math.abs(next.x - 0.1) < 1e-9);
});

test('current drift is resolved by the collision motor', () => {
  const state = createPlayerState({ x: 0, z: 0, groundHeight: 0, eyeHeight: 1.7 });
  let requestedDisplacement = null;
  const next = stepPlayerPhysics({
    state,
    input: { forward: 0, right: 0, running: false, jump: false, ascend: 0, descend: 0 },
    deltaSeconds: 0.05,
    config: playerConfig,
    forward: { x: 1, z: 0 },
    right: { x: 0, z: 1 },
    getGroundHeight: () => 0,
    getWaterSample: () => riverSample,
    resolveHorizontalMotion: (request) => {
      requestedDisplacement = request.displacement;
      return {
        position: { ...request.start },
        ready: true,
        blocked: true,
        stepped: false,
        supportSourceId: 'terrain',
        supportHeight: 0,
        supportNormal: { x: 0, y: 1, z: 0 },
        contacts: [],
        previousValidPosition: { ...request.start },
      };
    },
  });
  assert.ok(Math.abs(requestedDisplacement.x - 0.1) < 1e-9);
  assert.equal(requestedDisplacement.z, 0);
  assert.equal(next.x, 0);
  assert.equal(next.collisionBlocked, true);
});

test('canonical queries convert south-positive cell flow into north-positive world axes', () => {
  const sample = createWaterSample({
    kind: 3,
    bodyId: 11,
    surfaceHeight: 4,
    bedHeight: 2,
    flowX: 0,
    flowZ: 1,
  });
  const terrainView = {
    floatingOrigin: { toCanonical: (x, z) => ({ x, z }) },
    worldStore: {
      tileSize: 2,
      generator: { sampleWater: () => sample, seaLevel: 0 },
      sampleHeight: () => 2,
      getTile: () => 0,
      tileOverrides: new Map(),
      heightOverrides: new Map(),
    },
  };
  const world = getCanonicalWater(terrainView, 0, -2);
  assert.equal(world.flowX, 0);
  assert.equal(world.flowZ, -1);
});
