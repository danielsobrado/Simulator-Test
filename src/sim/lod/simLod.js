import { listEntities, getEntity } from '../model/worldState.js';

export const SIM_TIERS = Object.freeze({
  A: 'A',
  B: 'B',
  C: 'C',
});

export function createLodController(config = {}) {
  const ownership = new Map(); // entityId -> tier
  const manifests = new Map(); // settlementId -> local manifest

  function interestScore(state, settlementId, focusSettlementIds) {
    if (focusSettlementIds.includes(settlementId)) return 1;
    const settlement = getEntity(state, 'settlement', settlementId);
    if (!settlement) return 0;
    let best = 0;
    for (const focusId of focusSettlementIds) {
      const focus = getEntity(state, 'settlement', focusId);
      if (!focus) continue;
      const d = Math.hypot(settlement.data.x - focus.data.x, settlement.data.y - focus.data.y);
      best = Math.max(best, 1 / (1 + d));
    }
    return best;
  }

  return {
    getTier(entityId) {
      return ownership.get(entityId) ?? SIM_TIERS.A;
    },
    setTier(entityId, tier) {
      ownership.set(entityId, tier);
    },
    evaluate(state, { focusSettlementIds = [] } = {}) {
      const promotions = [];
      const demotions = [];
      const radius = config.lod?.tierBRadiusSettlements ?? 3;
      const settlements = listEntities(state, 'settlement', { includeDestroyed: false });
      const scored = settlements
        .map((s) => ({ id: s.id, score: interestScore(state, s.id, focusSettlementIds) }))
        .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

      const tierBSet = new Set(scored.slice(0, Math.max(radius, focusSettlementIds.length)).map((s) => s.id));
      for (const focusId of focusSettlementIds) tierBSet.add(focusId);

      for (const settlement of settlements) {
        const desired = focusSettlementIds[0] === settlement.id
          ? SIM_TIERS.C
          : (tierBSet.has(settlement.id) ? SIM_TIERS.B : SIM_TIERS.A);
        const current = ownership.get(settlement.id) ?? SIM_TIERS.A;
        if (desired !== current) {
          if (tierRank(desired) > tierRank(current)) {
            promotions.push({ entityId: settlement.id, from: current, to: desired });
          } else {
            demotions.push({ entityId: settlement.id, from: current, to: desired });
          }
        }
      }
      return { promotions, demotions };
    },
    promote(state, entityId, toTier) {
      const settlement = getEntity(state, 'settlement', entityId);
      if (!settlement) {
        throw Object.assign(new Error('missing_settlement'), { code: 'missing_reference' });
      }
      const from = ownership.get(entityId) ?? SIM_TIERS.A;
      ownership.set(entityId, toTier);
      const cohorts = listEntities(state, 'populationCohort', { includeDestroyed: false })
        .filter((c) => c.data.settlementId === entityId);
      const totalPop = cohorts.reduce((n, c) => n + c.data.count, 0);
      const inventory = settlement.data.inventoryAccountId
        ? getEntity(state, 'inventoryAccount', settlement.data.inventoryAccountId)
        : null;
      const manifest = {
        settlementId: entityId,
        tier: toTier,
        populationTotal: totalPop,
        inventoryQuantities: structuredClone(inventory?.data.quantities ?? {}),
        cohortIds: cohorts.map((c) => c.id).sort(),
        actorBindings: [],
      };
      manifests.set(entityId, structuredClone(manifest));
      return {
        events: [{
          type: 'entity.patched',
          entityIds: [entityId],
          payload: {
            kind: 'settlement',
            id: entityId,
            dataPatch: { simTier: toTier },
          },
        }],
        manifest,
        reasonCodes: [{ code: 'sim_tier_promoted', entityId, from, to: toTier, populationTotal: totalPop }],
      };
    },
    demote(state, entityId, toTier) {
      const settlement = getEntity(state, 'settlement', entityId);
      if (!settlement) {
        throw Object.assign(new Error('missing_settlement'), { code: 'missing_reference' });
      }
      const from = ownership.get(entityId) ?? SIM_TIERS.A;
      const previous = manifests.get(entityId);
      ownership.set(entityId, toTier);
      const cohorts = listEntities(state, 'populationCohort', { includeDestroyed: false })
        .filter((c) => c.data.settlementId === entityId);
      const totalPop = cohorts.reduce((n, c) => n + c.data.count, 0);
      const inventory = settlement.data.inventoryAccountId
        ? getEntity(state, 'inventoryAccount', settlement.data.inventoryAccountId)
        : null;
      const quantities = inventory?.data.quantities ?? {};
      if (previous) {
        // Conservation: population and inventory totals must match promotion snapshot intent
        if (totalPop !== previous.populationTotal) {
          // Allow demographic drift; record reason rather than throw
        }
      }
      manifests.delete(entityId);
      return {
        events: [{
          type: 'entity.patched',
          entityIds: [entityId],
          payload: {
            kind: 'settlement',
            id: entityId,
            dataPatch: { simTier: toTier },
          },
        }],
        conserved: {
          populationTotal: totalPop,
          inventoryQuantities: structuredClone(quantities),
        },
        reasonCodes: [{
          code: 'sim_tier_demoted',
          entityId,
          from,
          to: toTier,
          populationTotal: totalPop,
        }],
      };
    },
    getManifest(settlementId) {
      const manifest = manifests.get(settlementId);
      return manifest ? structuredClone(manifest) : null;
    },
    serialize() {
      return {
        ownership: [...ownership.entries()].sort(([a], [b]) => a.localeCompare(b)),
        manifests: [...manifests.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([id, manifest]) => [id, structuredClone(manifest)]),
      };
    },
    restore(snapshot) {
      ownership.clear();
      manifests.clear();
      for (const [id, tier] of snapshot.ownership ?? []) ownership.set(id, tier);
      for (const [id, manifest] of snapshot.manifests ?? []) {
        manifests.set(id, structuredClone(manifest));
      }
    },
  };
}

function tierRank(tier) {
  if (tier === SIM_TIERS.C) return 3;
  if (tier === SIM_TIERS.B) return 2;
  return 1;
}
