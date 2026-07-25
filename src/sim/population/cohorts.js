import { generatedEntityId } from '../model/ids.js';
import { getEntity, listEntities, createAndPutEntity } from '../model/worldState.js';
import { createSeededRng, hashString } from '../util/seededRng.js';

const AGE_BANDS = Object.freeze(['child', 'working', 'elder']);
const ROLES = Object.freeze([
  'farmers', 'labourers', 'artisans', 'merchants', 'soldiers',
  'clergy', 'scholars', 'nobles', 'unemployed', 'displaced',
]);
const WEALTH_BANDS = Object.freeze(['poor', 'middle', 'wealthy']);

export function initializeSettlementPopulation(state, definition, settlement, {
  commandId,
  ordinalBase = 0,
}) {
  const events = [];
  let ordinal = ordinalBase;
  const total = Math.max(30, Math.floor(settlement.data.population || 100));
  const working = Math.floor(total * 0.6);
  const child = Math.floor(total * 0.25);
  const elder = total - working - child;

  const cohorts = [
    { ageBand: 'child', role: 'unemployed', wealthBand: 'poor', count: child },
    { ageBand: 'working', role: 'farmers', wealthBand: 'middle', count: Math.floor(working * 0.5) },
    { ageBand: 'working', role: 'labourers', wealthBand: 'poor', count: Math.floor(working * 0.3) },
    { ageBand: 'working', role: 'artisans', wealthBand: 'middle', count: Math.floor(working * 0.15) },
    { ageBand: 'working', role: 'soldiers', wealthBand: 'middle', count: Math.max(1, working - Math.floor(working * 0.95)) },
    { ageBand: 'elder', role: 'unemployed', wealthBand: 'poor', count: elder },
  ];

  const cohortIds = [];
  for (const cohort of cohorts) {
    if (cohort.count <= 0) continue;
    const id = generatedEntityId('populationCohort', definition.worldId, commandId, ordinal);
    ordinal += 1;
    cohortIds.push(id);
    events.push({
      type: 'entity.upserted',
      entityIds: [id],
      payload: {
        kind: 'populationCohort',
        id,
        data: {
          settlementId: settlement.id,
          cultureId: null,
          religionId: null,
          ageBand: cohort.ageBand,
          role: cohort.role,
          wealthBand: cohort.wealthBand,
          count: cohort.count,
          health: 1,
          education: cohort.role === 'scholars' ? 0.8 : 0.3,
          loyalty: 0.7,
        },
      },
    });
  }

  events.push({
    type: 'entity.patched',
    entityIds: [settlement.id],
    payload: {
      kind: 'settlement',
      id: settlement.id,
      dataPatch: {
        population: total,
        cohortIds,
        social: {
          happiness: 0.7,
          unrest: 0.1,
          foodPressure: 0,
          migrationPressure: 0,
        },
      },
    },
  });

  return { events, nextOrdinal: ordinal, cohortIds };
}

