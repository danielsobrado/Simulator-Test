import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSimulationConfig } from '../src/config/validateSimulationConfig.js';

test('simulation time validation rejects values the runtime cannot represent', () => {
  assert.throws(
    () => validateSimulationConfig({ time: { ticksPerHour: 0.5 } }),
    /ticksPerHour must be a positive integer/,
  );
  assert.throws(
    () => validateSimulationConfig({ time: { hoursPerDay: 24, initialHour: 24 } }),
    /initialHour must be less than hoursPerDay/,
  );
  assert.throws(
    () => validateSimulationConfig({ time: { monthsPerYear: 12, initialMonth: 13 } }),
    /initialMonth must not exceed monthsPerYear/,
  );
  assert.throws(
    () => validateSimulationConfig({ time: { daysPerMonth: 30, initialDay: 31 } }),
    /initialDay must not exceed daysPerMonth/,
  );
});

test('simulation validation rejects malformed nested config objects', () => {
  assert.throws(
    () => validateSimulationConfig({ time: [] }),
    /simulation.time must be an object/,
  );
  assert.throws(
    () => validateSimulationConfig({ geography: [] }),
    /simulation.geography must be an object/,
  );
  assert.throws(
    () => validateSimulationConfig({ commodities: { grain: null } }),
    /simulation.commodities.grain must be an object/,
  );
});

test('simulation validation accepts a bounded custom calendar', () => {
  assert.doesNotThrow(() => validateSimulationConfig({
    maxEventsPerTick: 5000,
    time: {
      ticksPerHour: 30,
      hoursPerDay: 20,
      daysPerWeek: 6,
      daysPerMonth: 28,
      monthsPerYear: 10,
      initialYear: 7,
      initialMonth: 10,
      initialDay: 28,
      initialHour: 19,
    },
  }));
});
