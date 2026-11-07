import { buildingEntry } from '../SettlementBuildingCatalog.js';
import { InteriorBuilder } from './interior/InteriorBuilder.js';
import { drawPiece } from './interior/RoomFurnitureMesh.js';
import { planRoom } from './interior/RoomPlan.js';
import { drainJob } from '../SettlementArrayJobs.js';

/**
 * What is behind every open door of a settlement: a timber-framed room over a
 * stone base course, plank floor and beamed ceiling, its windows, its hearth
 * and furniture (RoomPlan), and the doorway itself — the dark opening, its
 * frame and the leaf standing open.
 *
 * The pooled house meshes are shells: their walls face outward only and there
 * is nothing inside them. A room is the clear floor measured behind each
 * house's door (SettlementDoors.generated), so it fits inside the shell rather
 * than through it. Rooms differ with every house, so they are not pooled; a
 * rooms are batched by material and spatial cell for conservative frustum culling.
 *
 * Pure geometry in settlement-local space: x is plan x, z is minus plan z, y is
 * absolute. No three.
 */

/** How a house is laid out for walking into; the collision provider builds its walls from the same numbers. */
export const HOUSE_SHELL = Object.freeze({
  /** A plot is its mesh plus a hand's breadth; the wall is inside it. */
  plotMargin: 0.5,
  wallThickness: 0.55,
  /** Clear width left for the character either side of the door's own. */
  doorwayEase: 0.3,
  ceiling: 2.7,
  /** Kept between the room's ceiling and the lowest timber of the storey above. */
  ceilingClearance: 0.06,
});

/** Tints over the town's surface sets (wood, plaster, stone), and plain colours. */
const PLANKS = [0.46, 0.33, 0.22];
const BEAM = [0.3, 0.19, 0.12];
const DAUB = [0.64, 0.53, 0.38];
const BASE_STONE = [0.36, 0.34, 0.31];
const HEARTH_FLAGS = [0.3, 0.29, 0.27];
/** The doorway seen from the street: the room beyond, in shadow. */
const DARK = [0.035, 0.028, 0.022];
const EXTERIOR_TIMBER = [0.16, 0.1, 0.06];
/** Doorway and windows seen from the room: the bright street outside, ground below the sky, and leaded glass. */
const STREET = [0.4, 0.36, 0.28];
const SKY = [0.5, 0.62, 0.85];
const GLASS = [0.4, 0.5, 0.46];
/** Height of the stone base course round the room, and spacing of posts and joists. */
const FRAME = Object.freeze({ base: 0.85, posts: 1.9, joists: 0.95 });

/**
 * One enterable house in its footprint's frame (x along the frontage, z toward
 * the front): the room's floor, and the doorway through its front wall. Null
 * for a building with no door to open or no room behind it.
 */
export function houseShell(building) {
  const { door } = building;
  if (!door?.room) return null;
  const [x0, x1, z0, z1] = door.room;
  const clear = Math.max(door.width, 0.9) + HOUSE_SHELL.doorwayEase;
  const doorLeft = Math.max(x0 + 0.1, door.x - clear / 2);
  const doorRight = Math.min(x1 - 0.1, door.x + clear / 2);
  if (doorRight - doorLeft < 0.9) return null;
  // The front wall runs from the room to the outermost stone of the façade.
  return { x0, x1, back: z0, inner: z1, front: Math.max(z1 + 0.2, door.face ?? door.z), doorLeft, doorRight };
}

/**
 * One wall of the room, from inside: a stone base course, daub above, posts
 * standing proud of it and a rail where the two meet — a timber frame, drawn in
 * a few strips. The wall runs from (ax, az) to (bx, bz); `facing` points into
 * the room.
 */
