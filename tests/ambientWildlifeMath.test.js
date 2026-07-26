import assert from 'node:assert/strict';
import test from 'node:test';
import {
  chooseWeightedWildlife,
  createFlockMembers,
  createOrbitFlightPlan,
  sampleOrbitFlight,
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
