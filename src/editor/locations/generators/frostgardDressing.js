import { beam, block, box, hewnBeam, panel, rod, stoneBlock } from '../gen/propKit.js';
import { DARK, HEARTH, PALE, STONE, logWall } from './frostgardKit.js';
import { barrel, crate, lantern } from './kits.js';

/** What a Norths household leaves about a yard, and what stands inside its hall. */

const P = (x, y, z) => ({ x, y, z });
const FUR = [0x8b8378, 0x5f5246, 0xb4aa9a];
/** Timber kept indoors: dry and smoke-greyed, paler than what stands in the weather. */
const HALL_LOG = 0xa3947e, HALL_BEAM = 0x65574a;
/** Metres between the frames that carry a hall's roof. */
const BAY = 4;

/** A stacked woodpile along X, `rows` high. */
export function woodpile(b, at, { length = 1.2, rows = 3, count = 5 } = {}) {
  for (let row = 0; row < rows; row += 1) {
    for (let index = 0; index < count - row; index += 1) {
      const y = at.y + 0.17 + row * 0.31, z = at.z + index * 0.36 + row * 0.18;
      b.prop('timber', rod(P(at.x - length / 2, y, z), P(at.x + length / 2, y, z), 0.17, 0.17, 7), 0x8d7150);
    }
  }
  b.nav.block(P(at.x, at.y, at.z + count * 0.18), Math.max(length, count * 0.36) * 0.6, 2);
}

/** A supply sled on iron-shod runners, loaded and lashed, its nose toward `yaw`. */
export function sled(b, at, yaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const L = (dx, dy, dz) => P(at.x + c * dx + s * dz, at.y + dy, at.z - s * dx + c * dz);
  for (const dx of [-0.42, 0.42]) {
    b.prop('timber', hewnBeam(L(dx, 0.1, -1.2), L(dx, 0.1, 1.1), 0.09, 0.12), DARK);
    b.prop('timber', hewnBeam(L(dx, 0.1, 1.1), L(dx, 0.5, 1.6), 0.09, 0.1), DARK);
    for (const dz of [-0.8, 0, 0.8]) b.prop('timber', rod(L(dx, 0.14, dz), L(dx, 0.42, dz), 0.04, 0.04, 5), PALE);
  }
  b.prop('timber', panel(L(0, 0.44, -1.1), L(0, 0.44, 1), P(c, 0, -s), 1, 0.06), 0x86694a);
  b.prop('timber', stoneBlock(0.8, 0.5, 0.9, L(0, 0.47, -0.45), { yaw, bevel: 0.1, irregular: 0.5 }), 0xa39a86);
  crate(b, L(0, 0.47, 0.45), 0.62, yaw);
  b.nav.block(at, 1.3, 2);
}

/** A drying rack: split fish or stretched hides on poles under a lean-to canopy. */
export function dryingRack(b, at, { width = 3.4, hides = false } = {}) {
  const L = (dx, dy, dz) => P(at.x + dx, at.y + dy, at.z + dz);
  for (const dx of [-width / 2, 0, width / 2]) {
    b.prop('timber', rod(L(dx, -0.2, -0.5), L(dx, 2.5, -0.5), 0.07, 0.06, 6), DARK);
    b.prop('timber', rod(L(dx, -0.2, 0.5), L(dx, 2, 0.5), 0.07, 0.06, 6), DARK);
    b.nav.block(L(dx, 0, 0), 0.5, 2.4);
  }
  b.prop('roof', panel(L(-width / 2 - 0.3, 2.34, 0), L(width / 2 + 0.3, 2.34, 0), P(0, -0.5, 1), 1.5, 0.1), 0xffffff);
  for (const y of [1.25, 1.7]) b.prop('timber', rod(L(-width / 2, y, 0), L(width / 2, y, 0), 0.035, 0.035, 5), PALE);
  for (let dx = -width / 2 + 0.3; dx < width / 2 - 0.2; dx += hides ? 1.05 : 0.3) {
    if (hides) b.prop('timber', box(0.85, 1.05, 0.03, L(dx + 0.3, 1.15, 0)), FUR[Math.floor(b.range(0, 3))]);
    else b.prop('timber', box(0.09, b.range(0.3, 0.45), 0.03, L(dx, 1.5 - b.range(0, 0.06), 0)), 0xb9a68a);
  }
}

