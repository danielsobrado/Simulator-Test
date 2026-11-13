import { intersectCurvePaths } from '../curves/CurveIntersections.js';
import { projectPointToCurvePath } from '../curves/CurveProjection.js';
import { WORKSHOP_GEOMETRY_TOLERANCE as tolerance } from '../curves/GeometryTolerancePolicy.js';
import { placeShapePoint } from './ShapePaths.js';
import { shapeOpeningPortal } from './ShapeOpenings.js';
import { shapeTraversalHeight } from './ShapeTraversalSurface.js';

export const PATH_GATE_RULE = Object.freeze({
  id: 'path-wall-gate',
  version: 1,
  priority: 30,
  inputs: ['traversal', 'curved-wall'],
  scope: 'host-bounds',
  outputs: ['openings', 'portals', 'collision-gaps'],
  dirtyDomains: ['walls', 'ivy'],
  maxPasses: 1,
  maxOpeningsPerHost: 64,
  keyStrategy: 'host/path/crossing',
  suppression: 'derivation-key',
});

function worldPath(plan) {
  const path = plan.curve.path;
  const transform = (point) => placeShapePoint(plan.primitive, point);
  return {
    ...path,
    points: path.points.map((p) => ({ ...p, position: transform(p.position) })),
    segments: path.segments.map((s) => ({
      ...s,
      ...(s.control ? { control: transform(s.control) } : {}),
      ...(s.center ? { center: transform(s.center) } : {}),
    })),
  };
}

function routeHeight(plan, distance) {
  return shapeTraversalHeight(plan.primitive, plan.mode, plan.steps, distance / plan.curve.length);
}

function proposeGates(wall, path, wallPath, pathCurve) {
  const p = wall.primitive,
    proposals = [];
  const crossings = intersectCurvePaths(wallPath, pathCurve);
  for (let i = 0; i < crossings.length; i++) {
    const a = projectPointToCurvePath(wallPath, crossings[i].point),
      b = projectPointToCurvePath(pathCurve, crossings[i].point);
    const angle = Math.abs(a.tangent[0] * b.tangent[1] - a.tangent[1] * b.tangent[0]);
    if (angle < Math.max(0.3, tolerance.angle)) continue; // Parallel/tangent contact does not imply a doorway.
    const width = path.primitive.width / angle + 0.22;
    const distance = a.pathDistance,
      half = width / 2;
    if (
      width > 5 ||
      (!wall.curve.closed && (distance - half < 0.2 || distance + half > wall.curve.length - 0.2))
    )
      continue;
    const deck = routeHeight(path, b.pathDistance);
    if (deck < p.elevation - 0.2 || deck > p.elevation + p.height - 0.6) continue;
    const bottom = Math.max(0, deck - p.elevation - 0.15);
    const available = p.height - bottom;
    const arched = available >= 2.6;
    const key = `gate:${wall.id}:${path.id}:${i}`;
    proposals.push({
      id: `auto-gate-${path.id}-${i}`,
      role: 'arch',
      profile: arched ? 'arched' : 'square',
      at: distance / wall.curve.length,
      bottom,
      width,
      height: arched ? Math.min(2.8, available - 0.22) : available,
      derivationKey: key,
      provenance: {
        source: 'auto',
        ruleId: PATH_GATE_RULE.id,
        generatorVersion: PATH_GATE_RULE.version,
        sourceEntityIds: [wall.id, path.id],
        derivationKey: key,
      },
    });
  }
  return proposals;
}

function overlaps(a, b, length, closed) {
  let distance = Math.abs(a.at - b.at) * length;
  if (closed) distance = Math.min(distance, length - distance);
  return distance < (a.width + b.width) / 2 + 0.15;
}

/** Detect once, prefer explicit openings, resolve conflicts, then publish shared masks/gameplay. */
export function resolvePathGates(plans, index, byId) {
  const paths = new Map();
  const curve = (plan) => {
    if (!paths.has(plan.id)) paths.set(plan.id, worldPath(plan));
    return paths.get(plan.id);
  };
  return plans.map((plan) => {
    if (plan.primitive.kind !== 'curved-wall') return plan;
    const p = plan.primitive,
      automaticOpenings = [];
    if (p.automaticGates) {
      const candidates = index.queryBounds(plan.bounds, { excludeIds: [plan.id] }).sort();
      for (const id of candidates) {
        const path = byId.get(id);
        if (path?.primitive.kind !== 'traversal') continue;
        for (const opening of proposeGates(plan, path, curve(plan), curve(path))) {
          if (plan.openings.length + automaticOpenings.length >= PATH_GATE_RULE.maxOpeningsPerHost)
            break;
          if (p.suppressed.includes(opening.derivationKey)) continue;
          if (
            [...plan.openings, ...automaticOpenings].some((o) =>
              overlaps(o, opening, plan.curve.length, plan.curve.closed),
            )
          )
            continue;
          automaticOpenings.push(opening);
        }
      }
    }
    const openings = [...plan.openings, ...automaticOpenings];
    return {
      ...plan,
      openings,
      automaticOpenings,
      rpg: {
        ...plan.rpg,
        collisionSlabs: plan.rpg.collisionSlabs.map((s) => ({
          ...s,
          gaps: openings,
        })),
        portals: openings
          .filter((o) => !['window', 'slit'].includes(o.role))
          .map((o) => shapeOpeningPortal(plan, o)),
      },
    };
  });
}