export function runMonthlyPopulation(state, definition, config) {
  const events = [];
  const reasonCodes = [];
  const rng = createSeededRng(hashString(`${definition.seed}:pop:${state.calendar.tick}`));
  const birthRate = config.population?.birthRatePerMonth ?? 0.002;
  const deathRate = config.population?.deathRatePerMonth ?? 0.0015;
  const migrationThreshold = config.population?.migrationThreshold ?? 0.4;

  // Apply demography to working state first so later migration sees updated counts.
  for (const settlement of listEntities(state, 'settlement', { includeDestroyed: false })) {
    const market = settlement.data.marketId
      ? getEntity(state, 'market', settlement.data.marketId)
      : null;
    const foodSecurity = market?.data.foodSecurity ?? 1;
    const cohorts = listEntities(state, 'populationCohort', { includeDestroyed: false })
      .filter((c) => c.data.settlementId === settlement.id);

    let total = 0;
    for (const cohort of cohorts) {
      let count = cohort.data.count;
      const births = cohort.data.ageBand === 'working'
        ? Math.floor(count * birthRate * foodSecurity)
        : 0;
      const deaths = Math.floor(count * deathRate * (2 - foodSecurity));
      count = Math.max(0, count + births - deaths);
      total += count;
      const health = Math.max(0.1, Math.min(1, (cohort.data.health ?? 1) * (0.9 + 0.1 * foodSecurity)));
      cohort.data.count = count;
      cohort.data.health = health;
      if (deaths > 0) {
        reasonCodes.push({ code: 'cohort_deaths', cohortId: cohort.id, deaths });
      }
      if (births > 0) {
        reasonCodes.push({ code: 'cohort_births', cohortId: cohort.id, births });
      }
    }

    const foodPressure = Math.max(0, 1 - foodSecurity);
    const housing = applyHousingAndDisease(state, settlement, foodSecurity, config);
    reasonCodes.push(...housing.reasonCodes);
    const unrest = Math.min(
      1,
      (settlement.data.social?.unrest ?? 0.1) * 0.9
        + foodPressure * 0.2
        + housing.diseasePressure * 0.1,
    );
    const migrationPressure = foodPressure > migrationThreshold
      ? foodPressure + rng.nextFloat() * 0.1 + housing.housingPressure * 0.2
      : Math.max(0, (settlement.data.social?.migrationPressure ?? 0) * 0.8);

    if (migrationPressure > migrationThreshold) {
      reasonCodes.push({
        code: 'migration_pressure',
        settlementId: settlement.id,
        migrationPressure,
        components: {
          foodPressure,
          housingPressure: housing.housingPressure,
          diseasePressure: housing.diseasePressure,
        },
      });
    }

    settlement.data.population = total;
    settlement.data.housingCapacity = housing.housingCapacity;
    settlement.data.social = {
      happiness: Math.max(0, Math.min(1, foodSecurity * 0.8 + (1 - unrest) * 0.2)),
      unrest,
      foodPressure,
      migrationPressure,
      housingPressure: housing.housingPressure,
      diseasePressure: housing.diseasePressure,
    };
  }

  const migration = migrateBetweenSettlements(state, definition, config);
  reasonCodes.push(...migration.reasonCodes);

  // Creates must precede patches so new destination cohorts exist when patched.
  events.push(...(migration.createEvents ?? []));

  // Emit final authoritative patches after demography + migration.
  for (const cohort of listEntities(state, 'populationCohort', { includeDestroyed: false })) {
    events.push({
      type: 'entity.patched',
      entityIds: [cohort.id],
      payload: {
        kind: 'populationCohort',
        id: cohort.id,
        dataPatch: {
          count: cohort.data.count,
          health: cohort.data.health,
        },
      },
    });
  }
  for (const settlement of listEntities(state, 'settlement', { includeDestroyed: false })) {
    const total = settlementPopulationTotal(state, settlement.id);
    settlement.data.population = total;
    events.push({
      type: 'entity.patched',
      entityIds: [settlement.id],
      payload: {
        kind: 'settlement',
        id: settlement.id,
        dataPatch: {
          population: total,
          housingCapacity: settlement.data.housingCapacity,
          social: settlement.data.social,
        },
      },
    });
  }

  return { events, reasonCodes };
}

export function promoteNamedPerson(state, definition, {
  commandId,
  settlementId,
  name,
  role = 'merchant',
  factionId = null,
  ordinal = 0,
}) {
  const id = generatedEntityId('character', definition.worldId, commandId, ordinal);
  return {
    characterId: id,
    events: [{
      type: 'entity.upserted',
      entityIds: [id],
      payload: {
        kind: 'character',
        id,
        data: {
          personId: id,
          name,
          speciesId: 'human',
          factionId,
          homeSettlementId: settlementId,
          role,
          level: 1,
          attributes: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          skills: {},
          equipmentInventoryId: null,
          healthState: { hp: 20, maxHp: 20 },
          relationshipState: {},
          tags: ['named'],
        },
      },
    }],
    reasonCodes: [{ code: 'person_promoted', characterId: id, settlementId }],
  };
}

export { AGE_BANDS, ROLES, WEALTH_BANDS };

export function settlementPopulationTotal(state, settlementId) {
  const cohorts = listEntities(state, 'populationCohort', { includeDestroyed: false })
    .filter((c) => c.data.settlementId === settlementId && c.status === 'active');
  const promoted = listEntities(state, 'character', { includeDestroyed: false })
    .filter((c) => c.data.homeSettlementId === settlementId && c.status === 'active' && c.data.countsInPopulation !== false);
  return cohorts.reduce((n, c) => n + c.data.count, 0) + promoted.length;
}

