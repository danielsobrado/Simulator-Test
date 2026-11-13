import { createShapeWallSurface } from './ShapeWallSurface.js';
import { createShapeRoofSurface } from './ShapeRoofSurface.js';
import { planShapeVolume } from './ShapeVolume.js';
import { shapeRandom } from './ShapeMesh.js';
import { resolveShapeCraftDetails } from './ShapeCraftDetails.js';
import { resolveShapeRoofJunctions } from './ShapeRoofJunctions.js';
import { expandShapeFeatureFootprint } from './ShapeFeatureFootprint.js';
import { shapeFeatureSemantics } from './ShapeFeatureSemantics.js';
import { resolveShapeBalcony } from './ShapeBalcony.js';
import { resolveShapeButtress } from './ShapeButtress.js';
import { shapeFeatureBounds } from './ShapeFeatureBounds.js';
import { SHAPE_CROWN_NONE, normalizeShapeCrown } from './ShapeCrown.js';
import { SHAPE_CASTLE_CONFIG } from './config/ShapeCastleConfig.generated.js';

const TURRET = SHAPE_CASTLE_CONFIG.turret;
const NO_BASE = Object.freeze({ style: 'none', height: 1, out: 0 });

const distanceAt = (a, b) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

function childVolume(host, f, frame, fields) {
  const p = host.primitive;
  const id = `${p.id.slice(0, 24)}-f-${Math.floor(shapeRandom(0, p.id, 'feature-id', f.id) * 4294967295).toString(36)}`;
  const primitive = { ...p, id, label: `${p.label} · ${f.kind}`, position: [frame.origin[0], frame.origin[2]],
    rotation: frame.rotation, height: f.height, elevation: frame.origin[1], taper: 1, levels: 1, thickness: 0.16,
    footprint: { family: 'rounded', width: f.width, depth: f.depth, cornerRadius: Math.min(0.18, f.depth * 0.2, f.width * 0.2) },
    roof: { ...p.roof, family: 'gable', axis: 'depth', rise: Math.min(0.85, f.width * 0.32), sweep: 0.25, sag: 0.03, overhang: 0.16 },
    openings: [], features: [], base: NO_BASE, stages: [], crown: SHAPE_CROWN_NONE, craft: false, chimney: false, windowBoxes: false, interior: 'none', ivyDensity: 0, suppressed: [],
    // A volume carried by its host (jetty, dormer, oriel) has no footing course of its own.
    grounded: frame.origin[1] <= p.elevation + 0.05, ...fields };
  const plan = planShapeVolume(primitive);
  if (primitive.openings.some((o) => ['dormer-window', 'bay-window-0'].includes(o.id))) {
    const at = (primitive.footprint.width / 2 - primitive.footprint.cornerRadius) / plan.curve.length;
    return planShapeVolume({ ...primitive, openings: primitive.openings.map((o) =>
      ['dormer-window', 'bay-window-0'].includes(o.id) ? { ...o, at } : o) });
  }
  return plan;
}

function frameAt(plan, feature) {
  const wall = createShapeWallSurface(plan), u = feature.at * wall.length;
  const y = Math.min(feature.bottom, plan.primitive.height - 0.1);
  const origin = wall.point(u, y, plan.primitive.thickness / 2);
  const a = wall.point(u - 0.025, y), b = wall.point(u + 0.025, y);
  const length = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
  const tangent = [(b[0] - a[0]) / length, 0, (b[2] - a[2]) / length];
  const sign = wall.clockwise ? -1 : 1, outward = [tangent[2] * sign, 0, -tangent[0] * sign];
  const rotation = Math.atan2(-outward[0], -outward[2]) * 180 / Math.PI;
  return { origin, tangent, outward, rotation, u };
}

function supportAnchor(plan, feature) {
  if (feature.kind !== 'buttress') return feature;
  const length = plan.curve.length, clearance = Math.min(feature.width, 0.7) / 2 + 0.12;
  const gaps = plan.openings.filter((o) => o.bottom < Math.min(feature.height, plan.primitive.height * 0.86));
  const distance = (a, b) => distanceAt(a, b) * length;
  const valid = (at) => gaps.every((o) => distance(at, o.at) >= o.width / 2 + clearance - 1e-6);
  if (valid(feature.at)) return feature;
  const candidates = gaps.flatMap((o) => [-1, 1].map((sign) =>
    ((o.at + sign * (o.width / 2 + clearance) / length) % 1 + 1) % 1)).filter(valid)
    .sort((a, b) => distance(a, feature.at) - distance(b, feature.at) || a - b);
  return { ...feature, at: candidates[0] ?? feature.at };
}