/** A long fire in a stone kerb down the middle of a hall, `length` metres along Z. */
export function longHearth(b, at, length) {
  const L = (dx, dy, dz) => P(at.x + dx, at.y + dy, at.z + dz);
  for (let dz = -length / 2; dz <= length / 2 + 0.01; dz += 0.6) {
    for (const dx of [-0.62, 0.62]) b.prop('masonry', stoneBlock(0.3, 0.26, 0.56, L(dx, 0, dz), { irregular: 0.5 }), STONE);
    b.nav.block(L(0, 0, dz), 0.85, 2);
  }
  for (const dz of [-length / 2 - 0.3, length / 2 + 0.3]) b.prop('masonry', stoneBlock(1.5, 0.26, 0.3, L(0, 0, dz), { irregular: 0.5 }), STONE);
  // A bed of ash with the fire showing through it, not a slab of orange.
  b.prop('glow', box(0.95, 0.1, length, L(0, 0.09, 0)), '#3a1206', 1);
  for (let dz = -length / 2 + 0.3; dz < length / 2; dz += 0.45) {
    b.prop('glow', stoneBlock(b.range(0.16, 0.34), 0.07, b.range(0.14, 0.3), L(b.range(-0.3, 0.3), 0.11, dz),
      { irregular: 0.8, yaw: b.range(0, 3) }), '#ff6a1e', b.range(0.7, 1.7));
    b.prop('iron', rod(L(-0.4, 0.17, dz), L(0.4, 0.21, dz + b.range(-0.3, 0.3)), 0.07, 0.06, 6), 0x2a1f18);
  }
  for (const t of [-0.4, -0.2, 0, 0.2, 0.4]) {
    const at = L(b.range(-0.15, 0.15), 0.15, t * length);
    b.flame(at, { width: b.range(0.45, 0.7), height: b.range(0.6, 1), core: '#fff1b4', outer: '#ff5810', speed: b.range(0.9, 1.3) });
    b.emit('ember', P(at.x, at.y + 0.3, at.z));
  }
  for (const t of [-0.34, 0, 0.34]) b.light(L(0, 1.1, t * length), HEARTH, 7.5, 17, { radius: 1.5, halo: 0.7 });
}

/**
 * The inside of an earth-sheltered hall: plank floor, log lining, a frame of
 * posts and tie beams under a boarded roof, the long hearth, sleeping benches
 * down both sides and the high seat at the far end. `at` is the middle of the
 * floor; the hall runs along Z with its door at +Z and a rear door at -Z.
 *
 * It is dressing for a cavity the generator has already cut: the rock around
 * it is what keeps the firelight in and the daylight out of the bake.
 */
