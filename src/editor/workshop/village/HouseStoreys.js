import { beveledBox, quarterTurnUv } from '../ProceduralWorkshopGeometry.js';
import { buildWallCourses } from '../ProceduralWorkshopMasonry.js';
import { boxFacades, facadeBeam, facadePoint } from './HouseFacade.js';
import { buildOpenings } from './HouseOpenings.js';
import { timberFrame } from './HouseTimberFrame.js';
import { layLogWall } from './HouseLogWall.js';

/** Masonry is laid this far below the ground line so a gentle slope never shows a gap. */
export const GROUND_SINK = 0.3;

/**
 * How far below the eaves a roofed storey's framing stops. The roof deck is
 * 0.12 m thick and falls away past the wall line, so a head plate flush with
 * the wall top would break through the tiles just outside the facade.
 */
export const ROOF_SEAT = 0.2;

export const SIDES = Object.freeze(['front', 'back', 'right', 'left']);

const SIDE_LABELS = Object.freeze({ front: 'front', back: 'back', right: 'right', left: 'left' });
const DEFAULT_THICKNESS = Object.freeze({ stone: 0.42, plaster: 0.22, boards: 0.16, logs: 0.2 });

function sidesOf(storey) {
  return SIDES.filter((side) => !(storey.skip ?? []).includes(side));
}

function thicknessOf(storey) {
  return storey.thickness ?? DEFAULT_THICKNESS[storey.wall];
}

/**
 * The editable host id of one side of a storey. The first built side (the
 * front, normally) carries the storey's own id, so a storey that existed before
 * every side became editable keeps its saved opening edits.
 */
export function storeyHostId(storey, side) {
  return side === sidesOf(storey)[0] ? storey.id : `${storey.id}-${side}`;
}

/**
 * One planar host per built side. The root side is the storey component; the
 * others nest under it, so moving the storey moves all its walls, and each wall
 * turns its component frame to face outward (see `tagStructureGeometry`).
 */
export function storeyHosts(storey) {
  const facades = boxFacades({ ...storey.box, thickness: thicknessOf(storey) });
  const sides = sidesOf(storey);
  return Object.fromEntries(sides.map((side, index) => {
    const facade = facades[side];
    const root = index === 0;
    return [side, Object.freeze({
      id: storeyHostId(storey, side),
      label: root ? storey.label : `${storey.label} · ${SIDE_LABELS[side]} wall`,
      type: 'planar',
      width: facade.length,
      height: storey.box.y1 - storey.box.y0,
      origin: Object.freeze(facadePoint(facade, facade.length / 2, storey.box.y0, 0)),
      yaw: facade.yaw,
      parentId: root ? (storey.parentId ?? null) : storey.id,
    })];
  }));
}

/** The storey's root host, for tagging roofs, floors and details that belong to it. */
export function storeyRoot(storey) {
  return Object.values(storeyHosts(storey))[0];
}

/**
 * The stretch of a facade a wall actually occupies. Front and back walls run the
 * full length and the side walls butt between them, so corners are closed
 * without two walls occupying the same volume.
 */
function wallSpan(facade, thickness) {
  const inset = facade.side === 'left' || facade.side === 'right' ? thickness : 0;
  return { start: inset, end: facade.length - inset };
}

/** Facade-centred opening → wall-centred opening, for the course packer. */
function openingsForSpan(openings, facade, span, baseShift) {
  const spanCentre = (span.start + span.end) / 2;
  const facadeCentre = facade.length / 2;
  return openings.map((opening) => ({
    ...opening,
    centerX: opening.centerX + facadeCentre - spanCentre,
    bottom: opening.bottom + baseShift,
  }));
}

