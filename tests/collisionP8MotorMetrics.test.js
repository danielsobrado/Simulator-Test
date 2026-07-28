import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLLISION_COUNT_COUNTERS,
  COLLISION_TIMING_COUNTERS,
} from '../src/editor/collision/CollisionPerfCounters.js';
import { CharacterMotor } from '../src/editor/collision/character/CharacterMotor.js';
import { PerfCounters } from '../src/editor/performance/qa/PerfCounters.js';

const CONFIG = Object.freeze({
  radius: 0.35,
  bodyHeight: 1.8,
  skinWidth: 0.03,
  maxSlopeDegrees: 50,
  maxSubstepDistance: 0.2,
  maxIterations: 6,
});

function terrainProvider() {
  return {
    constrainMovement: ({ endX, endZ }) => ({ x: endX, z: endZ, constrained: false }),
    sample: () => ({
      sourceId: 'terrain',
      height: 0,
      normal: { x: 0, y: 1, z: 0 },
      walkable: true,
    }),
  };
}

function clock() {
  let value = 0;
  return () => {
    value += 1;
    return value;
  };
}

test('motor records total, narrow-phase, and support timings separately', () => {
  PerfCounters.reset();
  const motor = new CharacterMotor({
    collisionRuntime: {
      checkMovementReadiness: () => ({ ready: true, missing: [], failed: [] }),
      querySweptCapsule: () => [],
    },
    terrainProvider: terrainProvider(),
    config: CONFIG,
    stepHeight: 1.1,
    groundSnapDistance: 0.6,
    now: clock(),
  });
  motor.reset({ x: 0, y: 0, z: 0 });

  const result = motor.move({
    start: { x: 0, y: 0, z: 0 },
    displacement: { x: 0.4, z: 0 },
    grounded: true,
  });

  assert.equal(result.ready, true);
  assert.equal(result.timings.narrowPhaseMs, 1);
  assert.equal(result.timings.supportMs, 1);
  assert.equal(result.timings.totalMs, 5);
  assert.equal(PerfCounters.get(COLLISION_TIMING_COUNTERS.narrowPhase), 1);
  assert.equal(PerfCounters.get(COLLISION_TIMING_COUNTERS.support), 1);
  assert.equal(PerfCounters.get(COLLISION_TIMING_COUNTERS.total), 5);
  PerfCounters.reset();
});

test('motor retains the previous valid position when collision readiness fails', () => {
  PerfCounters.reset();
  const readiness = {
    ready: false,
    missing: ['1:0'],
    failed: [{ chunkKey: '1:0', message: 'proxy failed' }],
  };
  const motor = new CharacterMotor({
    collisionRuntime: {
      checkMovementReadiness: () => readiness,
      querySweptCapsule: () => {
        throw new Error('broadphase must not run while unready');
      },
    },
    terrainProvider: terrainProvider(),
    config: CONFIG,
    stepHeight: 1.1,
    groundSnapDistance: 0.6,
    now: clock(),
  });
  motor.reset({ x: 2, y: 0, z: 3 });

  const result = motor.move({
    start: { x: 2, y: 0, z: 3 },
    displacement: { x: 4, z: 0 },
    grounded: true,
  });

  assert.equal(result.ready, false);
  assert.equal(result.blocked, true);
  assert.deepEqual(result.position, { x: 2, y: 0, z: 3 });
  assert.equal(result.readiness, readiness);
  assert.equal(PerfCounters.get(COLLISION_COUNT_COUNTERS.readinessMisses), 1);
  PerfCounters.reset();
});
