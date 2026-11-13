import { shapeChoice, shapeNumber, shapeRecord } from './ShapeValidation.js';
import { shapeRandom } from './ShapeMesh.js';
import { createShapeWallSurface } from './ShapeWallSurface.js';
import { SHAPE_CASTLE_CONFIG } from './config/ShapeCastleConfig.generated.js';

const D = SHAPE_CASTLE_CONFIG.crown;
export const SHAPE_CROWN_STYLES = Object.freeze(['none', 'parapet', 'corbelled']);
export const SHAPE_CROWN_ARCADES = Object.freeze(['round', 'pointed', 'none']);
export const SHAPE_CROWN_MACHICOLATIONS = Object.freeze(['decorative', 'open', 'none']);
export const SHAPE_CROWN_MERLONS = Object.freeze(['square', 'pierced', 'stepped', 'none']);

/** Authored crown intent, shared by closed towers and freestanding walls. */
export function normalizeShapeCrown(value) {
  const c = shapeRecord(value, 'Crown');
  return Object.freeze({
    style: shapeChoice(c.style, 'crown style', 'none', SHAPE_CROWN_STYLES),
    projection: shapeNumber(c.projection, 'Crown projection', D.projection, 0.1, 1.5),
    height: shapeNumber(c.height, 'Parapet height', D.height, 0.2, 3),
    corbelSpacing: shapeNumber(c.corbelSpacing, 'Corbel spacing', D.corbelSpacing, 0.35, 3),
    corbelDrop: shapeNumber(c.corbelDrop, 'Corbel height', D.corbelDrop, 0.3, 2.5),
    arcade: shapeChoice(c.arcade, 'corbel arcade', 'round', SHAPE_CROWN_ARCADES),
    machicolation: shapeChoice(c.machicolation, 'machicolation', 'decorative', SHAPE_CROWN_MACHICOLATIONS),
    merlons: shapeChoice(c.merlons, 'merlon pattern', 'square', SHAPE_CROWN_MERLONS),
    merlonWidth: shapeNumber(c.merlonWidth, 'Merlon width', D.merlonWidth, 0.3, 3),
    merlonGap: shapeNumber(c.merlonGap, 'Embrasure width', D.merlonGap, 0.2, 3),
    merlonHeight: shapeNumber(c.merlonHeight, 'Merlon height', D.merlonHeight, 0.3, 2.5),
    ruin: shapeNumber(c.ruin, 'Crown ruin', 0, 0, 1),
    sides: shapeChoice(c.sides, 'crown sides', 'outer', ['outer', 'both']),
  });
}

export const SHAPE_CROWN_NONE = normalizeShapeCrown({});

/**
 * Vertical frame of the crown in host-local metres. Under a pitched roof the crown wall is a
 * roofed gallery ending at the eave; under a flat top it is a parapet standing on the deck.
 */
export function shapeCrownFrame(p) {
  const c = p.crown;
  if (!c || c.style === 'none') return null;
  const roofed = Boolean(p.roof) && p.roof.family !== 'flat';
  if (roofed && c.style !== 'corbelled') return null;
  const projection = c.style === 'corbelled' ? c.projection : 0;
  const base = roofed ? p.height - c.height : p.height;
  const thickness = projection ? D.parapetThickness : Math.min(0.4, p.thickness * (p.kind === 'curved-wall' ? 0.45 : 1));
  return { roofed, projection, base, wallTop: base + c.height, thickness, face: p.thickness / 2,
    outer: p.thickness / 2 + projection, drop: projection ? Math.min(c.corbelDrop, Math.max(0.3, base - 0.3)) : 0 };
}

/** How far the roof (or the flat deck) reaches beyond the wall centre line. */
export function shapeRoofReach(p) {
  const frame = shapeCrownFrame(p);
  if (!frame) return p.thickness / 2 + p.roof.overhang;
  if (frame.roofed) return frame.outer + p.roof.overhang;
  return p.crown.machicolation === 'open' ? frame.face : frame.outer;
}

function outline(surface, y, offset, count = 96) {
  return Array.from({ length: count + (surface.closed ? 0 : 1) }, (_, i) => {
    const point = surface.point((surface.length * i) / count, y, offset);
    return [point[0], point[2]];
  });
}