const offset = (frame, distance, y = frame.origin[1]) =>
  [frame.origin[0] + frame.outward[0] * distance, y, frame.origin[2] + frame.outward[2] * distance];

const registry = new Map([
  ['balcony', (host, f) => ({ balcony: resolveShapeBalcony(host, f) })],
  ['bay', (host, f, frame) => {
    // A bay that starts at the ground stands on its own base with raised sills; a higher one is an oriel.
    const sill = f.bottom < 0.05 ? 0.85 : 0.2;
    const height = Math.min(f.height, Math.max(0.5, host.primitive.height - f.bottom - 0.15));
    return { child: childVolume(host, f, { ...frame, origin: offset(frame, f.depth * 0.35) }, {
    height,
    roof: { ...host.primitive.roof, family: 'hip', rise: 0.5, overhang: 0.18, sweep: 0.3, sag: 0 },
    // A bay is glazed between narrow mullion piers; there is no wall for a leaf to open against.
    shutters: false,
    openings: [0.07, 0.3, 0.94].map((at, i) => ({ id: `bay-window-${i}`, role: 'window', profile: 'square', at,
      width: Math.min(0.9, f.width * 0.3, f.depth * 0.65), bottom: sill, height: Math.max(0.3, Math.min(height - sill - 0.25, 1.3)) })),
  }) };
  }],
  ['dormer', (host, f, frame) => {
    const p = host.primitive, roof = createShapeRoofSurface(host);
    const center = offset(frame, -Math.min(f.depth * 0.4, Math.min(p.footprint.width, p.footprint.depth) * 0.22));
    const front = [center[0] + frame.outward[0] * f.depth * 0.5, center[2] + frame.outward[2] * f.depth * 0.5];
    const elevation = Math.max(p.elevation + p.height + 0.02, roof.heightAt(...front) - 0.1);
    const height = Math.min(f.height, Math.max(0.65, p.elevation + p.height + p.roof.rise - elevation - 0.25));
    // The window fills the dormer face up to a lintel band, so no blank cheek rises above it.
    return { cutsRoof: true, child: childVolume(host, f, { ...frame, origin: [center[0], elevation, center[2]] }, {
      height,
      openings: [{ id: 'dormer-window', role: 'window', profile: 'arched', at: 0.06, width: f.width * 0.5,
        bottom: 0.16, height: Math.max(0.3, Math.min(1.35, height - 0.4)) }],
    }) };
  }],
  ['jetty', (host, f, frame) => {
    const p = host.primitive, elevation = p.elevation + p.height * (1 - 1 / Math.max(2, p.levels));
    return { replacesRoof: true, child: childVolume(host, f, { ...frame, origin: [p.position[0], elevation, p.position[1]], rotation: p.rotation }, {
      height: p.elevation + p.height - elevation, footprint: expandShapeFeatureFootprint(p.footprint, f.depth),
      roof: p.roof, facade: 'timber',
      openings: host.openings.filter((o) => o.bottom + p.elevation >= elevation).map((o) => ({ ...o, bottom: o.bottom + p.elevation - elevation })),
    }) };
  }],
  ['porch', (host, f, frame) => {
    const p = host.primitive, door = host.openings.filter((o) => o.role === 'door')
      .sort((a, b) => distanceAt(a.at, f.at) - distanceAt(b.at, f.at) || a.id.localeCompare(b.id))[0];
    const anchored = frameAt(host, { ...f, at: door?.at ?? f.at, bottom: 0 });
    return { frame: anchored, child: childVolume(host, f, { ...anchored, origin: offset(anchored, f.depth * 0.45, p.elevation) }, {
      height: Math.min(p.height - 0.15, Math.max(2.2, f.height)), footprint: { family: 'rounded', width: Math.max(f.width, (door?.width ?? 1) + 0.7), depth: f.depth, cornerRadius: 0.08 },
    }), openSides: true };
  }],
  ['buttress', resolveShapeButtress],
  ['turret', (host, f, frame) => {
    // A turret straddles the host face; on a corbelled crown it rides the crown's outer face.
    const p = host.primitive, crown = host.crown, flat = f.roof === 'flat';
    const onCrown = crown && f.bottom >= crown.base - crown.drop - 0.01;
    const clear = f.width * (TURRET.projection - 0.5) + (onCrown ? crown.projection : 0);
    return { turret: { drop: Math.min(f.bottom, f.width * TURRET.corbelDrop) },
      child: childVolume(host, f, { ...frame, origin: offset(frame, clear, p.elevation + f.bottom) }, {
        footprint: { family: 'oval', width: f.width, depth: f.width }, height: f.height,
        thickness: Math.min(TURRET.thickness, f.width / 5.01), surface: 'masonry', facade: 'plain', shutters: false,
        roof: { family: f.roof, axis: 'width', overhang: TURRET.roofOverhang, sweep: 0.5, sag: 0,
          rise: flat ? 0.2 : Math.min(12, f.width * TURRET.roofRise * (f.roof === 'spire' ? 1.5 : 1)) },
        crown: flat ? normalizeShapeCrown({ style: 'parapet', height: 0.5, merlonWidth: 0.5, merlonGap: 0.34, merlonHeight: 0.5 }) : SHAPE_CROWN_NONE,
        // The oval footprint starts on the local +x side; its outward face is three quarters round.
        openings: [{ id: 'turret-loop', role: 'slit', profile: 'square', at: 0.75, width: 0.12,
          bottom: f.height * 0.38, height: Math.min(1.1, f.height * 0.36) }],
      }) };
  }],
]);

