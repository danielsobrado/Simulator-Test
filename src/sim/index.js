import { createCommandEnvelope } from './commands/commandEnvelope.js';
import { createCommandDispatcher, registerCommandHandler } from './commands/dispatcher.js';
import { mergeSimulationConfig } from './config/defaultSimulationConfig.js';
import { projectAzgaarWorld } from './import/projectAzgaarWorld.js';
import { createWorldQueries, checksumWorldState } from './queries/worldQueries.js';
import { validateWorldState } from './model/validation/validateWorldState.js';
import {
  buildGeographicGraph,
  findSettlementNodeId,
  shortestPath,
  PathCache,
  setBorderAccessByRegions,
  setEdgeAccessPolicy,
} from './geography/geographicGraph.js';
import {
  createWorldClock,
  createScheduler,
  createFixedStepRunner,
  CADENCES,
  ticksPerDay,
  ticksPerYear,
  calendarFromTick,
} from './time/worldClock.js';
import {
  createLedger,
  initializeSettlementEconomy,
  runDailyEconomy,
  verifyConservation,
  labourSupply,
} from './economy/stockFlow.js';
import {
  planGrainShipment,
  advanceShipments,
  setRouteDanger,
  createTradeOffer,
  matchTradeOffers,
  loseShipment,
} from './logistics/shipments.js';
import {
  initializeSettlementPopulation,
  runMonthlyPopulation,
  promoteNamedPerson,
  settlementPopulationTotal,
} from './population/cohorts.js';
import {
  initializeFactionsFromRegions,
  evaluateFactionDecisions,
  declareConflict,
  setFactionRelationship,
  setFactionEmbargo,
  handleLeaderDeath,
  createMilitaryCompany,
} from './factions/politics.js';
import {
  detectOpportunities,
  createContractFromOpportunity,
  applyContractOutcome,
  createProseAdapter,
  discoverOpportunity,
  listVisibleOpportunities,
  expireContracts,
} from './rpg/consequencePipeline.js';
import { createLodController } from './lod/simLod.js';
import {
  serializeWorldSnapshot,
  restoreWorldSnapshot,
  createCommandJournal,
  createEventHistory,
  createInMemorySaveStore,
  createMigrationRegistry,
  buildDiagnosticReport,
  detectCorruption,
  localizeReplayDivergence,
  SIMULATION_SCHEMA_VERSION,
} from './persistence/snapshot.js';
import {
  createEncounterParty,
  createLocalActors,
  runFixedStepCombat,
  createEncounterSite,
} from './combat/combat.js';
import {
  buildAllOverlays,
  explainFoodShortage,
  buildOpportunityVisibilityViewModel,
  buildPriceCauseViewModel,
} from './presentation/viewModels.js';
import { listEntities, getEntity, cloneWorldState, createAndPutEntity } from './model/worldState.js';
import { createEntityEnvelope } from './model/entityEnvelope.js';
import { generatedEntityId } from './model/ids.js';

const handlerFlag = { registered: false };

function eventsAffectPathfinding(events = []) {
  return events.some((event) => {
    const kind = event?.payload?.kind;
    return kind === 'graphEdge' || kind === 'graphNode';
  });
}