function framedWall(b, ax, az, bx, bz, facing, floor, top) {
  const base = floor + FRAME.base;
  b.use('stone').wall(ax, az, bx, bz, floor, base, facing, BASE_STONE, 0.5);
  b.use('plaster').wall(ax, az, bx, bz, base, top, facing, DAUB, 0.45);
  const length = Math.hypot(bx - ax, bz - az);
  if (length < 0.3) return;
  const [ux, uz] = [(bx - ax) / length, (bz - az) / length];
  const proud = 0.05;
  const strip = (from, to, bottom, upper) => {
    b.wall(ax + ux * from + facing[0] * proud, az + uz * from + facing[1] * proud,
      ax + ux * to + facing[0] * proud, az + uz * to + facing[1] * proud, bottom, upper, facing, BEAM, 0.9);
  };
  b.use('wood');
  strip(0, length, base - 0.07, base + 0.07);
  strip(0, length, top - 0.16, top);
  const posts = Math.max(1, Math.round(length / FRAME.posts));
  // A knee brace from a post up to the wall plate, where the bay is wide enough to take one.
  const brace = (at, toward) => {
    const point = (along, y) => [ax + ux * along + facing[0] * proud, y, az + uz * along + facing[1] * proud];
    b.quad(point(at, top - 0.76), point(at, top - 0.62), point(at + toward * 0.6, top - 0.16), point(at + toward * 0.7, top - 0.16),
      [facing[0], 0, facing[1]], BEAM, 0.9);
  };
  for (let post = 0; post <= posts; post += 1) {
    const at = Math.min(length - 0.07, Math.max(0.07, length * post / posts));
    strip(at - 0.07, at + 0.07, base, top);
    if (length / posts < 1.5 || top - base < 1.4) continue;
    if (post > 0) brace(at - 0.07, -1);
    if (post < posts) brace(at + 0.07, 1);
  }
}

/** A window in a side wall, from inside: daylight behind a leaded frame, over a deep sill. */
function sideWindow(b, x, facing, shell, sill) {
  const middle = (shell.back + shell.inner) / 2;
  const inset = x + facing * 0.07;
  b.use('sky').wall(inset, middle - 0.45, inset, middle + 0.45, sill, sill + 0.8, [facing, 0], GLASS);
  b.use('wood');
  const frame = inset + facing * 0.012;
  for (const [z0, z1, bottom, top] of [[-0.53, -0.45, -0.08, 0.88], [0.45, 0.53, -0.08, 0.88], [-0.53, 0.53, 0.8, 0.88], [-0.03, 0.03, 0, 0.8], [-0.45, 0.45, 0.37, 0.43]]) {
    b.wall(frame, middle + z0, frame, middle + z1, sill + bottom, sill + top, [facing, 0], BEAM, 0.9);
  }
  b.box(Math.min(x, x + facing * 0.2), Math.max(x, x + facing * 0.2), middle - 0.55, middle + 0.55, sill - 0.12, sill - 0.06, BEAM, { underside: true });
}

function shade(color, factor) {
  return color.map((channel) => channel * factor);
}

/** As high as the shell is clear: a ceiling above its upper floor would be hidden behind it. */
function roomHeight(building) {
  const clearTo = (building.door.ceiling ?? HOUSE_SHELL.ceiling) - HOUSE_SHELL.ceilingClearance - 0.05;
  return Math.min(clearTo, buildingEntry(building.kind, building.variant).height - 0.2);
}