/** Packed field-stone courses along one facade, leaving real voids for its openings. */
export function layStoneWall(kit, facade, { thickness, openings = [], ground = false }) {
  const baseShift = ground ? GROUND_SINK : 0;
  const y0 = facade.y0 - baseShift;
  const span = wallSpan(facade, thickness);
  const centre = facadePoint(facade, (span.start + span.end) / 2, 0, -thickness / 2);
  const stones = buildWallCourses(kit.recipe, {
    width: span.end - span.start,
    depth: thickness,
    height: facade.y1 - y0,
    centerX: centre[0],
    centerZ: centre[2],
    yaw: facade.yaw,
    openings: openingsForSpan(openings, facade, span, baseShift),
    seedOffset: kit.seedOffset(),
  });
  for (const stone of stones) kit.add('stone', stone.translate(0, y0, 0));
}

/** Alternating long-and-short dressed corner stones at both ends of a facade. */
export function layQuoins(kit, facade, { thickness, ground = false }) {
  const y0 = facade.y0 - (ground ? GROUND_SINK : 0);
  const course = 0.34;
  const count = Math.max(2, Math.round((facade.y1 - y0) / course));
  const height = (facade.y1 - y0) / count;
  for (const end of [0, 1]) {
    for (let row = 0; row < count; row += 1) {
      const long = (row + end) % 2 === 0;
      const length = long ? 0.62 : 0.36;
      const u = end === 0 ? length / 2 - 0.02 : facade.length - length / 2 + 0.02;
      // A quoin is a dressed stone, so it keeps the reduced jitter the
      // irregularity kernel reserves for structural dressings.
      kit.stone({
        width: length,
        height: height * 0.94,
        depth: long ? thickness + 0.06 : thickness * 0.8,
        position: facadePoint(facade, u, y0 + height * (row + 0.5), -thickness / 2 + 0.035),
        rotation: [0, facade.yaw, 0],
      }, { category: 'quoin', heightRatio: row / count });
    }
  }
}

/** One continuous plaster shell across a facade; openings are inserts standing proud of it. */
export function layPlasterWall(kit, facade, { thickness }) {
  const span = wallSpan(facade, thickness);
  const height = facade.y1 - facade.y0;
  kit.add('mortar', beveledBox({
    width: span.end - span.start,
    height,
    depth: thickness,
    position: facadePoint(facade, (span.start + span.end) / 2, facade.y0 + height / 2, -thickness / 2),
    rotation: [0, facade.yaw, 0],
    detail: 1,
    bevelRatio: 0.02,
  }));
}

/**
 * Vertical board cladding: a backing panel with battens over the joints,
 * broken around openings, and corner posts. Openings are proud inserts, as on
 * a plaster wall.
 */
export function layBoardWall(kit, facade, { thickness, openings = [] }) {
  const span = wallSpan(facade, thickness);
  const height = facade.y1 - facade.y0;
  // The boards stand upright, so their grain does too.
  kit.add('wood', quarterTurnUv(beveledBox({
    width: span.end - span.start,
    height,
    depth: thickness,
    position: facadePoint(facade, (span.start + span.end) / 2, facade.y0 + height / 2, -thickness / 2),
    rotation: [0, facade.yaw, 0],
    detail: 1,
    bevelRatio: 0.02,
  })));
  const extents = openings.map((opening) => {
    const u = facade.length / 2 + opening.centerX;
    return {
      u0: u - opening.width / 2 - 0.12,
      u1: u + opening.width / 2 + 0.12,
      y1: facade.y0 + opening.bottom + opening.springHeight + opening.radius + 0.12,
      y0: facade.y0 + opening.bottom - 0.12,
    };
  });
  const pitch = 0.26;
  for (let u = pitch / 2; u < facade.length; u += pitch) {
    const blockers = extents.filter(({ u0, u1 }) => u > u0 && u < u1).sort((a, b) => a.y0 - b.y0);
    let start = facade.y0;
    const segments = [];
    for (const { y0, y1 } of blockers) {
      if (y0 > start) segments.push([start, y0]);
      start = Math.max(start, y1);
    }
    if (facade.y1 > start) segments.push([start, facade.y1]);
    for (const [a, b] of segments) {
      if (b - a < 0.1) continue;
      kit.add('wood', facadeBeam(facade, [u, a, 0.01], [u, b, 0.01], 0.06, { proud: 0.03 }));
    }
  }
  for (const u of [0.07, facade.length - 0.07]) {
    kit.add('wood', facadeBeam(facade, [u, facade.y0, 0.02], [u, facade.y1, 0.02], 0.14, { proud: 0.08 }));
  }
}

