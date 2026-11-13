import { shapeChoice, shapeId, shapeNumber, shapeRecord } from './ShapeValidation.js';

export const SHAPE_OPENING_ROLES = Object.freeze(['door', 'window', 'arch', 'slit']);
export const SHAPE_OPENING_PROFILES = Object.freeze(['arched', 'square', 'pointed']);

/** Height of the arched head above its springing line. */
export function shapeOpeningRise(o) {
  if (o.profile === 'square') return 0;
  if (o.profile === 'pointed') return Math.min(o.width * 0.866, o.height * 0.55);
  return Math.min(o.width / 2, o.height * 0.4);
}

/** Top of the opening at a signed distance from its centre line; masonry, trim and collision share it. */
export function shapeOpeningTop(o, dx) {
  const rise = shapeOpeningRise(o), x = Math.min(1, Math.abs(dx) / (o.width / 2));
  // A pointed head is two arcs struck from the opposite springing points.
  const head = o.profile === 'pointed'
    ? (Math.sqrt(Math.max(0, 1 - ((x + 1) / 2) ** 2)) / 0.866)
    : Math.sqrt(Math.max(0, 1 - x * x));
  return o.bottom + o.height - rise + rise * Math.min(1, head);
}

/** Authored host-local opening intent, shared by closed volumes and freeform walls. */
export function normalizeShapeOpenings(input, height) {
  const openings = input === undefined ? [] : input;
  if (!Array.isArray(openings) || openings.length > 64)
    throw new Error('A shape supports at most 64 openings.');
  const result = openings
    .map((opening) => {
      shapeRecord(opening, 'Opening');
      if (
        opening.promotedFrom !== undefined &&
        (typeof opening.promotedFrom !== 'string' || opening.promotedFrom.length > 160)
      )
        throw new Error('Opening promotion requires a bounded derivation key.');
      return Object.freeze({
        id: shapeId(opening.id, 'Opening id'),
        role: shapeChoice(opening.role, 'opening role', 'window', SHAPE_OPENING_ROLES),
        profile: shapeChoice(opening.profile, 'opening profile', 'arched', SHAPE_OPENING_PROFILES),
        shutterPose: shapeChoice(opening.shutterPose, 'shutter pose', 'auto', ['auto', 'open', 'ajar', 'closed']),
        at: shapeNumber(opening.at, 'Opening position', 0.5, 0, 1),
        bottom: shapeNumber(opening.bottom, 'Opening bottom', 0, 0, height - 0.3),
        width: shapeNumber(opening.width, 'Opening width', 1, 0.1, 5),
        height: shapeNumber(opening.height, 'Opening height', 1.5, 0.3, height),
        ...(opening.promotedFrom !== undefined ? { promotedFrom: opening.promotedFrom } : {}),
      });
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  if (new Set(result.map((o) => o.id)).size !== result.length)
    throw new Error('Duplicate shape opening id.');
  return Object.freeze(result);
}

export function shapeOpeningPortal(plan, opening) {
  return {
    id: `${plan.id}:portal:${opening.id}`,
    primitiveId: plan.id,
    openingId: opening.id,
    at: opening.at,
    bottom: plan.primitive.elevation + opening.bottom,
    width: opening.width,
    height: opening.height,
    role: opening.role,
    ...(opening.derivationKey ? { provenance: opening.provenance } : {}),
  };
}

/** Fit derived cuts to the host while preserving the authored opening intent. */
export function resolveShapeOpenings(primitive, curve) {
  return primitive.openings.map((opening) => {
    const half = Math.min(opening.width, curve.length) / 2;
    const center = opening.at * curve.length;
    const start = curve.closed ? center - half : Math.max(0, center - half);
    const end = curve.closed ? center + half : Math.min(curve.length, center + half);
    return {
      ...opening,
      width: curve.closed || (start === center - half && end === center + half)
        ? Math.min(opening.width, curve.length) : end - start,
      at: curve.closed || (start === center - half && end === center + half)
        ? opening.at : (start + end) / 2 / curve.length,
      height: Math.min(opening.height, primitive.height - opening.bottom),
    };
  });
}
