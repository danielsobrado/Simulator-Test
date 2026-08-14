import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMiniCampaignFixture,
  createSimulationWorld,
} from '../../src/sim/index.js';
import { importedSettlementId } from '../../src/sim/model/ids.js';
import {
  createScheduler,
  createWorldClock,
} from '../../src/sim/time/worldClock.js';

function boot() {
  const world = createSimulationWorld({ campaign: createMiniCampaignFixture() });
  world.buildGraph();
  assert.equal(world.initializeSystems().ok, true);
  return world;
}

test('regression: snapshots cannot mutate live simulation state', () => {
  const world = boot();
  const settlementId = importedSettlementId(1);
  const beforeChecksum = world.checksum();
  const snapshot = world.snapshot();
  const settlement = snapshot.entities.settlements.find((entity) => entity.id === settlementId);
  assert.ok(settlement);

  snapshot.calendar.hour = 99;
  snapshot.diagnostics.commandsAccepted = -1;
  settlement.data.name = 'mutated-through-snapshot';
  snapshot.definition.physicalScale.mapWidth = -1;

  assert.equal(world.checksum(), beforeChecksum);
  assert.notEqual(
    world.queries().getEntity('settlement', settlementId).data.name,
    'mutated-through-snapshot',
  );
  assert.notEqual(world.queries().getCalendar().hour, 99);
  assert.notEqual(world.snapshot().definition.physicalScale.mapWidth, -1);
});

test('regression: simulation preserves the configured initial hour at tick zero', () => {
  const world = createSimulationWorld({ campaign: createMiniCampaignFixture() });
  assert.equal(world.queries().getCalendar().hour, world.config.time.initialHour);
  world.buildGraph();
  assert.equal(world.initializeSystems().ok, true);
  assert.equal(world.queries().getCalendar().hour, world.config.time.initialHour);
});

test('calendar rolls configured starting date across the year boundary', () => {
  const clock = createWorldClock({
    ticksPerHour: 60,
    hoursPerDay: 24,
    daysPerWeek: 7,
    daysPerMonth: 30,
    monthsPerYear: 12,
    initialYear: 5,
    initialMonth: 12,
    initialDay: 30,
    initialHour: 23,
  });

  assert.deepEqual(clock.getCalendar(), {
    tick: 0,
    year: 5,
    month: 12,
    day: 30,
    hour: 23,
    minute: 0,
  });

  clock.advance(60);
  assert.deepEqual(clock.getCalendar(), {
    tick: 60,
    year: 6,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
  });
});

test('calendar configuration rejects invalid bounds', () => {
  assert.throws(
    () => createWorldClock({ ticksPerHour: 0 }),
    (error) => error?.code === 'invalid_calendar_config' && error.field === 'ticksPerHour',
  );
  assert.throws(
    () => createWorldClock({ hoursPerDay: 24, initialHour: 24 }),
    (error) => error?.code === 'invalid_calendar_config' && error.field === 'initialHour',
  );
});

test('regression: scheduler read APIs do not expose mutable internal records', () => {
  const clock = createWorldClock();
  const scheduler = createScheduler(clock);
  const system = { id: 'daily', cadence: 'day', metadata: { priority: 1 } };
  const payload = { nested: { value: 1 } };

  scheduler.registerSystem(system);
  const scheduled = scheduler.scheduleJob({
    id: 'job-1',
    type: 'test',
    dueTick: 0,
    payload,
  });

  system.metadata.priority = 9;
  payload.nested.value = 2;
  scheduled.payload.nested.value = 3;

  const due = scheduler.listDueJobs();
  due[0].payload.nested.value = 4;
  const systems = scheduler.listSystems();
  systems[0].metadata.priority = 5;
  const serialized = scheduler.serialize();
  serialized.jobs[0].payload.nested.value = 6;

  assert.equal(scheduler.listDueJobs()[0].payload.nested.value, 1);
  assert.equal(scheduler.listSystems()[0].metadata.priority, 1);
});
