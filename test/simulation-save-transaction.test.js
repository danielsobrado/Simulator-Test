import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createMiniCampaignFixture,
  createSimulationWorld,
} from '../src/sim/index.js';

test('simulation save commits the transaction it started', async () => {
  const simulation = createSimulationWorld({
    campaign: createMiniCampaignFixture(),
  });
  const originalBeginSave = simulation.saveStore.beginSave.bind(simulation.saveStore);

  simulation.saveStore.beginSave = async (slot, payload) => {
    await originalBeginSave(slot, { marker: 'older-pending-save' });
    return originalBeginSave(slot, payload);
  };

  const saved = await simulation.save('slot');
  assert.equal(saved.ok, true);
  assert.equal(saved.transactionId, 'save:2');

  const loaded = await simulation.saveStore.load('slot');
  assert.equal(loaded.ok, true);
  assert.ok(loaded.payload.snapshot);
  assert.equal(loaded.payload.marker, undefined);

  const aborted = await simulation.saveStore.abortSave('slot');
  assert.equal(aborted.transactionId, 'save:1');
});