function ensureHandlersRegistered() {
  if (handlerFlag.registered) return;
  handlerFlag.registered = true;

  registerCommandHandler('sim.initializeWorldSystems', (state, command) => {
    const { definition, config } = command.payload.__ctx;
    const events = [];
    let ordinal = 0;
    for (const settlement of listEntities(state, 'settlement', { includeDestroyed: false })) {
      const eco = initializeSettlementEconomy(state, definition, settlement, {
        commandId: command.id,
        config,
        ordinalBase: ordinal,
      });
      events.push(...eco.events);
      ordinal = eco.nextOrdinal;
      const pop = initializeSettlementPopulation(state, definition, settlement, {
        commandId: `${command.id}:pop`,
        ordinalBase: ordinal,
      });
      events.push(...pop.events);
      ordinal = pop.nextOrdinal;
    }
    const factions = initializeFactionsFromRegions(state, definition, {
      commandId: `${command.id}:factions`,
      ordinalBase: 0,
    });
    events.push(...factions.events);
    return events;
  });

  registerCommandHandler('sim.dailyTick', (state, command) => {
    const { definition, config, ledger } = command.payload.__ctx;
    const economy = runDailyEconomy(state, definition, config, ledger);
    const shipments = advanceShipments(state, config);
    command.payload.__result = {
      reasonCodes: [...economy.reasonCodes, ...shipments.reasonCodes],
    };
    return [...economy.events, ...shipments.events];
  });

  registerCommandHandler('sim.monthlyTick', (state, command) => {
    const { definition, config } = command.payload.__ctx;
    const pop = runMonthlyPopulation(state, definition, config);
    const factions = evaluateFactionDecisions(state, definition);
    const expired = expireContracts(state);
    command.payload.__result = {
      reasonCodes: [...pop.reasonCodes, ...factions.reasonCodes, ...expired.reasonCodes],
    };
    return [...pop.events, ...factions.events, ...expired.events];
  });

  registerCommandHandler('sim.planShipment', (state, command) => {
    const { definition, config } = command.payload.__ctx;
    const result = planGrainShipment(state, definition, {
      commandId: command.id,
      originSettlementId: command.payload.originSettlementId,
      destinationSettlementId: command.payload.destinationSettlementId,
      commodityId: command.payload.commodityId ?? 'grain',
      quantity: command.payload.quantity,
      config,
    });
    command.payload.__result = {
      shipmentId: result.shipmentId,
      reasonCodes: result.reasonCodes,
    };
    return result.events;
  });

  registerCommandHandler('sim.matchTrades', (state, command) => {
    const { definition, config } = command.payload.__ctx;
    const result = matchTradeOffers(state, definition, {
      commandId: command.id,
      config,
    });
    command.payload.__result = {
      shipments: result.shipments,
      reasonCodes: result.reasonCodes,
    };
    return result.events;
  });

  registerCommandHandler('sim.setRouteDanger', (state, command) => {
    const result = setRouteDanger(state, command.payload.routeId, command.payload.danger);
    command.payload.__result = { reasonCodes: result.reasonCodes };
    return result.events;
  });

  registerCommandHandler('sim.detectOpportunities', (state, command) => {
    const { definition } = command.payload.__ctx;
    const result = detectOpportunities(state, definition, { commandId: command.id });
    command.payload.__result = { reasonCodes: result.reasonCodes };
    return result.events;
  });

  registerCommandHandler('sim.acceptContract', (state, command) => {
    const { definition } = command.payload.__ctx;
    const result = createContractFromOpportunity(state, definition, {
      commandId: command.id,
      opportunityId: command.payload.opportunityId,
      actorId: command.payload.actorId ?? 'player',
    });
    command.payload.__result = {
      contractId: result.contractId,
      reasonCodes: result.reasonCodes,
    };
    return result.events;
  });

  registerCommandHandler('sim.resolveContract', (state, command) => {
    const result = applyContractOutcome(state, {
      contractId: command.payload.contractId,
      success: command.payload.success !== false,
      outcomeEvents: command.payload.outcomeEvents ?? [],
    });
    command.payload.__result = { reasonCodes: result.reasonCodes };
    return result.events;
  });

  registerCommandHandler('sim.runEncounterCombat', (state, command) => {
    const { definition, config } = command.payload.__ctx;
    const partySetup = createEncounterParty(state, definition, {
      commandId: command.id,
      settlementId: command.payload.settlementId,
      factionId: command.payload.factionId ?? null,
      members: command.payload.members,
    });

    // Materialize characters into working state for combat HP resolution.
    for (const ev of partySetup.events) {
      if (ev.type === 'entity.upserted' && !getEntity(state, ev.payload.kind, ev.payload.id)) {
        createAndPutEntity(state, {
          id: ev.payload.id,
          kind: ev.payload.kind,
          createdAtTick: command.issuedAtTick,
          updatedAtTick: command.issuedAtTick,
          data: ev.payload.data,
          tags: ev.payload.tags ?? [],
        });
      }
    }

    const characters = partySetup.characterIds.map((id) => getEntity(state, 'character', id));
    const actors = createLocalActors(characters, partySetup.partyId);
    const combat = runFixedStepCombat(state, definition, {
      encounterId: partySetup.partyId,
      actors,
      config,
    });

    // Avoid duplicate upserts: return patches only for characters already inserted,
    // and party upsert + character upserts that reducers will skip if we convert
    // character upserts into patches when already present.
    const events = [];
    for (const ev of partySetup.events) {
      if (ev.type === 'entity.upserted' && getEntity(state, ev.payload.kind, ev.payload.id)) {
        // Already materialized — emit patch to sync revision via reducer path by
        // replacing with a no-op skip: only emit party if not conflicting.
        if (ev.payload.kind === 'party') {
          // Remove and re-add via events: delete from map then upsert through events
          state.parties.delete(ev.payload.id);
          events.push(ev);
        } else if (ev.payload.kind === 'character') {
          state.characters.delete(ev.payload.id);
          events.push(ev);
        } else {
          events.push(ev);
        }
      } else {
        events.push(ev);
      }
    }
    events.push(...combat.events);

    command.payload.__result = {
      partyId: partySetup.partyId,
      characterIds: partySetup.characterIds,
      combatResult: combat.result,
      reasonCodes: combat.reasonCodes,
      log: combat.log,
    };
    return events;
  });

  registerCommandHandler('sim.promoteSettlement', (state, command) => {
    const lod = command.payload.__ctx.lod;
    const result = lod.promote(state, command.payload.settlementId, command.payload.tier);
    command.payload.__result = { reasonCodes: result.reasonCodes, manifest: result.manifest };
    return result.events;
  });

  registerCommandHandler('sim.demoteSettlement', (state, command) => {
    const lod = command.payload.__ctx.lod;
    const result = lod.demote(state, command.payload.settlementId, command.payload.tier);
    command.payload.__result = { reasonCodes: result.reasonCodes, conserved: result.conserved };
    return result.events;
  });

  registerCommandHandler('sim.declareConflict', (state, command) => {
    const { definition } = command.payload.__ctx;
    const result = declareConflict(state, definition, {
      commandId: command.id,
      type: command.payload.type,
      factionIds: command.payload.factionIds,
      regionIds: command.payload.regionIds ?? [],
    });
    command.payload.__result = { conflictId: result.conflictId, reasonCodes: result.reasonCodes };
    return result.events;
  });

  registerCommandHandler('sim.promotePerson', (state, command) => {
    const { definition } = command.payload.__ctx;
    const result = promoteNamedPerson(state, definition, {
      commandId: command.id,
      settlementId: command.payload.settlementId,
      name: command.payload.name,
      role: command.payload.role,
      factionId: command.payload.factionId ?? null,
    });
    command.payload.__result = { characterId: result.characterId, reasonCodes: result.reasonCodes };
    return result.events;
  });

  registerCommandHandler('sim.createEncounterSite', (state, command) => {
    const { definition } = command.payload.__ctx;
    const result = createEncounterSite(state, definition, {
      commandId: command.id,
      settlementId: command.payload.settlementId,
      danger: command.payload.danger ?? 0.8,
    });
    command.payload.__result = { encounterSiteId: result.encounterSiteId };
    return result.events;
  });

  registerCommandHandler('sim.patchFactionRelationship', (state, command) => {
    const result = setFactionRelationship(
      state,
      command.payload.factionAId,
      command.payload.factionBId,
      command.payload.dimensions ?? {},
    );
    command.payload.__result = { reasonCodes: result.reasonCodes };
    return result.events;
  });
}

