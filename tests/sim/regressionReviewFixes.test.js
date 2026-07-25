import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSimulationWorld,
  createMiniCampaignFixture,
} from '../../src/sim/index.js';
import { importedSettlementId } from '../../src/sim/model/ids.js';
import { migrateBetweenSettlements } from '../../src/sim/population/cohorts.js';
import { matchTradeOffers, createTradeOffer } from '../../src/sim/logistics/shipments.js';
import { applyEvent } from '../../src/sim/events/reducers.js';
import { cloneWorldState, listEntities } from '../../src/sim/model/worldState.js';

function boot() {
  const world = createSimulationWorld({ campaign: createMiniCampaignFixture() });
  world.buildGraph();
  assert.equal(world.initializeSystems().ok, true);
  return world;
}

test('regression: monthly demography is not overwritten by migration patches', () => {
  const world = boot();
  const sid = importedSettlementId(1);
  const beforeCohorts = world.queries().list('populationCohort')
    .filter((c) => c.data.settlementId === sid)
    .map((c) => ({ id: c.id, count: c.data.count }));

  // Force migration pressure and run several months
  for (const market of world.queries().list('market')) {
    world.dispatch('sim.patchEntity', {
      kind: 'inventoryAccount',
      id: market.data.inventoryAccountId,
      dataPatch: { quantities: { grain: 0, food: 0, wood: 0 } },
    });
  }
  world.stepMonths(2);

  const after = world.queries().list('populationCohort')
    .filter((c) => c.data.settlementId === sid);
  for (const cohort of after) {
    assert.ok(Number.isInteger(cohort.data.count));
    assert.ok(cohort.data.count >= 0);
  }

  // Settlement population must equal cohort + promoted person totals
  assert.equal(
    world.queries().getEntity('settlement', sid).data.population,
    world.populationTotal(sid),
  );
  void beforeCohorts;
});

test('regression: migration creates destination cohort instead of dropping movers', () => {
  const world = boot();
  const state = cloneWorldState(world.state);
  const from = listEntities(state, 'settlement')[0];
  const to = listEntities(state, 'settlement')[1];
  from.data.social = {
    ...(from.data.social ?? {}),
    migrationPressure: 0.9,
    happiness: 0.1,
    foodPressure: 0.9,
  };
  to.data.social = {
    ...(to.data.social ?? {}),
    migrationPressure: 0,
    happiness: 0.9,
    foodPressure: 0,
  };

  // Remove matching destination cohorts so migration must create one
  for (const cohort of listEntities(state, 'populationCohort')) {
    if (cohort.data.settlementId === to.id && cohort.data.ageBand === 'working') {
      state.populations.delete(cohort.id);
    }
  }

  const beforeWorld = listEntities(state, 'populationCohort')
    .reduce((n, c) => n + c.data.count, 0);
  const result = migrateBetweenSettlements(state, world.definition, world.config);
  assert.ok(result.reasonCodes.some((r) => r.code === 'migration_moved'));
  assert.ok((result.createEvents ?? []).length >= 1);
  const afterWorld = listEntities(state, 'populationCohort')
    .reduce((n, c) => n + c.data.count, 0);
  assert.equal(afterWorld, beforeWorld);
});

test('regression: partial trade match keeps residual offer active', () => {
  const world = boot();
  world.stepDays(2);
  const origin = importedSettlementId(1);
  const dest = importedSettlementId(2);

  const sell = createTradeOffer(stateFor(world), world.definition, {
    commandId: 'sell-1',
    settlementId: origin,
    commodityId: 'grain',
    kind: 'sell',
    quantity: 10,
    limitPrice: 1,
  });
  const buy = createTradeOffer(stateFor(world), world.definition, {
    commandId: 'buy-1',
    settlementId: dest,
    commodityId: 'grain',
    kind: 'buy',
    quantity: 3,
    limitPrice: 5,
  });

  let current = cloneWorldState(world.state);
  for (const ev of [...sell.events, ...buy.events]) {
    applyEvent(current, {
      id: `${ev.entityIds[0]}:ev`,
      type: ev.type,
      tick: 0,
      causedByCommandId: 'setup',
      entityIds: ev.entityIds,
      payload: ev.payload,
      schemaVersion: 1,
    });
  }

  const matched = matchTradeOffers(current, world.definition, {
    commandId: 'match-1',
    config: world.config,
  });
  assert.ok(matched.reasonCodes.some((r) => r.code === 'trade_matched'));
  const sellPatch = matched.events.find(
    (e) => e.type === 'entity.patched' && e.payload.id === sell.offerId,
  );
  const buyPatch = matched.events.find(
    (e) => e.type === 'entity.patched' && e.payload.id === buy.offerId,
  );
  assert.equal(sellPatch.payload.status, 'active');
  assert.equal(sellPatch.payload.dataPatch.quantity, 7);
  assert.equal(buyPatch.payload.status, 'inactive');
  assert.equal(buyPatch.payload.dataPatch.quantity, 0);
});

function stateFor(world) {
  return world.state;
}