export function applyHousingAndDisease(state, settlement, foodSecurity, config) {
  const housingCapacity = settlement.data.housingCapacity
    ?? Math.max(50, Math.floor((settlement.data.population || 100) * 1.2));
  const population = settlement.data.population || 0;
  const housingPressure = Math.max(0, (population - housingCapacity) / Math.max(1, housingCapacity));
  const diseasePressure = Math.max(0, (1 - foodSecurity) * 0.5 + housingPressure * 0.5);
  return {
    housingCapacity,
    housingPressure,
    diseasePressure,
    reasonCodes: diseasePressure > 0.3
      ? [{ code: 'disease_pressure', settlementId: settlement.id, diseasePressure, housingPressure }]
      : [],
  };
}

export function migrateBetweenSettlements(state, definition, config) {
  const events = [];
  const createEvents = [];
  const reasonCodes = [];
  const settlements = listEntities(state, 'settlement', { includeDestroyed: false });
  const threshold = config.population?.migrationThreshold ?? 0.4;
  let createOrdinal = 0;

  for (const from of settlements) {
    const pressure = from.data.social?.migrationPressure ?? 0;
    if (pressure < threshold) continue;
    const candidates = settlements
      .filter((s) => s.id !== from.id)
      .map((s) => ({
        settlement: s,
        score: (s.data.social?.happiness ?? 0.5) - (s.data.social?.foodPressure ?? 0),
      }))
      .sort((a, b) => b.score - a.score || a.settlement.id.localeCompare(b.settlement.id));
    if (candidates.length === 0) continue;
    const to = candidates[0].settlement;
    const fromNode = listEntities(state, 'graphNode', { includeDestroyed: false })
      .find((n) => n.data.settlementId === from.id);
    const toNode = listEntities(state, 'graphNode', { includeDestroyed: false })
      .find((n) => n.data.settlementId === to.id);
    if (fromNode && toNode) {
      const hasEdge = listEntities(state, 'graphEdge', { includeDestroyed: false })
        .some((e) => e.data.fromNodeId === fromNode.id && e.data.accessPolicy !== 'closed');
      if (!hasEdge) {
        reasonCodes.push({ code: 'migration_blocked_no_route', from: from.id, to: to.id });
        continue;
      }
    }
    const fromCohorts = listEntities(state, 'populationCohort', { includeDestroyed: false })
      .filter((c) => c.data.settlementId === from.id && c.data.ageBand === 'working' && c.data.count > 0)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (fromCohorts.length === 0) continue;
    const movers = Math.min(5, Math.floor(fromCohorts[0].data.count * 0.05) || 1);
    const source = fromCohorts[0];
    let destCohort = listEntities(state, 'populationCohort', { includeDestroyed: false })
      .find((c) => c.data.settlementId === to.id
        && c.data.ageBand === source.data.ageBand
        && c.data.role === source.data.role);

    source.data.count -= movers;

    if (!destCohort) {
      const id = generatedEntityId(
        'populationCohort',
        definition.worldId,
        `migrate:${state.calendar.tick}`,
        createOrdinal,
      );
      createOrdinal += 1;
      destCohort = createAndPutEntity(state, {
        id,
        kind: 'populationCohort',
        createdAtTick: state.calendar.tick,
        updatedAtTick: state.calendar.tick,
        data: {
          settlementId: to.id,
          cultureId: source.data.cultureId ?? null,
          religionId: source.data.religionId ?? null,
          ageBand: source.data.ageBand,
          role: source.data.role,
          wealthBand: source.data.wealthBand,
          count: 0,
          health: source.data.health ?? 1,
          education: source.data.education ?? 0.3,
          loyalty: source.data.loyalty ?? 0.7,
        },
      });
      createEvents.push({
        type: 'entity.upserted',
        entityIds: [id],
        payload: {
          kind: 'populationCohort',
          id,
          data: { ...destCohort.data },
        },
      });
    }
    destCohort.data.count += movers;

    reasonCodes.push({
      code: 'migration_moved',
      fromSettlementId: from.id,
      toSettlementId: to.id,
      movers,
      routeRisk: true,
    });
  }
  return { events, createEvents, reasonCodes };
}