export function createSimulationWorld({
  campaign,
  config: partialConfig = {},
  worldId = null,
} = {}) {
  ensureHandlersRegistered();

  const config = mergeSimulationConfig(partialConfig);
  const projected = projectAzgaarWorld(campaign, {
    worldId,
    schemaVersion: config.schemaVersion,
    simulationConfig: config,
  });

  let definition = projected.definition;
  let state = projected.state;
  const ledger = createLedger();
  const journal = createCommandJournal();
  const eventHistory = createEventHistory();
  const pathCache = new PathCache(config.geography.pathCacheEntries);
  const lod = createLodController(config);
  const saveStore = createInMemorySaveStore();
  const migrations = createMigrationRegistry();
  const reasonLog = [];
  let commandSeq = 0;

  const clock = createWorldClock(config.time, state.calendar.tick);
  const scheduler = createScheduler(clock);

  function recordAccepted(command, events) {
    journal.append(command);
    for (const event of events) {
      eventHistory.append(event, { important: true });
    }
  }

  const dispatcher = createCommandDispatcher({ onAccepted: recordAccepted });
  const isolatedDispatcher = createCommandDispatcher();

  scheduler.registerSystem({
    id: 'economy.daily',
    cadence: CADENCES.day,
    catchUp: 'exact',
  });
  scheduler.registerSystem({
    id: 'population.monthly',
    cadence: CADENCES.month,
    catchUp: 'aggregate',
  });

  function ctx() {
    return { definition, config, ledger, lod };
  }

  function nextCommandId(prefix) {
    commandSeq += 1;
    return `${prefix}:${definition.worldId}:${commandSeq}`;
  }

  function dispatch(type, payload = {}) {
    const envelope = createCommandEnvelope({
      id: nextCommandId(type),
      type,
      issuedAtTick: clock.getTick(),
      actorId: payload.actorId ?? 'system',
      expectedWorldRevision: null,
      payload,
      source: payload.source ?? 'system',
    });
    const result = dispatcher.dispatch(state, envelope, ctx());
    if (result.ok) {
      state = result.state;
      state.calendar = calendarFromTick(clock.getTick(), clock.getConfig());
      if (eventsAffectPathfinding(result.events)) {
        pathCache.clear();
      }
      if (result.result?.reasonCodes) {
        reasonLog.push(...result.result.reasonCodes);
      }
    }
    return {
      ...result,
      command: envelope,
    };
  }

  function dispatchBatch(envelopes) {
    let current = state;
    const accepted = [];
    const events = [];
    for (const envelope of envelopes) {
      const result = isolatedDispatcher.dispatch(current, envelope, ctx());
      if (!result.ok) {
        return { ...result, command: envelope };
      }
      current = result.state;
      accepted.push({ command: envelope, events: result.events });
      events.push(...result.events);
    }
    state = current;
    state.calendar = calendarFromTick(clock.getTick(), clock.getConfig());
    for (const entry of accepted) {
      recordAccepted(entry.command, entry.events);
    }
    if (eventsAffectPathfinding(events)) {
      pathCache.clear();
    }
    return { ok: true, code: 'accepted', events, state };
  }

  const runner = createFixedStepRunner({
    clock,
    scheduler,
    calendarConfig: config.time,
    onCadence(event) {
      if (event.cadence === CADENCES.day) {
        dispatch('sim.dailyTick', {});
      }
      if (event.cadence === CADENCES.month) {
        dispatch('sim.monthlyTick', {});
      }
    },
  });

  function stepSimulationTicks(ticks) {
    try {
      return runner.stepTicks(ticks, {});
    } finally {
      state.calendar = calendarFromTick(clock.getTick(), clock.getConfig());
    }
  }

  function requireSavedArray(value, field) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      throw new Error(`invalid_save_payload:${field}`);
    }
    return value;
  }

  function stageLoadedPayload(payload, restored) {
    const nextClockTick = payload.clockTick ?? restored.state.calendar.tick;
    const validationClock = createWorldClock(config.time, nextClockTick);
    const stagedScheduler = createScheduler(validationClock);
    if (payload.scheduler !== undefined) {
      stagedScheduler.restore(payload.scheduler);
    }

    const stagedLod = createLodController(config);
    stagedLod.restore(payload.lod ?? { ownership: [], manifests: [] });

    const stagedJournal = createCommandJournal();
    for (const command of requireSavedArray(payload.journal, 'journal')) {
      stagedJournal.append(command);
    }

    const stagedEventHistory = createEventHistory();
    for (const savedEvent of requireSavedArray(payload.eventHistory, 'eventHistory')) {
      const { important = false, ...event } = savedEvent;
      stagedEventHistory.append(event, { important });
    }

    const stagedLedger = createLedger();
    for (const entry of requireSavedArray(payload.ledger, 'ledger')) {
      stagedLedger.record(entry);
    }

    const stagedReasonLog = structuredClone(requireSavedArray(payload.reasonLog, 'reasonLog'));
    const stagedCommandSeq = payload.commandSeq ?? commandSeq;
    if (!Number.isSafeInteger(stagedCommandSeq) || stagedCommandSeq < 0) {
      throw new Error('invalid_save_payload:commandSeq');
    }

    return {
      clockTick: validationClock.getTick(),
      scheduler: stagedScheduler.serialize(),
      lod: stagedLod.serialize(),
      journal: stagedJournal.list(),
      eventHistory: stagedEventHistory.list(),
      ledger: stagedLedger.list(),
      reasonLog: stagedReasonLog,
      commandSeq: stagedCommandSeq,
    };
  }

  return {
    get definition() { return definition; },
    get state() { return state; },
    get config() { return config; },
    get clock() { return clock; },
    get scheduler() { return scheduler; },
    get ledger() { return ledger; },
    get lod() { return lod; },
    get reasonLog() { return reasonLog; },
    get proseAdapter() { return createProseAdapter(); },

    queries() {
      return createWorldQueries(definition, state);
    },

    validate() {
      return validateWorldState(state);
    },

    checksum() {
      return checksumWorldState(state);
    },

    dispatch,

    buildGraph() {
      const working = cloneWorldState(state);
      const summary = buildGeographicGraph(working, definition, {
        commandId: nextCommandId('graph'),
        config,
      });
      working.revision = state.revision + 1;
      state = working;
      pathCache.clear();
      return { ok: true, ...summary };
    },

    initializeSystems() {
      return dispatch('sim.initializeWorldSystems', {});
    },

    stepDays(days = 1) {
      const dayTicks = ticksPerDay(clock.getConfig());
      return stepSimulationTicks(dayTicks * days);
    },

    stepMonths(months = 1) {
      return this.stepDays(months * (clock.getConfig().daysPerMonth));
    },

    stepTicks(ticks = 1) {
      return stepSimulationTicks(ticks);
    },

    pause() { clock.pause(); },
    resume() { clock.resume(); },

    planShipment(payload) {
      return dispatch('sim.planShipment', payload);
    },

    setRouteDanger(routeId, danger) {
      return dispatch('sim.setRouteDanger', { routeId, danger });
    },

    detectOpportunities() {
      return dispatch('sim.detectOpportunities', {});
    },

    acceptContract(opportunityId, actorId = 'player') {
      return dispatch('sim.acceptContract', { opportunityId, actorId });
    },

    resolveContract(contractId, success = true) {
      return dispatch('sim.resolveContract', { contractId, success });
    },

    runEncounterCombat(payload) {
      return dispatch('sim.runEncounterCombat', payload);
    },

    promoteSettlement(settlementId, tier = 'C') {
      return dispatch('sim.promoteSettlement', { settlementId, tier });
    },

    demoteSettlement(settlementId, tier = 'A') {
      return dispatch('sim.demoteSettlement', { settlementId, tier });
    },

    declareConflict(payload) {
      return dispatch('sim.declareConflict', payload);
    },

    promotePerson(payload) {
      return dispatch('sim.promotePerson', payload);
    },

    createEncounterSite(payload) {
      return dispatch('sim.createEncounterSite', payload);
    },

    setFactionRelationship(factionAId, factionBId, dimensions) {
      return dispatch('sim.patchFactionRelationship', {
        factionAId,
        factionBId,
        dimensions,
      });
    },

    setBorderAccess(regionAId, regionBId, accessPolicy) {
      const result = setBorderAccessByRegions(state, regionAId, regionBId, accessPolicy);
      const envelopes = result.events.map((event) => createCommandEnvelope({
        id: nextCommandId('border'),
        type: 'sim.patchEntity',
        issuedAtTick: clock.getTick(),
        payload: event.payload,
      }));
      const dispatched = dispatchBatch(envelopes);
      if (!dispatched.ok) return dispatched;
      reasonLog.push(...result.reasonCodes);
      return { ok: true, reasonCodes: result.reasonCodes };
    },

    setEdgeAccess(edgeId, accessPolicy) {
      const result = setEdgeAccessPolicy(state, edgeId, accessPolicy);
      const dispatched = dispatch('sim.patchEntity', result.events[0].payload);
      if (dispatched.ok) reasonLog.push(...result.reasonCodes);
      return { ...dispatched, reasonCodes: result.reasonCodes };
    },

    createTradeOffer(payload) {
      const result = createTradeOffer(state, definition, {
        commandId: nextCommandId('offer'),
        ...payload,
      });
      const envelopes = result.events.map((event) => createCommandEnvelope({
        id: nextCommandId('offer'),
        type: 'sim.upsertEntity',
        issuedAtTick: clock.getTick(),
        payload: event.payload,
      }));
      const dispatched = dispatchBatch(envelopes);
      if (!dispatched.ok) return dispatched;
      reasonLog.push(...result.reasonCodes);
      return { ok: true, result: { offerId: result.offerId }, reasonCodes: result.reasonCodes };
    },

    matchTrades() {
      const dispatched = dispatch('sim.matchTrades', {});
      return {
        ...dispatched,
        reasonCodes: dispatched.result?.reasonCodes ?? [],
      };
    },

    loseShipment(shipmentId, options = {}) {
      const result = loseShipment(state, shipmentId, options);
      const envelopes = result.events.map((event) => createCommandEnvelope({
        id: nextCommandId('lose'),
        type: 'sim.patchEntity',
        issuedAtTick: clock.getTick(),
        payload: event.payload,
      }));
      const dispatched = dispatchBatch(envelopes);
      if (!dispatched.ok) return dispatched;
      reasonLog.push(...result.reasonCodes);
      return { ok: true, reasonCodes: result.reasonCodes };
    },

    setEmbargo(factionId, againstFactionId, enabled = true) {
      const result = setFactionEmbargo(state, factionId, againstFactionId, enabled);
      return dispatch('sim.patchEntity', result.events[0].payload);
    },

    succeedLeader(factionId) {
      const result = handleLeaderDeath(state, definition, {
        commandId: nextCommandId('succession'),
        factionId,
      });
      const envelopes = result.events.map((event) => createCommandEnvelope({
        id: nextCommandId('succession'),
        type: event.type === 'entity.upserted' ? 'sim.upsertEntity' : 'sim.patchEntity',
        issuedAtTick: clock.getTick(),
        payload: event.payload,
      }));
      const dispatched = dispatchBatch(envelopes);
      if (!dispatched.ok) return dispatched;
      reasonLog.push(...result.reasonCodes);
      return { ok: true, result: { successorId: result.successorId }, reasonCodes: result.reasonCodes };
    },

    createMilitaryCompany(payload) {
      const result = createMilitaryCompany(state, definition, {
        commandId: nextCommandId('military'),
        ...payload,
      });
      return dispatch('sim.upsertEntity', result.events[0].payload);
    },

    discoverOpportunity(opportunityId, actorId = 'player') {
      const result = discoverOpportunity(state, opportunityId, actorId);
      return dispatch('sim.patchEntity', result.events[0].payload);
    },

    visibleOpportunities(actorId = 'player') {
      return listVisibleOpportunities(state, actorId).map((o) => structuredClone(o));
    },

    verifyConservation() {
      return verifyConservation(state, ledger, config.commodities);
    },

    labourSupply(settlementId) {
      return labourSupply(state, settlementId);
    },

    populationTotal(settlementId) {
      return settlementPopulationTotal(state, settlementId);
    },

    explainFoodShortage(settlementId) {
      return explainFoodShortage(createWorldQueries(definition, state), settlementId);
    },

    opportunityVisibility(actorId = 'player') {
      return buildOpportunityVisibilityViewModel(createWorldQueries(definition, state), actorId);
    },

    priceCause(settlementId) {
      return buildPriceCauseViewModel(createWorldQueries(definition, state), settlementId);
    },

    detectCorruption(snapshot) {
      return detectCorruption(snapshot ?? this.snapshot());
    },

    localizeDivergence(otherState) {
      return localizeReplayDivergence(state, otherState);
    },

    findPath(fromSettlementId, toSettlementId) {
      const from = findSettlementNodeId(state, fromSettlementId);
      const to = findSettlementNodeId(state, toSettlementId);
      if (!from || !to) return { ok: false, code: 'missing_nodes' };
      const cached = pathCache.get(from, to);
      if (cached) return structuredClone(cached);
      const path = shortestPath(state, from, to, {
        dangerWeight: config.geography.dangerWeight,
        tollWeight: config.geography.tollWeight,
      });
      pathCache.set(from, to, structuredClone(path));
      return path;
    },

    snapshot() {
      return serializeWorldSnapshot({
        definition,
        state,
        commandRange: { count: journal.list().length },
      });
    },

    async save(slot = 'default') {
      const snap = this.snapshot();
      const payload = {
        snapshot: snap,
        journal: journal.list(),
        eventHistory: eventHistory.list(),
        ledger: ledger.list(),
        lod: lod.serialize(),
        reasonLog: structuredClone(reasonLog),
        commandSeq,
        clockTick: clock.getTick(),
        scheduler: scheduler.serialize(),
      };
      const pendingSave = await saveStore.beginSave(slot, payload);
      return saveStore.commitSave(slot, pendingSave.transactionId);
    },

    async load(slot = 'default') {
      const loaded = await saveStore.load(slot);
      if (!loaded.ok) return loaded;
      const corruption = detectCorruption(loaded.payload.snapshot);
      if (!corruption.ok) return corruption;
      const restored = restoreWorldSnapshot(loaded.payload.snapshot);
      const staged = stageLoadedPayload(loaded.payload, restored);

      definition = restored.definition;
      state = restored.state;
      clock.setTick(staged.clockTick);
      state.calendar = calendarFromTick(clock.getTick(), clock.getConfig());
      lod.restore(staged.lod);
      scheduler.restore(staged.scheduler);
      journal.clear();
      for (const command of staged.journal) journal.append(command);
      eventHistory.clear();
      for (const savedEvent of staged.eventHistory) {
        const { important = false, ...event } = savedEvent;
        eventHistory.append(event, { important });
      }
      ledger.clear();
      for (const entry of staged.ledger) ledger.record(entry);
      reasonLog.length = 0;
      reasonLog.push(...staged.reasonLog);
      commandSeq = staged.commandSeq;
      pathCache.clear();
      return { ok: true, checksum: restored.checksum };
    },

    replayFromSnapshot(snapshot, commands) {
      const restored = restoreWorldSnapshot(snapshot);
      const replayLedger = createLedger();
      const replayLod = createLodController(config);
      replayLod.restore(lod.serialize());
      let current = restored.state;
      const applied = [];
      const accepted = [];
      for (const command of commands) {
        const result = isolatedDispatcher.dispatch(current, command, {
          definition: restored.definition,
          config,
          ledger: replayLedger,
          lod: replayLod,
        });
        if (!result.ok) {
          return { ok: false, code: result.code, applied, state: current };
        }
        current = result.state;
        applied.push(command.id);
        accepted.push({ command, events: result.events });
      }
      definition = restored.definition;
      state = current;
      clock.setTick(state.calendar.tick);
      lod.restore(replayLod.serialize());
      for (const entry of replayLedger.list()) ledger.record(entry);
      for (const entry of accepted) recordAccepted(entry.command, entry.events);
      pathCache.clear();
      return { ok: true, code: 'ok', applied, state, definition };
    },

    getJournal() {
      return journal.list();
    },

    diagnosticReport() {
      return buildDiagnosticReport({
        definition,
        state,
        queries: createWorldQueries(definition, state),
      });
    },

    presentation() {
      return buildAllOverlays(createWorldQueries(definition, state), {
        reasonCodes: reasonLog,
        clock,
        report: this.diagnosticReport(),
      });
    },

    soakYear() {
      const beforeEntities = createWorldQueries(definition, state).countByKind();
      const days = ticksPerYear(clock.getConfig()) / ticksPerDay(clock.getConfig());
      this.stepDays(days);
      const afterEntities = createWorldQueries(definition, state).countByKind();
      return {
        beforeEntities,
        afterEntities,
        tick: clock.getTick(),
        checksum: this.checksum(),
      };
    },

    migrations,
    saveStore,
  };
}

