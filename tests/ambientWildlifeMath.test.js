import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseWeightedWildlife,
  createFlockMembers,
  createOrbitFlightPlan,
  sampleOrbitFlight,
  sampleWingFlap,
  wildlifeDelaySeconds,
} from '../src/editor/stylized/ambientWildlifeMath.js';

const CONFIG = Object.freeze({
  initialDelayMin: 6,
  initialDelayMax: 14,
  intervalMin: 22,
  intervalMax: 40,
  durationMin: 14,
  durationMax: 22,
  radiusMin: 80,
  radiusMax: 130,
  altitudeMin: 30,
  altitudeMax: 48,
});

test('wildlife timing and flight plans are deterministic and bounded', () => {
  const firstDelay = wildlifeDelaySeconds(CONFIG, 918273, 4, true);
  assert.equal(firstDelay, wildlifeDelaySeconds(CONFIG, 918273, 4, true));
  assert.ok(firstDelay >= 6 && firstDelay <= 14);

  const plan = createOrbitFlightPlan({
    seed: 918273,
    eventIndex: 4,
    centerX: 100,
    centerZ: -40,
    baseY: 12,
    config: CONFIG,
  });
  assert.deepEqual(plan, createOrbitFlightPlan({
    seed: 918273,
    eventIndex: 4,
    centerX: 100,
    centerZ: -40,
    baseY: 12,
    config: CONFIG,
  }));
  assert.ok(plan.radius >= 80 && plan.radius <= 130);
  assert.ok(plan.durationSeconds >= 14 && plan.durationSeconds <= 22);
  assert.ok(plan.baseY >= 42 && plan.baseY <= 60);
  assert.ok(plan.turnAmplitude >= 0.12 && plan.turnAmplitude <= 0.28);
  assert.ok(plan.turnCycles >= 0.65 && plan.turnCycles <= 1.3);
  assert.ok(plan.radiusWander >= 0.04 && plan.radiusWander <= 0.1);
});

test('orbit samples remain finite and advance tangentially', () => {
  const plan = createOrbitFlightPlan({
    seed: 77,
    eventIndex: 3,
    centerX: 0,
    centerZ: 0,
    baseY: 0,
    config: CONFIG,
  });
  const start = sampleOrbitFlight(plan, 0);
  const middle = sampleOrbitFlight(plan, 0.5);
  const end = sampleOrbitFlight(plan, 1);

  for (const sample of [start, middle, end]) {
    assert.ok(Object.values(sample).every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(sample.tangentX, sample.tangentZ) - 1) < 1e-9);
  }
  assert.notDeepEqual(start, middle);
  assert.notDeepEqual(middle, end);
});

test('orbit tangent follows the meandering flight path', () => {
  const plan = createOrbitFlightPlan({
    seed: 918273,
    eventIndex: 4,
    centerX: 100,
    centerZ: -40,
    baseY: 12,
    config: CONFIG,
  });
  const progress = 0.43;
  const sample = sampleOrbitFlight(plan, progress);
  const before = sampleOrbitFlight(plan, progress - 1e-5);
  const after = sampleOrbitFlight(plan, progress + 1e-5);
  const finiteDifferenceLength = Math.hypot(after.x - before.x, after.z - before.z);
  const finiteDifferenceX = (after.x - before.x) / finiteDifferenceLength;
  const finiteDifferenceZ = (after.z - before.z) / finiteDifferenceLength;

  assert.ok(sample.tangentX * finiteDifferenceX + sample.tangentZ * finiteDifferenceZ > 0.999999);
});

test('weighted species selection and flock members preserve strict caps', () => {
  const crow = { id: 'crow', weight: 0.55 };
  const seagull = { id: 'seagull', weight: 0.45 };
  assert.equal(chooseWeightedWildlife([crow, seagull], 0), crow);
  assert.equal(chooseWeightedWildlife([crow, seagull], 0.549), crow);
  assert.equal(chooseWeightedWildlife([crow, seagull], 0.551), seagull);

  const members = createFlockMembers({ seed: 12, eventIndex: 8, count: 7 });
  assert.equal(members.length, 7);
  assert.deepEqual(
    members,
    createFlockMembers({ seed: 12, eventIndex: 8, count: 7 }),
  );
  assert.equal(members[0].side, 0);
});

test('distant birds alternate bounded flap bursts with flat glides', () => {
  const [member] = createFlockMembers({ seed: 12, eventIndex: 8, count: 1 });
  const samples = Array.from(
    { length: 1_000 },
    (_value, index) => sampleWingFlap(member, index / 50),
  );

  assert.ok(samples.every((pose) => Number.isFinite(pose) && Math.abs(pose) <= 1));
  assert.ok(samples.some((pose) => pose > 0.75));
  assert.ok(samples.some((pose) => pose < -0.75));
  assert.ok(samples.filter((pose) => pose === 0).length > 100);
});