export function hallInterior(b, at, { halfWidth, halfLength, wallHeight, ridge }) {
  const L = (dx, dy, dz) => P(at.x + dx, at.y + dy, at.z + dz);
  const wall = halfWidth - 0.2, aisle = halfWidth * 0.52, door = { from: halfWidth - 1.1, to: halfWidth + 1.1, height: 2.5 };
  b.prop('planks', panel(L(0, 0.02, -halfLength), L(0, 0.02, halfLength), P(1, 0, 0), halfWidth * 2, 0.06), 0xffffff);
  for (const sx of [-1, 1]) {
    logWall(b, L(sx * wall, 0, -halfLength), L(sx * wall, 0, halfLength), wallHeight, { overrun: 0, tint: HALL_LOG });
    // Roof boards on the rafters, so the vault above is timber and not bare rock.
    const rise = ridge - wallHeight;
    b.prop('timber', panel(L(sx * wall / 2, wallHeight + rise / 2 + 0.16, -halfLength), L(sx * wall / 2, wallHeight + rise / 2 + 0.16, halfLength),
      P(-sx * wall, rise, 0), Math.hypot(wall, rise) + 0.3, 0.08), 0x5c5046);
    for (const share of [0.36, 0.7]) {
      b.prop('timber', hewnBeam(L(sx * wall * (1 - share), wallHeight + rise * share, -halfLength), L(sx * wall * (1 - share), wallHeight + rise * share, halfLength), 0.2, 0.22), HALL_BEAM);
    }
    // Sleeping bench: a raised platform the length of the hall, furs thrown over it.
    const benchWidth = wall - aisle - 0.5;
    b.prop('planks', block(benchWidth, 0.5, halfLength * 2 - 3, L(sx * (wall - benchWidth / 2 - 0.15), 0, 0)), 0xcdbfae);
    for (let dz = -halfLength + 3; dz < halfLength - 3; dz += b.range(2.2, 3.4)) {
      b.prop('timber', stoneBlock(benchWidth * 0.8, 0.12, b.range(1.3, 1.9), L(sx * (wall - benchWidth / 2 - 0.15), 0.5, dz),
        { bevel: 0.05, irregular: 0.7 }), FUR[Math.floor(b.range(0, 3))]);
    }
  }
  for (const sz of [-1, 1]) {
    logWall(b, L(-halfWidth, 0, sz * (halfLength - 0.2)), L(halfWidth, 0, sz * (halfLength - 0.2)), ridge, { overrun: 0, gap: door, tint: HALL_LOG });
    for (const dx of [-1.2, 1.2]) b.prop('timber', hewnBeam(L(dx, 0, sz * (halfLength - 0.25)), L(dx, 2.6, sz * (halfLength - 0.25)), 0.26, 0.3), HALL_BEAM);
    b.prop('timber', hewnBeam(L(-1.5, 2.65, sz * (halfLength - 0.25)), L(1.5, 2.65, sz * (halfLength - 0.25)), 0.3, 0.3), HALL_BEAM);
  }
  b.prop('timber', hewnBeam(L(0, ridge - 0.1, -halfLength), L(0, ridge - 0.1, halfLength), 0.3, 0.34), HALL_BEAM);

  for (let dz = -halfLength + 2; dz <= halfLength - 2 + 0.01; dz += BAY) {
    for (const sx of [-1, 1]) {
      b.prop('timber', hewnBeam(L(sx * aisle, 0, dz), L(sx * aisle, wallHeight + 0.3, dz), 0.32, 0.32, { taper: 0.04 }), HALL_LOG);
      b.prop('timber', hewnBeam(L(sx * aisle, wallHeight - 0.7, dz), L(sx * (aisle - 0.9), wallHeight + 0.2, dz), 0.16, 0.18), HALL_BEAM);
      b.prop('timber', hewnBeam(L(sx * wall, wallHeight, dz), L(0, ridge - 0.15, dz), 0.2, 0.26), HALL_BEAM);
      b.nav.block(L(sx * aisle, 0, dz), 0.42, 3);
    }
    b.prop('timber', hewnBeam(L(-wall, wallHeight + 0.3, dz), L(wall, wallHeight + 0.3, dz), 0.28, 0.32), HALL_BEAM);
    b.prop('timber', hewnBeam(L(0, wallHeight + 0.45, dz), L(0, ridge - 0.25, dz), 0.2, 0.2), HALL_BEAM);
  }
  for (const dz of [-halfLength + 2 + BAY / 2, halfLength - 2 - BAY / 2]) {
    for (const sx of [-1, 1]) lantern(b, L(sx * aisle * 0.6, wallHeight - 0.35, dz), { intensity: 2.6, range: 9, halo: 1, hung: 0.5 });
  }

  longHearth(b, L(0, 0, 1), halfLength * 0.75);

  // The high seat on its dais, with a board for the household before it.
  const head = -halfLength + 1.7;
  b.prop('masonry', stoneBlock(4.4, 0.28, 2.2, L(0, 0, head), { irregular: 0.3 }), STONE);
  b.prop('timber', block(1, 0.5, 0.8, L(0, 0.28, head - 0.2)), HALL_LOG);
  b.prop('timber', hewnBeam(L(0, 0.78, head - 0.6), L(0, 2.5, head - 0.66), 0.14, 1.1), HALL_BEAM);
  for (const dx of [-0.6, 0.6]) b.prop('timber', hewnBeam(L(dx, 0.28, head - 0.6), L(dx, 2.8, head - 0.6), 0.16, 0.16, { taper: 0.2 }), HALL_BEAM);
  b.prop('timber', stoneBlock(1.1, 0.1, 0.9, L(0, 0.78, head - 0.15), { bevel: 0.04, irregular: 0.6 }), FUR[2]);
  for (const dx of [-1.7, 1.7]) {
    b.prop('timber', rod(L(dx, 0.28, head + 0.5), L(dx, 1.5, head + 0.5), 0.06, 0.05, 6), HALL_BEAM);
    lantern(b, L(dx, 1.7, head + 0.5), { intensity: 2.4, range: 8, halo: 1 });
  }
  b.nav.block(L(0, 0, head), 2.4, 3);
  const table = head + 3.2;
  b.prop('planks', block(3.2, 0.08, 0.9, L(0, 0.78, table)), 0xbfae98);
  for (const dx of [-1.2, 1.2]) b.prop('timber', hewnBeam(L(dx, 0, table), L(dx, 0.78, table), 0.14, 0.7), HALL_BEAM);
  for (const dz of [-0.75, 0.75]) b.prop('planks', block(3, 0.08, 0.32, L(0, 0.44, table + dz)), 0xa89680);
  b.nav.block(L(-0.9, 0, table), 1.1, 2);
  b.nav.block(L(0.9, 0, table), 1.1, 2);

  // Winter stores stacked inside the door, out of the frost.
  for (const [dx, dz] of [[aisle - 0.2, halfLength - 1.5], [aisle + 0.5, halfLength - 1.2], [-aisle, halfLength - 1.3]]) {
    barrel(b, L(dx, 0, dz));
    b.nav.block(L(dx, 0, dz), 0.5, 2);
  }
  crate(b, L(-aisle - 0.8, 0, halfLength - 1.4), 0.8, 0.3);
  b.nav.addRect(L(0, 0, 0), aisle + 0.35, halfLength - 0.6);
}

/** A door hide: a heavy curtain pegged to a lintel, drawn half aside, across a passage running along Z at `at`. */
export function doorHide(b, at, { width = 2.2, height = 2.4 } = {}) {
  b.prop('timber', hewnBeam(P(at.x - width / 2 - 0.2, at.y + height, at.z), P(at.x + width / 2 + 0.2, at.y + height, at.z), 0.2, 0.22), DARK);
  b.prop('timber', box(width * 0.5, height - 0.1, 0.07, P(at.x - width * 0.26, at.y + height / 2, at.z)), FUR[1]);
  b.prop('timber', beam(P(at.x + width * 0.5, at.y + height, at.z), P(at.x + width * 0.34, at.y + 0.3, at.z + 0.1), 0.3, 0.08), FUR[0]);
}