export function createMiniCampaignFixture() {
  return {
    source: {
      type: 'azgaar-campaign-fixture',
      version: 'test',
      mapId: 'slice-world',
      mapName: 'Vertical Slice',
      seed: 'slice-seed-1',
      sourceWidth: 1000,
      sourceHeight: 800,
    },
    states: [{ i: 1, name: 'Northreach', color: '#336699' }],
    provinces: [
      { i: 1, name: 'Harbor Vale', state: 1 },
      { i: 2, name: 'Inland March', state: 1 },
    ],
    cultures: [{ i: 1, name: 'Riverfolk' }],
    religions: [{ i: 1, name: 'Old Light' }],
    burgs: [
      { i: 1, name: 'Harborwatch', x: 200, y: 200, state: 1, province: 1, capital: true, population: 400 },
      { i: 2, name: 'Millford', x: 500, y: 220, state: 1, province: 1, population: 250 },
      { i: 3, name: 'Stonegate', x: 800, y: 240, state: 1, province: 2, population: 300 },
    ],
    routes: [
      {
        i: 1,
        group: 'roads',
        points: [[200, 200], [500, 220]],
      },
      {
        i: 2,
        group: 'roads',
        points: [[500, 220], [800, 240]],
      },
    ],
    rivers: [],
  };
}

export {
  projectAzgaarWorld,
  mergeSimulationConfig,
  createCommandEnvelope,
  checksumWorldState,
  serializeWorldSnapshot,
  restoreWorldSnapshot,
  validateWorldState,
  buildAllOverlays,
  createEntityEnvelope,
  generatedEntityId,
  CADENCES,
  ticksPerDay,
  ticksPerYear,
  createWorldQueries,
  detectCorruption,
  localizeReplayDivergence,
  SIMULATION_SCHEMA_VERSION,
  explainFoodShortage,
  verifyConservation,
  createMigrationRegistry,
};
