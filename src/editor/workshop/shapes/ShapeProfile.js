import { shapeChoice, shapeNumber, shapeRecord } from './ShapeValidation.js';

/** Masonry course height; profile steps land on course joints so no stone straddles a step. */
export const SHAPE_COURSE_HEIGHT = 0.34;
export const SHAPE_STONEWORK = Object.freeze(['fieldstone', 'ashlar']);
export const SHAPE_BASE_STYLES = Object.freeze(['none', 'batter', 'plinth']);
const snap = (y) => Math.round(y / SHAPE_COURSE_HEIGHT) * SHAPE_COURSE_HEIGHT;

/** Authored vertical profile: a flared or stepped footing plus setbacks/jetties up the shaft. */
export function normalizeShapeProfile(source, height = 4) {
  const base = shapeRecord(source.base, 'Wall base');
  const stages = source.stages ?? [];
  if (!Array.isArray(stages) || stages.length > 4) throw new Error('A wall supports at most 4 profile stages.');
  return {
    stonework: shapeChoice(source.stonework, 'stonework', 'fieldstone', SHAPE_STONEWORK),
    base: Object.freeze({
      style: shapeChoice(base.style, 'wall base', 'none', SHAPE_BASE_STYLES),
      height: shapeNumber(base.height, 'Base height', 1.4, 0.2, 24),
      out: shapeNumber(base.out, 'Base projection', 0.35, 0, 2),
    }),
    stages: Object.freeze(stages.map((input) => {
      const stage = shapeRecord(input, 'Profile stage');
      return Object.freeze({
        at: shapeNumber(stage.at, 'Stage height', height / 2, 0.3, 24),
        out: shapeNumber(stage.out, 'Stage projection', -0.15, -1, 1),
      });
    }).sort((a, b) => a.at - b.at)),
  };
}

/** Outward shift of the wall faces, in metres, at a height above the shape's own base. */
export function shapeProfileOut(p, y) {
  let out = 0;
  const base = p.base;
  if (base && base.style !== 'none') {
    const top = snap(base.height) || SHAPE_COURSE_HEIGHT;
    if (y < top) out += base.style === 'plinth' ? base.out : base.out * (1 - Math.max(0, y) / top);
  }
  for (const stage of p.stages ?? []) if (y >= snap(stage.at)) out += stage.out;
  return out;
}

/** Top of the flared or stepped footing, or 0 where the wall has none. */
export function shapeBaseTop(p) {
  return p.base && p.base.style !== 'none' ? Math.min(p.height, snap(p.base.height) || SHAPE_COURSE_HEIGHT) : 0;
}

/** Heights where the profile kinks or steps; wall patches must not span them. */
export function shapeProfileBreaks(p) {
  const breaks = [];
  if (p.base && p.base.style !== 'none') breaks.push(snap(p.base.height) || SHAPE_COURSE_HEIGHT);
  for (const stage of p.stages ?? []) breaks.push(snap(stage.at));
  return [...new Set(breaks)].filter((y) => y > 0 && y < p.height).sort((a, b) => a - b);
}

export function shapeProfileReach(p) {
  const heights = [0, ...shapeProfileBreaks(p).flatMap((y) => [y - 1e-4, y]), p.height];
  return Math.max(0, ...heights.map((y) => shapeProfileOut(p, y)));
}
