import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createScheduler,
  createWorldClock,
} from '../../src/sim/time/worldClock.js';
import { validateSimulationConfig } from '../../src/config/validateSimulationConfig.js';

test('calendar rejects derived tick counts outside the safe integer range', () => {
  assert.throws(
    () => createWorldClock({
      ticksPerHour: Number.MAX_SAFE_INTEGER,
      hoursPerDay: 2,
    }),
    (error) => error?.code === 'invalid_calendar_config' && error.field === 'ticksPerDay',
  );
  assert.throws(
    () => validateSimulationConfig({
      time: {
        ticksPerHour: Number.MAX_SAFE_INTEGER,
        hoursPerDay: 2,
      },
    }),
    /ticksPerDay exceeds the safe integer range/,
  );
});

test('scheduler rejects malformed and duplicate jobs', () => {
  const scheduler = createScheduler(createWorldClock());

  assert.throws(
    () => scheduler.scheduleJob({ type: 'bad', dueTick: -1 }),
    (error) => error?.code === 'invalid_scheduler_value' && error.field === 'job.dueTick',
  );
  scheduler.scheduleJob({ id: 'job-1', type: 'ok', dueTick: 1 });
  assert.throws(
    () => scheduler.scheduleJob({ id: 'job-1', type: 'duplicate', dueTick: 2 }),
    (error) => error?.code === 'duplicate_job',
  );
});

test('scheduler restore validates atomically', () => {
  const scheduler = createScheduler(createWorldClock());
  scheduler.scheduleJob({ id: 'existing', type: 'ok', dueTick: 1 });
  const before = scheduler.serialize();

  assert.throws(
    () => scheduler.restore({
      jobSeq: 1,
      jobs: [{
        id: 'bad',
        type: 'bad',
        dueTick: Number.NaN,
        priority: 1,
        ownerEntityId: null,
        payload: {},
        recurrence: null,
        createdAtTick: 0,
        cancelledAtTick: null,
        schemaVersion: 1,
      }],
    }),
    (error) => error?.code === 'invalid_scheduler_value',
  );

  assert.deepEqual(scheduler.serialize(), before);
});

test('scheduler keeps custom cadence support for future systems', () => {
  const scheduler = createScheduler(createWorldClock());
  scheduler.registerSystem({ id: 'weather.seasonal', cadence: 'season' });

  assert.deepEqual(scheduler.systemsForCadence('season'), [
    { id: 'weather.seasonal', cadence: 'season' },
  ]);
});