function addHouse(b, building, shell) {
  const { x0, x1, back, inner, front, doorLeft, doorRight } = shell;
  const floor = building.pad + 0.05;
  const height = roomHeight(building);
  const top = floor + height;
  const doorTop = Math.min(top - 0.25, building.pad + building.door.height);
  const plan = planRoom(building, shell, height);
  b.enter(building, plan.lights.map((light) => ({ ...light, at: [light.at[0], floor + light.at[1], light.at[2]] })));

  b.use('wood').slab(x0, x1, back, inner, floor, true, PLANKS, 0.7);
  // The ceiling's boards, and the joists that carry them across the room.
  b.slab(x0, x1, back, inner, top, false, shade(PLANKS, 0.7), 0.7);
  for (let z = back + FRAME.joists / 2; z < inner; z += FRAME.joists) {
    b.box(x0, x1, z - 0.08, z + 0.08, top - 0.2, top, BEAM, { underside: true, density: 0.9 });
  }
  const hearth = plan.pieces.find(({ type }) => type === 'hearth');
  if (hearth) b.use('stone').slab(hearth.x - 1.2, hearth.x + 1.2, back, Math.min(inner, back + 1.5), floor + 0.006, true, HEARTH_FLAGS, 0.5);

  framedWall(b, x0, back, x1, back, [0, 1], floor, top);
  framedWall(b, x0, inner, x0, back, [1, 0], floor, top);
  framedWall(b, x1, back, x1, inner, [-1, 0], floor, top);
  // The front wall, either side of the doorway, and the lintel over it.
  framedWall(b, x0, inner, doorLeft, inner, [0, -1], floor, top);
  framedWall(b, doorRight, inner, x1, inner, [0, -1], floor, top);
  b.use('plaster').wall(doorLeft, inner, doorRight, inner, doorTop, top, [0, -1], DAUB, 0.45);
  b.use('wood');
  b.wall(doorLeft, inner - 0.05, doorRight, inner - 0.05, doorTop, doorTop + 0.16, [0, -1], BEAM, 0.9);
  // The thickness of the wall in the doorway: both reveals, the soffit and the threshold.
  b.wall(doorLeft, inner, doorLeft, front, floor, doorTop, [1, 0], BEAM, 0.9);
  b.wall(doorRight, inner, doorRight, front, floor, doorTop, [-1, 0], BEAM, 0.9);
  b.slab(doorLeft, doorRight, inner, front, doorTop, false, BEAM, 0.9);
  b.use('stone').slab(doorLeft, doorRight, inner, front + 0.3, floor, true, HEARTH_FLAGS, 0.5);
  // From inside: daylight in the doorway. The shell's masonry runs unbroken
  // behind where its door hung, so the opening cannot simply be looked through.
  const horizon = floor + (doorTop - floor) * 0.36;
  b.use('sky').wall(doorLeft, inner + 0.02, doorRight, inner + 0.02, floor, horizon, [0, -1], STREET);
  b.wall(doorLeft, inner + 0.02, doorRight, inner + 0.02, horizon, doorTop, [0, -1], SKY);
  if (plan.windows) {
    sideWindow(b, x0, 1, shell, floor + 1.05);
    sideWindow(b, x1, -1, shell, floor + 1.05);
  }
  for (const piece of plan.pieces) drawPiece(b, piece, floor, height);

  // From the street, in the sun like the rest of the house: the shadowed
  // opening over the wall the shell still draws there, just proud of its
  // outermost stone, its frame, and the leaf standing open beside it.
  b.use('exterior');
  const proud = front + 0.1;
  b.wall(doorLeft, proud, doorRight, proud, floor, doorTop, [0, 1], DARK);
  const post = 0.12;
  b.wall(doorLeft - post, proud + 0.02, doorLeft, proud + 0.02, building.pad, doorTop + post, [0, 1], EXTERIOR_TIMBER);
  b.wall(doorRight, proud + 0.02, doorRight + post, proud + 0.02, building.pad, doorTop + post, [0, 1], EXTERIOR_TIMBER);
  b.wall(doorLeft, proud + 0.02, doorRight, proud + 0.02, doorTop, doorTop + post, [0, 1], EXTERIOR_TIMBER);
  const leaf = doorRight - doorLeft;
  const hinge = doorRight + post;
  const boards = shade(EXTERIOR_TIMBER, 1.25);
  b.wall(hinge + 0.03, proud, hinge + 0.03, proud + leaf * 0.92, floor, doorTop, [1, 0], boards);
  b.wall(hinge - 0.03, proud, hinge - 0.03, proud + leaf * 0.92, floor, doorTop, [-1, 0], boards);
}

/**
 * What blocks inside one room, as boxes in the footprint's frame
 * (`[x0, x1, z0, z1, height]`): the pieces of its plan too big to walk through.
 */
export function roomSolids(building, shell) {
  return planRoom(building, shell, roomHeight(building)).pieces.filter(({ solid }) => solid).map(({ solid }) => solid);
}

/**
 * @param {object} plan a settlement plan whose buildings carry `door` and `pad`
 * @returns {?object[]} indexed spatial/material batches (InteriorBuilder),
 *   or null when no house can be entered
 */
export function* settlementInteriorJob(plan) {
  const builder = new InteriorBuilder();
  let rooms = 0;
  for (const building of plan.buildings) {
    const shell = houseShell(building);
    if (shell) { addHouse(builder, building, shell); rooms += 1; }
    yield;
  }
  return rooms > 0 ? yield* builder.arraysJob() : null;
}
export function settlementInteriorArrays(plan) { return drainJob(settlementInteriorJob(plan)); }