/** Deterministic corbel, bay and merlon layout plus the gameplay products the crown adds. */
export function resolveShapeCrown(plan) {
  const p = plan.primitive, frame = shapeCrownFrame(p);
  if (!frame) return plan;
  const c = p.crown, surface = createShapeWallSurface(plan), length = surface.length, closed = surface.closed;
  const ring = outline(surface, frame.base - 0.01, frame.outer);
  let outerLength = 0;
  for (let i = 0; i < ring.length - (closed ? 0 : 1); i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    outerLength += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const scale = outerLength / length;
  const corbels = [], bays = [], merlons = [];
  if (frame.projection) {
    const count = Math.max(closed ? 4 : 1, Math.round(outerLength / c.corbelSpacing));
    const du = Math.min(D.corbelWidth / scale, (length / count) * 0.5);
    for (let i = 0; i < count + (closed ? 0 : 1); i++) {
      const u = closed ? (length * i) / count : du / 2 + ((length - du) * i) / count;
      corbels.push({ key: `corbel-${i}`, u, du });
    }
    for (let i = 0; i < count; i++) {
      const a = corbels[i].u + du / 2, next = corbels[(i + 1) % corbels.length].u;
      bays.push({ key: `bay-${i}`, u0: a, u1: (next <= corbels[i].u ? next + length : next) - du / 2 });
    }
  }
  if (!frame.roofed && c.merlons !== 'none') {
    const cell = c.merlonWidth + c.merlonGap;
    const count = Math.max(closed ? 4 : 1, Math.round((outerLength + (closed ? 0 : c.merlonGap)) / cell));
    const unit = length / (closed ? count * cell : count * c.merlonWidth + (count - 1) * c.merlonGap);
    for (let i = 0; i < count; i++) {
      const u0 = (closed ? c.merlonGap / 2 : 0) * unit + i * cell * unit;
      const fate = shapeRandom(0, p.id, 'crown-ruin', i);
      if (fate < c.ruin * 0.3) continue;
      const height = fate < c.ruin * 0.75
        ? c.merlonHeight * (0.3 + 0.5 * shapeRandom(0, p.id, 'crown-ruin-height', i)) : c.merlonHeight;
      merlons.push({ key: `merlon-${i}`, u0, u1: u0 + c.merlonWidth * unit, height, ruined: height < c.merlonHeight });
    }
  }
  const elevation = p.elevation + frame.base;
  const footprint = { kind: 'polygon', points: outline(surface, frame.base + 0.01, frame.outer - frame.thickness / 2, 48) };
  const rpg = {
    ...plan.rpg,
    collisionSlabs: [...plan.rpg.collisionSlabs, {
      id: `${p.id}:crown`, primitiveId: p.id, elevation, height: c.height + (merlons.length ? c.merlonHeight : 0),
      thickness: frame.thickness, footprint, gaps: [], ...(closed ? {} : { open: true }),
    }],
    coverSurfaces: [...plan.rpg.coverSurfaces, { id: `${p.id}:crown:cover`, primitiveId: p.id,
      height: elevation + c.height, footprint }],
    // The deck stops at the shaft where the machicolations are real holes in the gallery floor.
    walkableFloors: frame.roofed || p.kind !== 'curved-volume' ? plan.rpg.walkableFloors : [...plan.rpg.walkableFloors, {
      id: `${p.id}:crown-deck`, primitiveId: p.id, elevation: p.elevation + p.height + 0.08, surfaceOwner: 'crown',
      footprint: { kind: 'polygon', points: outline(surface, p.height - 0.01, shapeRoofReach(p) - (c.machicolation === 'open' ? 0 : frame.thickness), 48) },
    }],
  };
  const pad = frame.projection + 0.1;
  return { ...plan, rpg,
    bounds: { min: plan.bounds.min.map((v) => v - pad), max: plan.bounds.max.map((v) => v + pad) },
    crown: { ...frame, scale, corbels, bays, merlons,
      drops: c.machicolation === 'open' ? bays.map((bay) => ({ id: `${p.id}:drop:${bay.key}`, u0: bay.u0, u1: bay.u1 })) : [] } };
}
