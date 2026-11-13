import { WorkshopSpatialIndex } from '../spatial/WorkshopSpatialIndex.js';
import { resolveShapeRoofJunctions } from './ShapeRoofJunctions.js';

// A contact already resolved as "walls only" (a turret through its host's eave) stays that way.
function neighbor(plan, roofOnly = false, prior = null) {
  return { id: plan.id, primitive: plan.primitive, curve: plan.curve,
    boundary: plan.boundary, topBoundary: plan.topBoundary,
    roofReplaced: Boolean(plan.roofReplaced || prior?.roofReplaced), roofOnly };
}

const hasProjection = (plan) => plan.features?.some((f) => f.balcony || f.solidSupport);

/** Projected envelopes participate in the same spatial contact layer as authored volumes. */
export function resolveShapeFeatureContacts(plans) {
  if (!plans.some((p) => p.features?.some((f) => f.child) || hasProjection(p))) return { plans, contacts: [] };
  const entries = new Map();
  for (const plan of plans) {
    if (plan.primitive.kind !== 'curved-volume') continue;
    entries.set(plan.id, { plan, ownerId: plan.id, roofOnly: false });
    for (const feature of plan.features ?? []) if (feature.child) {
      entries.set(feature.child.id, { plan: feature.child, ownerId: plan.id, roofOnly: Boolean(feature.openSides) });
    }
  }
  const index = new WorkshopSpatialIndex({
    listEntities: () => [...entries.values()].map(({ plan }) => ({ id: plan.id, properties: { spatialBounds: plan.bounds } })),
    getEntity: (id) => entries.get(id)?.plan,
  });
  const contacts = new Map();
  function resolve(plan, ownerId, child = false) {
    // Retain existing exact body contacts, refreshing their resolved roof ownership.
    const neighbors = new Map((plan.neighbors ?? []).map((n) => {
      const entry = entries.get(n.id);
      return [n.id, entry ? neighbor(entry.plan, entry.roofOnly, n) : n];
    }));
    for (const id of index.queryBounds(plan.bounds, { excludeIds: [plan.id] })) {
      const entry = entries.get(id);
      // Root/root contacts already have exact envelope tests in the base chemistry.
      if (!child && entry.ownerId === id && entry.ownerId !== ownerId && !hasProjection(plan)) continue;
      neighbors.set(id, neighbor(entry.plan, entry.roofOnly, neighbors.get(id)));
      if (entry.ownerId !== ownerId && (child || entry.ownerId !== id || hasProjection(plan))) {
        const pair = [plan.id, id].sort(), key = `feature-join:${pair.join(':')}`;
        contacts.set(key, { id: key, derivationKey: key, source: 'auto',
          ruleId: 'feature-contact', generatorVersion: 1,
          sourceEntityIds: [ownerId, entry.ownerId].sort() });
      }
    }
    return { ...plan, neighbors: [...neighbors.values()].sort((a, b) => a.id.localeCompare(b.id)) };
  }
  const resolved = plans.map((plan) => plan.primitive.kind !== 'curved-volume' ? plan : {
    ...resolve(plan, plan.id),
    features: plan.features.map((feature) => !feature.child ? feature : {
      ...feature, child: resolveShapeRoofJunctions([resolve(feature.child, plan.id, true)])[0],
    }),
  });
  return { plans: resolved, contacts: [...contacts.values()].sort((a, b) => a.id.localeCompare(b.id)) };
}
