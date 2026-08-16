import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMiniCampaignFixture,
  createSimulationWorld,
} from '../src/sim/index.js';

test('daily command handlers observe the cadence tick', () => {
  const world = createSimulationWorld({ campaign: createMiniCampaignFixture() });
  const initialized = world.initializeSystems();
  assert.equal(initialized.ok, true);

  world.stepDays(1);

  const tick = world.clock.getTick();
  const entries = world.ledger.list();
  assert.ok(entries.length > 0);
  assert.equal(world.state.calendar.tick, tick);
  assert.deepEqual(new Set(entries.map((entry) => entry.tick)), new Set([tick]));
});
