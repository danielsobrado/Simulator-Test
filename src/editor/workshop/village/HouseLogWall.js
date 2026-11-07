import { beveledBox } from '../ProceduralWorkshopGeometry.js';
import { facadeBeam, facadePoint } from './HouseFacade.js';
import { openingExtent } from './HouseTimberFrame.js';

/**
 * Log-built walls: stacked round logs, broken around the openings, whose ends
 * cross and stand out past every corner — the saddle-notched corners of a log
 * house, where front/back logs and side logs alternate course by course.
 *
 * A thin board backing fills the chinks between the logs. Each log gets its own
 * girth, a little sway in height and its own end length, so no course reads as
 * a ruled line.
 */
export const LOG_DIAMETER = 0.25;
/** Course pitch as a share of the diameter: logs bed into the one below. */
const COURSE = 0.86;
/** Beyond-the-corner length of a log end, past the crossing wall's face. */
const END_REACH = 0.28;

function logSegments(u0, u1, y, extents) {
  const blockers = extents.filter((extent) => y > extent.y0 && y < extent.y1).sort((a, b) => a.u0 - b.u0);
  const segments = [];
  let start = u0;
  for (const { u0: blockStart, u1: blockEnd } of blockers) {
    if (blockStart > start) segments.push([start, blockStart]);
    start = Math.max(start, blockEnd);
  }
  if (u1 > start) segments.push([start, u1]);
  return segments.filter(([a, b]) => b - a > 0.2);
}

/**
 * @param {import('./HouseKit.js').HouseKit} kit
 * @param {object} facade a box facade (HouseFacade)
 * @param {{ thickness: number, openings?: object[], phase?: number }} options
 *   `phase` 0 for front/back walls and 1 for the sides: the two sets take
 *   alternate courses at the corners.
 */
export function layLogWall(kit, facade, { thickness, openings = [], phase = 0 }) {
  const height = facade.y1 - facade.y0;
  const side = facade.side === 'left' || facade.side === 'right';
  const inset = side ? thickness : 0;
  kit.add('wood', beveledBox({
    width: facade.length - inset * 2,
    height,
    depth: thickness * 0.6,
    position: facadePoint(facade, facade.length / 2, facade.y0 + height / 2, -thickness * 0.4),
    rotation: [0, facade.yaw, 0],
    detail: 1,
    bevelRatio: 0.02,
  }));
  const extents = openings.map((opening) => openingExtent(facade, opening, 0.07));
  const pitch = LOG_DIAMETER * COURSE;
  const courses = Math.max(2, Math.round(height / pitch));
  const step = height / courses;
  for (let course = 0; course < courses; course += 1) {
    const crossing = (course + phase) % 2 === 0;
    const y = facade.y0 + step * (course + 0.5);
    const start = crossing ? -thickness - END_REACH * (0.8 + kit.random() * 0.4) : inset;
    const end = facade.length + (crossing ? thickness + END_REACH * (0.8 + kit.random() * 0.4) : -inset);
    for (const [a, b] of logSegments(start, end, y, extents)) {
      const girth = step / COURSE * (0.9 + kit.random() * 0.2);
      const sway = (kit.random() - 0.5) * 0.03;
      kit.add('wood', facadeBeam(
        facade,
        [a, y + sway, girth / 2 - thickness * 0.15],
        [b, y - sway, girth / 2 - thickness * 0.15],
        girth,
        { proud: girth, bevelRatio: 0.42 },
      ));
    }
  }
}
