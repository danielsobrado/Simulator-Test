import { WorkshopSpatialIndex } from '../spatial/WorkshopSpatialIndex.js';
import polygonClipping from 'polygon-clipping';
import { WORKSHOP_GEOMETRY_TOLERANCE as tolerance } from '../curves/GeometryTolerancePolicy.js';
import { shapeEnvelopeAtHeight, pointInShape, offsetShapePolygon } from './ShapeEnvelope.js';
import { resolvePathGates } from './ShapePathGateReaction.js';
import { resolveShapeCraftDetails } from './ShapeCraftDetails.js';
import { resolveShapeRoofJunctions } from './ShapeRoofJunctions.js';
import { resolveShapeStyles } from './ShapeStyles.js';
import { resolveShapeFeatures } from './ShapeFeatures.js';
import { resolveShapeGroundings } from './ShapeGrounding.js';
import { resolveShapeFeatureContacts } from './ShapeFeatureContacts.js';
import { resolveShapeInterior } from './ShapeInterior.js';

export function resolveShapeChemistry(plans) {
  const contacts = [],
    supports = [];
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  const index = new WorkshopSpatialIndex({
    listEntities: () =>
      plans.map((plan) => ({
        id: plan.id,
        properties: { spatialBounds: plan.bounds },
      })),
    getEntity: (id) => byId.get(id),
  });
  const resolved = plans.map((plan) => ({ ...plan, neighbors: [] }));
  for (const plan of resolved) {
    if (plan.primitive.kind === 'curved-volume') {
      for (const id of index.queryBounds(plan.bounds, {
        excludeIds: [plan.id],
      })) {
        const other = byId.get(id);
        if (other.primitive.kind !== 'curved-volume') continue;
        const a = plan.primitive,
          b = other.primitive;
        if (a.elevation + a.height <= b.elevation || b.elevation + b.height <= a.elevation)
          continue;
        const bottom = Math.max(a.elevation, b.elevation),
          top = Math.min(a.elevation + a.height, b.elevation + b.height);
        if (
          ![bottom, (bottom + top) / 2, top].some(
            (y) =>
              polygonClipping.intersection(
                [shapeEnvelopeAtHeight(plan, y)],
                [shapeEnvelopeAtHeight(other, y)],
              ).length,
          )
        )
          continue;
        plan.neighbors.push({
          id: other.id,
          boundary: other.boundary,
          topBoundary: other.topBoundary,
          curve: other.curve,
          primitive: other.primitive,
        });
        if (plan.id < other.id)
          contacts.push({
            id: `join:${plan.id}:${other.id}`,
            source: 'auto',
            ruleId: 'volume-contact',
            generatorVersion: 1,
            sourceEntityIds: [plan.id, other.id],
            derivationKey: `join:${plan.id}:${other.id}`,
          });
      }
      if (plan.primitive.elevation > tolerance.position) {
        const boundary = plan.boundary;
        const stride = Math.max(1, Math.floor(boundary.length / 4));
        for (let i = 0; i < 4; i++) {
          const key = `support:${plan.id}:corner-${i}`;
          if (plan.primitive.suppressed.includes(key)) continue;
          const [x, z] = boundary[Math.min(i * stride, boundary.length - 1)];
          supports.push({
            id: key,
            derivationKey: key,
            source: 'auto',
            ruleId: 'raised-volume-support',
            generatorVersion: 1,
            sourceEntityIds: [plan.id],
            family: 'piers',
            position: [x, plan.primitive.elevation, z],
            height: plan.primitive.elevation,
          });
        }
      }
    }
    if (plan.primitive.kind === 'curved-wall') {
      for (const id of index.queryBounds(plan.bounds, { excludeIds: [plan.id] })) {
        const other = byId.get(id), a = plan.primitive, b = other.primitive;
        if (b.kind !== 'curved-volume' || a.elevation + a.height <= b.elevation || b.elevation + b.height <= a.elevation) continue;
        const shell = shapeEnvelopeAtHeight(other, Math.max(a.elevation, b.elevation) + 0.5);
        const reach = a.thickness / 2 + b.thickness / 2;
        if (!plan.boundary.some((point) => pointInShape(point, offsetShapePolygon(shell, reach)))) continue;
        plan.neighbors.push({ id: other.id, boundary: other.boundary, topBoundary: other.topBoundary, curve: other.curve, primitive: other.primitive });
        const key = `join:${plan.id}:${other.id}`;
        contacts.push({ id: key, source: 'auto', ruleId: 'wall-tower-join', generatorVersion: 1,
          sourceEntityIds: [plan.id, other.id], derivationKey: key });
      }
    }
    supports.push(...(plan.supports ?? []));
  }
  for (const plan of resolved)
    plan.supports = supports.filter((s) => s.sourceEntityIds.includes(plan.id));
  const features = resolveShapeFeatureContacts(resolvePathGates(resolved, index, byId)
    .map(resolveShapeCraftDetails).map(resolveShapeFeatures));
  return { plans: resolveShapeGroundings(resolveShapeStyles(resolveShapeRoofJunctions(features.plans))).map(resolveShapeInterior),
    contacts: [...contacts, ...features.contacts], supports };
}
