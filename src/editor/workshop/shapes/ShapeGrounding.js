import { createShapeWallSurface, addWallPatch } from './ShapeWallSurface.js';
import { pointInShape } from './ShapeEnvelope.js';
import { shapeRandom } from './ShapeMesh.js';
import { clipShapeMeshSet } from './ShapeRoofOcclusion.js';
import polygonClipping from 'polygon-clipping';
import { buildShapePaving } from './ShapePaving.js';
import { createShapeTraversalSurface } from './ShapeTraversalSurface.js';

function groundPathStrips(plan) {
  const point = createShapeTraversalSurface(plan), half = plan.primitive.width / 2, strips = [];
  for (let i = 1; i < plan.route.length; i++) {
    const a = plan.route[i-1], b = plan.route[i];
    if (Math.min(a.position[1], b.position[1]) > 0.2) continue;
    const t0 = a.distance / plan.curve.length, t1 = b.distance / plan.curve.length;
    strips.push([point(t0,-half), point(t1,-half), point(t1,half), point(t0,half)].map(([x,,z]) => [x,z]));
  }
  return strips;
}

/** Group already-resolved attachment relationships without a whole-document scan per host. */
export function resolveShapeGroundings(plans) {
  const connections = new Map();
  for (const path of plans) if (path.primitive.kind === 'traversal' && path.resolvedStyle?.hostId) {
    const hostId = path.resolvedStyle.hostId;
    if (!connections.has(hostId)) connections.set(hostId, []);
    connections.get(hostId).push(path);
  }
  return plans.map(plan => {
    const resolved = resolveShapeGrounding(plan), prior = [];
    const porchCuts = (plan.features ?? []).filter(f => f.openSides).map(f => f.child.boundary);
    for (const paving of resolved.ground.paving) {
      const outline = paving.points.map(([x, , z]) => [x, z]);
      const paths = (connections.get(plan.id) ?? []).filter(path => [path.route[0], path.route.at(-1)]
        .some(node => node.position[1] < 0.2 && pointInShape([node.position[0], node.position[2]], outline)));
      const cuts = [...porchCuts, ...paths.flatMap(groundPathStrips), ...prior];
      paving.polygons = cuts.length ? polygonClipping.difference([outline], ...cuts.map(c => [c])) : [[outline]];
      paving.connectedTo = paths.map(path => path.id).sort();
      prior.push(outline);
    }
    return resolved;
  });
}

export function resolveShapeGrounding(plan) {
  const p = plan.primitive, paving = [], masks = [];
  if (p.kind === 'traversal') masks.push({ kind: 'path', points: plan.boundary, width: p.width + 0.3 });
  else {
    masks.push(p.kind === 'curved-volume' ? { kind: 'polygon', points: plan.boundary } :
      { kind: 'path', points: plan.boundary, width: p.thickness + 0.3 });
    const surface = createShapeWallSurface(plan);
    for (const o of plan.openings) {
      if (['window', 'slit'].includes(o.role) || p.elevation + o.bottom > 0.2) continue;
      const u = o.at * surface.length, width = o.width + 0.6;
      const points = [surface.point(u - width / 2, 0, p.thickness / 2 + 0.04),
        surface.point(u + width / 2, 0, p.thickness / 2 + 0.04),
        surface.point(u + width / 2, 0, p.thickness / 2 + 1.8),
        surface.point(u - width / 2, 0, p.thickness / 2 + 1.8)];
      const key = `ground:${p.id}:entrance-${o.id}`;
      if (!p.suppressed.includes(key)) paving.push({ id: key, derivationKey: key, points,
        provenance: { source: 'auto', ruleId: 'entrance-paving', generatorVersion: 1, sourceEntityIds: [p.id], derivationKey: key } });
      masks.push({ kind: 'polygon', points: points.map(([x, , z]) => [x, z]) });
    }
    for (const feature of plan.features ?? []) if (feature.child && feature.intent.kind !== 'dormer')
      masks.push({ kind: 'polygon', points: feature.child.boundary });
    for (const contact of plan.rpg.foundationContacts) if (contact.featureId && contact.footprint?.kind === 'polygon') masks.push(contact.footprint);
  }
  return { ...plan, ground: { paving, masks } };
}

export function shapeGroundExcluded(point, masks) {
  return masks.some((mask) => {
    if (mask.kind === 'polygon') return pointInShape(point, mask.points);
    return mask.points.slice(0, -1).some((a, i) => {
      const b = mask.points[i + 1], dx = b[0] - a[0], dz = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      return Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dz) <= mask.width / 2;
    });
  });
}

export function buildShapeGrounding(plan, meshes, recipe) {
  const p = plan.primitive;
  if (p.kind !== 'traversal' && p.elevation < 0.2) {
    const surface = createShapeWallSurface(plan), count = Math.ceil(surface.length / 0.24);
    for (let i = 0; i < count; i++) {
      const u0 = surface.length * i / count, u1 = surface.length * (i + 1) / count;
      if (surface.excluded((u0 + u1) / 2, 0.04)) continue;
      addWallPatch(meshes.trim, surface, u0, u1, -0.1, 0.09, p.thickness / 2 + 0.075, 0.12, [0.78, 0.79, 0.73], { back: false, start: false, end: false });
      const a = surface.point(u0, 0.11), b = surface.point(u0, 0.11, 0.1);
      const shade = Math.max(0, (b[0] - a[0]) * 0.6 - (b[2] - a[2]) * 0.8) / 0.1;
      if (recipe.detail < 2 || shapeRandom(recipe.seed, p.id, 'foundation-moss', i) > p.age * (0.15 + shade * 0.7)) continue;
      const points = [surface.point(u0, 0.02, p.thickness / 2 + 0.082), surface.point(u1, 0.025, p.thickness / 2 + 0.082),
        surface.point(u1, 0.04 + p.age * 0.06, p.thickness / 2 + 0.086), surface.point(u0, 0.06 + p.age * 0.04, p.thickness / 2 + 0.086)];
      meshes.foliage.quad(...(surface.clockwise ? points.toReversed() : points), [0.14, 0.22, 0.06]);
    }
  }
  const pavingMesh = clipShapeMeshSet(meshes, plan, { roofs: false }).trim;
  for (const paving of plan.ground.paving) buildShapePaving(paving, pavingMesh, recipe, p);
}