function frameFor(storey, side) {
  const frame = storey.frame ?? {};
  return { ...frame, ...(frame[side] ?? {}) };
}

/**
 * Build every wall of a storey with the openings the resolver placed on it.
 *
 * A stone storey lays coursed walls with voids, quoins and dressed openings; a
 * plaster storey lays a shell per face, half-timbering around its openings and
 * casements proud of it. Each wall is emitted as its own facade host.
 */
export function buildStorey(kit, storey, resolved) {
  // A log-built town (recipe `walls: 'logs'`) raises every timber or plaster storey in logs.
  if (kit.recipe.walls === 'logs' && storey.wall !== 'stone') storey = { ...storey, wall: 'logs', thickness: thicknessOf(storey) };
  const thickness = thicknessOf(storey);
  const facades = boxFacades({ ...storey.box, thickness });
  const hosts = storeyHosts(storey);
  const seat = storey.roofed ? ROOF_SEAT : 0;
  const framing = boxFacades({ ...storey.box, y1: storey.box.y1 - seat, thickness });
  const style = storey.openings ?? {};
  for (const side of sidesOf(storey)) {
    const host = hosts[side];
    const facade = facades[side];
    const openings = resolved.get(host.id) ?? [];
    kit.within(host, () => {
      if (storey.wall === 'stone') {
        layStoneWall(kit, facade, { thickness, openings, ground: storey.ground });
        if (storey.quoins !== false && (side === 'front' || side === 'back')) {
          layQuoins(kit, facade, { thickness, ground: storey.ground });
        }
      } else if (storey.wall === 'boards') {
        layBoardWall(kit, facade, { thickness, openings });
      } else if (storey.wall === 'logs') {
        layLogWall(kit, facade, { thickness, openings, phase: side === 'front' || side === 'back' ? 0 : 1 });
      } else {
        layPlasterWall(kit, facade, { thickness });
        const { braces = 'none', spacing = 1.5, rails = [] } = frameFor(storey, side);
        timberFrame(kit, framing[side], { braces, spacing, rails, openings });
      }
      buildOpenings(kit, facade, openings, {
        wall: storey.wall === 'stone' ? 'stone' : 'plaster',
        thickness,
        shutters: style.shutters ?? false,
        flowers: style.flowers ?? false,
        step: storey.ground ?? false,
      });
    });
  }
  if (storey.plate) {
    const { x0, x1, z0, z1, y0 } = storey.box;
    const out = storey.plate.overhang ?? 0.08;
    kit.within(storeyRoot(storey), () => floorPlate(kit, {
      x0: x0 - out, x1: x1 + out, z0: z0 - out, z1: z1 + out,
    }, y0 + (storey.plate.offset ?? 0)));
  }
  return facades;
}

/** Timber floor plate (bressumer) at a storey line, oversailing any jetty. */
export function floorPlate(kit, { x0, x1, z0, z1 }, y, thickness = 0.22) {
  kit.add('wood', beveledBox({
    width: x1 - x0,
    height: thickness,
    depth: z1 - z0,
    position: [(x0 + x1) / 2, y, (z0 + z1) / 2],
    detail: 1,
    bevelRatio: 0.08,
  }));
}

/** Joist ends projecting from a facade to carry the jettied storey above. */
export function joists(kit, facade, y, { spacing = 0.8, out = 0.45, size = 0.16 } = {}) {
  const count = Math.max(2, Math.round(facade.length / spacing));
  const step = facade.length / count;
  for (let index = 0; index < count; index += 1) {
    const u = step * (index + 0.5);
    kit.add('wood', facadeBeam(facade, [u, y, -0.1], [u, y, out], size, { proud: size }));
  }
}