/** Features are semantic modifiers expanded through shared volume/roof builders. */
export function resolveShapeFeatures(plan) {
  if (plan.primitive.kind !== 'curved-volume') return { ...plan, features: [] };
  const features = plan.primitive.features.flatMap((f) => {
    const key = `feature:${plan.id}:${f.id}`;
    if (plan.primitive.suppressed.includes(key)) return [];
    const anchor = supportAnchor(plan, f), frame = frameAt(plan, anchor), feature = registry.get(f.kind)(plan, f, frame);
    const child = feature.child ? resolveShapeCraftDetails({ ...feature.child, neighbors: [{ ...plan, roofReplaced: Boolean(feature.replacesRoof || feature.turret) }, ...(plan.neighbors ?? [])] }) : null;
    return [{ ...feature, child, frame: feature.frame ?? frame, intent: f, id: key, derivationKey: key,
      provenance: { source: 'authored', ruleId: 'architectural-feature', generatorVersion: 1, sourceEntityIds: [plan.id], derivationKey: key } }];
  });
  for (const feature of features) if (feature.child) {
    const siblings = features.filter((other) => other.child && other !== feature &&
      other.child.bounds.min.every((v, k) => v <= feature.child.bounds.max[k]) &&
      other.child.bounds.max.every((v, k) => v >= feature.child.bounds.min[k])).map((other) => ({
        id: other.child.id, primitive: other.child.primitive, curve: other.child.curve,
        boundary: other.child.boundary, topBoundary: other.child.topBoundary,
      }));
    feature.child = resolveShapeRoofJunctions([{ ...feature.child, neighbors: [...feature.child.neighbors, ...siblings] }])[0];
  }
  const replacement = features.find((f) => f.replacesRoof);
  const decorations = !replacement ? plan.decorations : plan.decorations.map((d) => {
    if (d.role !== 'chimney') return d;
    const roof = createShapeRoofSurface(replacement.child), [x, , z] = d.position, base = roof.heightAt(x, z) - 0.14;
    return { ...d, position: [x, base, z], top: base + d.top - d.position[1] };
  });
  if (replacement) replacement.child = { ...replacement.child, decorations: decorations.filter((d) => d.role === 'chimney') };
  return { ...plan, features, decorations, roofReplaced: features.some((f) => f.replacesRoof),
    bounds: shapeFeatureBounds(plan, features),
    neighbors: [...(plan.neighbors ?? []), ...features.filter((f) => f.cutsRoof).map((f) => f.child)],
    rpg: shapeFeatureSemantics(plan, features),
  };
}
