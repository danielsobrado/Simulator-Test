import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMiniCampaignFixture,
  createSimulationWorld,
  ticksPerDay,
} from '../src/sim/index.js';

function createSimulation() {
  return createSimulationWorld({ campaign: createMiniCampaignFixture() });
}

test('sub-cadence stepping keeps simulation state calendar synchronized with the clock', () => {
  const simulation = createSimulation();

  simulation.stepTicks(1);

  assert.equal(simulation.clock.getTick(), 1);
  assert.equal(simulation.state.calendar.tick, 1);
});

test('multi-day catch-up journals daily commands at their chronological ticks', () => {
  const simulation = createSimulation();
  simulation.initializeSystems();
  const dayTicks = ticksPerDay(simulation.clock.getConfig());

  simulation.stepDays(2);

  const dailyTicks = simulation.getJournal()
    .filter((command) => command.type === 'sim.dailyTick')
    .map((command) => command.issuedAtTick);
  assert.deepEqual(dailyTicks, [dayTicks, dayTicks * 2]);
  assert.equal(simulation.clock.getTick(), dayTicks * 2);
  assert.equal(simulation.state.calendar.tick, dayTicks * 2);
});

test('malformed saved scheduler fails before replacing live simulation state', async () => {
  const simulation = createSimulation();
  simulation.initializeSystems();
  await simulation.save('transactional-load');

  const stored = await simulation.saveStore.load('transactional-load');
  stored.payload.scheduler.jobSeq = -1;
  const replacement = await simulation.saveStore.beginSave('transactional-load', stored.payload);
  await simulation.saveStore.commitSave('transactional-load', replacement.transactionId);

  simulation.stepTicks(1);
  const before = {
    checksum: simulation.checksum(),
    clockTick: simulation.clock.getTick(),
    calendar: structuredClone(simulation.state.calendar),
    scheduler: simulation.scheduler.serialize(),
    lod: simulation.lod.serialize(),
    journal: simulation.getJournal(),
    ledger: simulation.ledger.list(),
    reasonLog: structuredClone(simulation.reasonLog),
  };

  await assert.rejects(
    simulation.load('transactional-load'),
    /invalid_scheduler_value:jobSeq/,
  );

  assert.equal(simulation.checksum(), before.checksum);
  assert.equal(simulation.clock.getTick(), before.clockTick);
  assert.deepEqual(simulation.state.calendar, before.calendar);
  assert.deepEqual(simulation.scheduler.serialize(), before.scheduler);
  assert.deepEqual(simulation.lod.serialize(), before.lod);
  assert.deepEqual(simulation.getJournal(), before.journal);
  assert.deepEqual(simulation.ledger.list(), before.ledger);
  assert.deepEqual(simulation.reasonLog, before.reasonLog);
});
