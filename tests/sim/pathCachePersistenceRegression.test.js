import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCommandEnvelope,
  createMiniCampaignFixture,
  createSimulationWorld,
} from '../../src/sim/index.js';
import { importedRouteId, importedSettlementId } from '../../src/sim/model/ids.js';

function boot() {
  const world = createSimulationWorld({ campaign: createMiniCampaignFixture() });
  world.buildGraph();
  assert.equal(world.initializeSystems().ok, true);
  return world;
}

function mainPath(world) {
  return world.findPath(importedSettlementId(1), importedSettlementId(3));
}

function sequenceOf(command) {
  return Number(command.id.split(':').at(-1));
}

test('regression: route danger invalidates cached path cost', () => {
  const world = boot();
  const before = mainPath(world);
  assert.equal(before.ok, true);

  const changed = world.setRouteDanger(importedRouteId(1), 1);
  assert.equal(changed.ok, true);

  const after = mainPath(world);
  assert.equal(after.ok, true);
  assert.ok(after.cost > before.cost);
});

test('regression: direct graph mutations invalidate cached paths', () => {
  const world = boot();
  const before = mainPath(world);
  assert.equal(before.ok, true);

  const patched = world.dispatch('sim.patchEntity', {
    kind: 'graphEdge',
    id: before.edgeIds[0],
    dataPatch: { danger: 1 },
  });
  assert.equal(patched.ok, true);

  const after = mainPath(world);
  assert.equal(after.ok, true);
  assert.ok(after.cost > before.cost);
});

test('regression: callers cannot mutate cached path results', () => {
  const world = boot();
  const first = mainPath(world);
  assert.equal(first.ok, true);
  const expected = structuredClone(first);

  first.edgeIds.length = 0;
  first.nodeIds.length = 0;
  first.costBreakdown.length = 0;
  first.cost = -1;

  const second = mainPath(world);
  assert.deepEqual(second, expected);
});

test('regression: load restores path cache and runtime bookkeeping', async () => {
  const world = boot();
  world.stepDays(1);
  const baselinePath = mainPath(world);
  const savedJournal = world.getJournal();
  const savedLedger = world.ledger.list();
  const savedMaxSequence = Math.max(...savedJournal.map(sequenceOf));

  assert.equal((await world.save('cache-regression')).ok, true);
  assert.equal(world.setRouteDanger(importedRouteId(1), 1).ok, true);
  world.stepDays(1);
  const changedPath = mainPath(world);
  assert.ok(changedPath.cost > baselinePath.cost);
  assert.ok(world.ledger.list().length >= savedLedger.length);

  const loaded = await world.load('cache-regression');
  assert.equal(loaded.ok, true);
  assert.deepEqual(world.getJournal(), savedJournal);
  assert.deepEqual(world.ledger.list(), savedLedger);
  assert.equal(mainPath(world).cost, baselinePath.cost);

  const settlement = world.queries().getEntity('settlement', importedSettlementId(1));
  const next = world.dispatch('sim.patchEntity', {
    kind: 'settlement',
    id: settlement.id,
    dataPatch: { name: settlement.data.name },
  });
  assert.equal(next.ok, true);
  assert.equal(sequenceOf(next.command), savedMaxSequence + 1);
});

test('regression: failed replay leaves live runtime state untouched', () => {
  const world = boot();
  world.stepDays(1);
  const snapshot = world.snapshot();
  const beforeChecksum = world.checksum();
  const beforeJournal = world.getJournal();
  const beforeLedger = world.ledger.list();
  const beforeLod = world.lod.serialize();
  const tick = world.clock.getTick();

  const replay = world.replayFromSnapshot(snapshot, [
    createCommandEnvelope({
      id: 'replay-promote',
      type: 'sim.promoteSettlement',
      issuedAtTick: tick,
      payload: { settlementId: importedSettlementId(1), tier: 'C' },
    }),
    createCommandEnvelope({
      id: 'replay-daily',
      type: 'sim.dailyTick',
      issuedAtTick: tick,
      payload: {},
    }),
    createCommandEnvelope({
      id: 'replay-fail',
      type: 'sim.unknown.command',
      issuedAtTick: tick,
      payload: {},
    }),
  ]);

  assert.equal(replay.ok, false);
  assert.equal(replay.code, 'unknown_command_type');
  assert.equal(world.checksum(), beforeChecksum);
  assert.deepEqual(world.getJournal(), beforeJournal);
  assert.deepEqual(world.ledger.list(), beforeLedger);
  assert.deepEqual(world.lod.serialize(), beforeLod);
});

test('regression: replay state replacement cannot reuse a stale cached path', () => {
  const world = boot();
  const baselinePath = mainPath(world);
  const snapshot = world.snapshot();

  assert.equal(world.setRouteDanger(importedRouteId(1), 1).ok, true);
  const changedPath = mainPath(world);
  assert.ok(changedPath.cost > baselinePath.cost);

  const replay = world.replayFromSnapshot(snapshot, []);
  assert.equal(replay.ok, true);
  assert.equal(mainPath(world).cost, baselinePath.cost);
});

test('regression: trade matching is journaled as one atomic command', () => {
  const world = boot();
  world.stepDays(2);
  const origin = importedSettlementId(1);
  const destination = importedSettlementId(2);

  assert.equal(world.createTradeOffer({
    settlementId: origin,
    commodityId: 'grain',
    kind: 'sell',
    quantity: 3,
    limitPrice: 1,
  }).ok, true);
  assert.equal(world.createTradeOffer({
    settlementId: destination,
    commodityId: 'grain',
    kind: 'buy',
    quantity: 3,
    limitPrice: 5,
  }).ok, true);

  const beforeCount = world.getJournal().length;
  const matched = world.matchTrades();
  assert.equal(matched.ok, true);

  const journal = world.getJournal();
  assert.equal(journal.length, beforeCount + 1);
  assert.equal(journal.at(-1).type, 'sim.matchTrades');
  assert.equal(journal.at(-1).id, matched.command.id);
});
