import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFixedStepRunner,
  createScheduler,
  createWorldClock,
} from '../src/sim/time/worldClock.js';

function createRunner(onCadence) {
  const clock = createWorldClock({});
  const scheduler = createScheduler(clock);
  const runner = createFixedStepRunner({
    clock,
    scheduler,
    calendarConfig: {},
    onCadence,
  });
  return { clock, runner };
}

test('catch-up cadence callbacks observe their chronological tick', () => {
  const observed = [];
  let clock;
  const created = createRunner((event) => {
    observed.push([event.tick, clock.getTick()]);
  });
  ({ clock } = created);

  const result = created.runner.stepTicks(3, {});

  assert.deepEqual(observed, [[1, 1], [2, 2], [3, 3]]);
  assert.equal(result.tick, 3);
  assert.equal(clock.getTick(), 3);
});

test('catch-up restores the final clock tick when a cadence callback fails', () => {
  let clock;
  const created = createRunner((event) => {
    if (event.tick === 2) throw new Error('cadence failed');
  });
  ({ clock } = created);

  assert.throws(() => created.runner.stepTicks(3, {}), /cadence failed/);
  assert.equal(clock.getTick(), 3);
});
