import { beveledBox, quarterTurnUv } from '../ProceduralWorkshopGeometry.js';
import { buildWallCourses, stackCourses } from '../ProceduralWorkshopMasonry.js';
import { createRandom, mixSeed } from '../ProceduralRandom.js';
import { addFacadeColumn, boxFacades, facadeBeam, facadePoint } from './HouseFacade.js';
import { buildOpenings } from './HouseOpenings.js';
import { stoneTimberFrame, timberFrame } from './HouseTimberFrame.js';
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

/**
 * Heavy sculpted corner boulder quoins at both ends of a facade.
 *
 * Courses vary in height with a broader battered foundation boulder at the base,
 * deeply pillowed bevels, alternating long-and-short reach, and a chiseled cap
 * tenon at the top of the corner stack.
 */
export function layQuoins(kit, facade, { thickness, ground = false, roofed = false, sideWall = false }) {
  const y0 = facade.y0 - (ground ? GROUND_SINK : 0);
  const totalHeight = facade.y1 - y0;
  const courses = stackCourses(
    totalHeight,
    0.45,
    createRandom(mixSeed(kit.recipe.seed, kit.seedOffset() + (sideWall ? 0x51de : 0x901a))),
  );
  const count = courses.length;
  const inset = sideWall ? thickness : 0;
  for (const end of [0, 1]) {
    for (let row = 0; row < count; row += 1) {
      const course = courses[row];
      const isBase = ground && row === 0;
      const long = (row + end + (sideWall ? 1 : 0)) % 2 === 0;
      const baseLength = sideWall
        ? (long ? 0.44 : 0.28)
        : (long ? 0.74 : 0.48);
      const lengthJitter = 0.92 + (((row * 37 + end * 19) % 17) / 17) * 0.16;
      const length = Math.min(
        (facade.length - inset * 2) * 0.36,
        baseLength * lengthJitter * (isBase ? 1.15 : 1),
      );
      if (length < 0.18) continue;
      const outerProud = isBase ? 0.115 : long ? 0.088 : 0.062;
      const stoneDepth = thickness + outerProud;
      const centerD = -thickness / 2 + outerProud / 2;
      const edgeProtrusion = sideWall ? -0.01 : 0.045;
      const u = end === 0
        ? inset + length / 2 - edgeProtrusion
        : facade.length - inset - length / 2 + edgeProtrusion;
      kit.stone({
        width: length,
        height: course.height * (isBase ? 0.97 : 0.94),
        depth: stoneDepth,
        position: facadePoint(facade, u, y0 + course.y, centerD),
        rotation: [0, facade.yaw, 0],
        batter: isBase ? 0.22 : row === count - 1 ? 0.08 : 0.04,
      }, {
        category: isBase || long ? 'boulder' : 'quoin',
        heightRatio: row / Math.max(1, count),
      });
    }
    // Sculpted pyramidal corner tenon cap stone on primary facades, as in the modular cottage reference.
    if (!sideWall && count >= 3) {
      const capSize = 0.22;
      const capHeight = 0.12;
      const capU = end === 0 ? capSize * 0.65 : facade.length - capSize * 0.65;
      const capY = facade.y1 - (roofed ? ROOF_SEAT : 0) + capHeight * 0.42;
      kit.stone({
        width: capSize,
        height: capHeight,
        depth: capSize,
        position: facadePoint(facade, capU, capY, -thickness * 0.28),
        rotation: [0, facade.yaw, 0],
        batter: 0.34,
      }, { category: 'quoin', heightRatio: 1 });
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
 * Vertical board cladding: a backing panel with varied-width hand-sawn planks
 * and battens over the joints, broken around openings, and heavy corner columns.
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
  let boardIndex = 0;
  for (let u = 0.16; u < facade.length - 0.12;) {
    const pitch = 0.21 + ((boardIndex * 29) % 11) * 0.011;
    const battenWidth = 0.055 + ((boardIndex * 13) % 7) * 0.004;
    const battenProud = 0.03 + ((boardIndex * 17) % 5) * 0.004;
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
      kit.add('wood', facadeBeam(facade, [u, a, 0.012], [u, b, 0.012], battenWidth, { proud: battenProud }));
    }
    u += pitch;
    boardIndex += 1;
  }
  for (const u of [0.09, facade.length - 0.09]) {
    addFacadeColumn(kit, facade, u, facade.y0, facade.y1, {
      size: 0.18,
      proud: 0.1,
      d: 0.025,
      foot: true,
      capital: true,
      tenon: false,
      pegs: true,
    });
  }
}

function frameFor(storey, side) {
  const frame = storey.frame ?? {};
  return { ...frame, ...(frame[side] ?? {}) };
}

/**
 * Build every wall of a storey with the openings the resolver placed on it.
 *
 * A stone storey lays coursed walls with voids, quoins, structural timber
 * columns/wall plates and dressed openings; a plaster storey lays a shell per
 * face, half-timbering around its openings and casements proud of it. Each wall
 * is emitted as its own facade host.
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
        if (storey.quoins !== false) {
          layQuoins(kit, facade, {
            thickness,
            ground: storey.ground,
            roofed: storey.roofed ?? false,
            sideWall: side === 'left' || side === 'right',
          });
        }
        stoneTimberFrame(kit, framing[side], {
          openings,
          roofed: storey.roofed ?? false,
        });
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
