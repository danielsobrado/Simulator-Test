import { icicle } from '../gen/iceKit.js';
import { beam, block, box, coursedWall, hewnBeam, panel, rod, stoneBlock } from '../gen/propKit.js';
import { lantern } from './kits.js';

/**
 * Norths building: horizontal hewn logs on rubble plinths, steep roofs, tall
 * smoke vents, windbreaks (docs/asset-bible/regions/frostgard.md). Everything
 * faces +Z unless it says otherwise. Material keys: `timber`, `masonry`, `roof`,
 * `iron`, `glow`, and `clearIce` for icicles.
 */

const P = (x, y, z) => ({ x, y, z });
export const LOG = 0x7f6243, DARK = 0x4d3a29, PALE = 0x9c8a6a, STONE = 0xa8a39b;
export const HEARTH = '#ff9a45';
const LOG_RADIUS = 0.19, LOG_COURSE = 0.36;

/**
 * A wall of stacked logs from floor point `a` to `c`. Alternate courses run
 * past the corners, as notched logs do. `gap` leaves a doorway:
 * `{ from, to, height }` in metres along the wall.
 */
export function logWall(b, a, c, height, { material = 'timber', tint = LOG, gap = null, overrun = 0.25 } = {}) {
  const length = Math.hypot(c.x - a.x, c.z - a.z);
  const ux = (c.x - a.x) / length, uz = (c.z - a.z) / length;
  const at = (along, y) => P(a.x + ux * along, a.y + y, a.z + uz * along);
  for (let row = 0; row < Math.round(height / LOG_COURSE); row += 1) {
    const y = LOG_RADIUS + row * LOG_COURSE, over = row % 2 ? overrun : 0;
    const spans = gap && y < gap.height ? [[-over, gap.from], [gap.to, length + over]] : [[-over, length + over]];
    for (const [from, to] of spans) b.prop(material, rod(at(from, y), at(to, y), LOG_RADIUS, LOG_RADIUS, 7), tint);
  }
}

/** Icicles along an eave or lintel from `a` to `c`, longest where meltwater gathers mid-span. */
export function eaveIcicles(b, a, c, { spacing = 0.32, length = 0.9 } = {}) {
  const span = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z);
  for (let along = b.range(0, spacing); along < span; along += spacing * b.range(0.6, 1.6)) {
    const t = along / span;
    const reach = length * b.range(0.25, 1) * (0.5 + Math.sin(Math.PI * t) * 0.5);
    b.prop('clearIce', icicle(P(a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t, a.z + (c.z - a.z) * t),
      reach, 0.03 + reach * 0.05, { phase: along * 7 }), 0xffffff);
  }
}

/**
 * A steep pitched roof over `at` (the centre of the building at floor level):
 * rafters, sheathing, bargeboards and a ridge beam. The ridge runs along X, or
 * along Z with `alongZ`. `icicles` hangs them from both eaves.
 */
export function pitchedRoof(b, at, {
  length, width, eave, ridge, overhang = 0.9, alongZ = false, timber = 'timber', sheath = 'roof', icicles = false,
}) {
  const W = alongZ ? (u, y, v) => P(at.x + v, at.y + y, at.z + u) : (u, y, v) => P(at.x + u, at.y + y, at.z + v);
  const half = width / 2 + overhang, rise = ridge - eave + 0.25;
  const rafters = Math.max(4, Math.round(length / 1.3));
  for (const sign of [-1, 1]) {
    for (let index = 0; index <= rafters; index += 1) {
      const u = -length / 2 - 0.5 + (length + 1) * index / rafters;
      b.prop(timber, beam(W(u, eave - 0.25, sign * half), W(u, ridge, 0), 0.16, 0.2), DARK);
    }
    const midY = eave - 0.25 + rise / 2 + 0.26;
    const slope = alongZ ? P(-sign * half, rise, 0) : P(0, rise, -sign * half);
    b.prop(sheath, panel(W(-length / 2 - 0.8, midY, sign * half / 2), W(length / 2 + 0.8, midY, sign * half / 2),
      slope, Math.hypot(half, rise) + 0.2, 0.32), 0xffffff);
    for (const end of [-1, 1]) {
      const u = end * (length / 2 + 0.75);
      b.prop(timber, beam(W(u, eave - 0.2, sign * half), W(u, ridge + 0.25, 0), 0.12, 0.3), DARK);
    }
    if (icicles) eaveIcicles(b, W(-length / 2 - 0.7, eave - 0.42, sign * half), W(length / 2 + 0.7, eave - 0.42, sign * half));
  }
  b.prop(timber, beam(W(-length / 2 - 0.9, ridge + 0.1, 0), W(length / 2 + 0.9, ridge + 0.1, 0), 0.3), DARK);
}

/** A torch on a stake: the way-marker of every Norths yard and road. */
export function torch(b, foot, { height = 1.9, intensity = 4, range = 14 } = {}) {
  b.prop('timber', rod(foot, P(foot.x, foot.y + height, foot.z), 0.06, 0.05, 6), DARK);
  lantern(b, P(foot.x, foot.y + height + 0.2, foot.z), { tint: '#ffa257', intensity, range, halo: 1.4 });
  b.nav.block(foot, 0.4, 2);
}

/**
 * A Norths longhall on a rubble plinth: hewn-log walls, a steep roof, a smoke
 * vent on the ridge and the hearth showing at the open door. Not enterable;
 * `at` is the centre of the plinth at ground level.
 */
export function longhall(b, at, { length, width, wallHeight, roofRise }, { icicles = false } = {}) {
  const L = (dx, dy, dz) => P(at.x + dx, at.y + dy, at.z + dz);
  const plinth = 0.9, eave = plinth + wallHeight, ridge = eave + roofRise, front = width / 2;
  b.prop('masonry', block(length + 0.8, plinth, width + 0.8, at), STONE);
  logWall(b, L(-length / 2, plinth, front), L(length / 2, plinth, front), wallHeight, { gap: { from: length / 2 - 0.9, to: length / 2 + 0.9, height: 2.1 } });
  logWall(b, L(-length / 2, plinth, -front), L(length / 2, plinth, -front), wallHeight);
  for (const end of [-1, 1]) {
    logWall(b, L(end * length / 2, plinth + 0.18, -front), L(end * length / 2, plinth + 0.18, front), wallHeight - 0.18);
    // The gable closes with shortening logs up to the ridge.
    for (let y = eave + 0.1; y < ridge - 0.3; y += LOG_COURSE) {
      const half = front * (1 - (y - eave) / roofRise);
      b.prop('timber', rod(L(end * length / 2, y, -half), L(end * length / 2, y, half), LOG_RADIUS, LOG_RADIUS, 7), LOG);
    }
  }
  pitchedRoof(b, at, { length, width, eave, ridge, icicles });
  b.prop('timber', block(1.5, 0.9, 1.1, L(length * 0.15, ridge - 0.1, 0)), DARK);

  // Door frame, the leaf standing open, and the fire seen through it.
  for (const dx of [-0.95, 0.95]) b.prop('timber', box(0.14, 2.3, 0.14, L(dx, plinth + 1.15, front + 0.05)), DARK);
  b.prop('timber', box(2.2, 0.2, 0.2, L(0, plinth + 2.35, front + 0.05)), DARK);
  b.prop('timber', box(0.1, 2.2, 1.3, L(1.55, plinth + 1.1, front + 0.7), 0.35), 0x5d4631);
  b.prop('glow', box(1.7, 2.1, 0.1, L(0, plinth + 1.05, front - 0.3)), HEARTH, 2.6);
  b.light(L(0, plinth + 1.3, front + 1.4), HEARTH, 9, 22, { radius: 1.6, halo: 3.4 });
  for (const dx of [-length * 0.32, length * 0.32]) {
    b.prop('glow', box(0.6, 0.5, 0.1, L(dx, plinth + 1.6, front + 0.22)), HEARTH, 2);
    b.prop('timber', box(0.8, 0.1, 0.16, L(dx, plinth + 1.3, front + 0.24)), DARK);
    b.light(L(dx, plinth + 1.6, front + 1), HEARTH, 2.4, 10, { halo: 1.2 });
  }
  b.light(L(length * 0.15, ridge + 1.5, 0), HEARTH, 1.2, 9);
  b.emit('smoke', L(length * 0.15, ridge + 0.9, 0));

  // Steps down from the plinth.
  b.prop('masonry', block(2.4, plinth * 0.66, 0.8, L(0, 0, front + 0.8)), STONE);
  b.prop('masonry', block(2.4, plinth * 0.33, 0.8, L(0, 0, front + 1.6)), STONE);
  b.nav.addRect(L(0, plinth * 0.33, front + 1.6), 1.2, 0.4);
  b.nav.addRect(L(0, plinth * 0.66, front + 0.8), 1.2, 0.4);
  for (const dx of [-length * 0.27, 0, length * 0.27]) b.nav.block(L(dx, 0, dx === 0 ? -0.6 : 0), width * 0.62, 6);
}

/** A raised store on staddle stones, clear of the snow and the rats. */
export function storehouse(b, at, { icicles = false } = {}) {
  for (const [dx, dz] of [[-1.6, -1.2], [1.6, -1.2], [-1.6, 1.2], [1.6, 1.2]]) {
    b.prop('masonry', stoneBlock(0.6, 0.8, 0.6, P(at.x + dx, at.y, at.z + dz), { batter: 0.2 }), STONE);
  }
  b.prop('timber', block(4.4, 0.2, 3.4, P(at.x, at.y + 0.8, at.z)), DARK);
  for (const dz of [-1.5, 1.5]) logWall(b, P(at.x - 2, at.y + 1, at.z + dz), P(at.x + 2, at.y + 1, at.z + dz), 2.1, { tint: 0x86694a });
  for (const dx of [-2, 2]) logWall(b, P(at.x + dx, at.y + 1.18, at.z - 1.5), P(at.x + dx, at.y + 1.18, at.z + 1.5), 1.9, { tint: 0x86694a });
  pitchedRoof(b, P(at.x, at.y, at.z), { length: 4.2, width: 3.2, eave: 3.1, ridge: 4.6, overhang: 0.6, icicles });
  b.prop('timber', box(0.9, 1.5, 0.1, P(at.x, at.y + 1.85, at.z + 1.72)), DARK);
  b.prop('timber', beam(P(at.x, at.y, at.z + 3), P(at.x, at.y + 1, at.z + 1.8), 0.8, 0.08), DARK);
  b.nav.block(at, 2.9, 5);
}

/**
 * A windbreak palisade of sharpened logs from `a` to `c`, standing on
 * `groundAt(x, z)`. `skip` leaves an opening: `[from, to]` metres along it.
 */
export function palisade(b, a, c, groundAt, { height = 3.3, skip = null } = {}) {
  const length = Math.hypot(c.x - a.x, c.z - a.z);
  const ux = (c.x - a.x) / length, uz = (c.z - a.z) / length;
  for (let along = 0; along <= length; along += 0.44) {
    if (skip && along > skip[0] && along < skip[1]) continue;
    const x = a.x + ux * along, z = a.z + uz * along, y = groundAt(x, z) - 0.3;
    const tall = height * b.range(0.9, 1.08);
    b.prop('timber', rod(P(x, y, z), P(x + b.range(-0.05, 0.05), y + tall, z + b.range(-0.05, 0.05)), 0.2, 0.17, 7), LOG);
    b.prop('timber', rod(P(x, y + tall, z), P(x, y + tall + 0.45, z), 0.17, 0.02, 7), PALE);
    b.nav.block(P(x, y, z), 0.45, height);
  }
  for (const [from, to] of skip ? [[0, skip[0]], [skip[1], length]] : [[0, length]]) {
    const p = (along) => P(a.x + ux * along - uz * 0.24, groundAt(a.x + ux * along, a.z + uz * along) + height * 0.62, a.z + uz * along + ux * 0.24);
    b.prop('timber', hewnBeam(p(from), p(to), 0.16, 0.2), DARK);
  }
}

/**
 * A watch gate in a palisade running along X: paired posts, a fighting platform
 * with a log parapet under its own roof, braces, and the leaves standing open.
 * `at` is the middle of the opening at ground level.
 */
export function watchGate(b, at, { width = 4.2, deck = 3.6 } = {}) {
  const L = (dx, dy, dz) => P(at.x + dx, at.y + dy, at.z + dz);
  const half = width / 2 + 0.3;
  for (const sx of [-1, 1]) {
    for (const dz of [-1.1, 1.1]) {
      b.prop('timber', hewnBeam(L(sx * half, -0.4, dz), L(sx * half, deck + 2.5, dz), 0.42, 0.42, { taper: 0.05 }), LOG);
      b.nav.block(L(sx * half, 0, dz), 0.55, 4);
    }
    b.prop('timber', hewnBeam(L(sx * half, deck - 0.2, -1.5), L(sx * half, deck - 0.2, 1.5), 0.3, 0.34), DARK);
    b.prop('timber', hewnBeam(L(sx * half, 1.9, 1.1), L(sx * (half - 1.5), deck - 0.4, 1.1), 0.2, 0.2), DARK);
    // The leaf swung inward against the post.
    b.prop('timber', panel(L(sx * half, 1.55, -1.3), L(sx * (half + 0.5), 1.55, -3.2), P(0, 1, 0), 3.1, 0.12), 0x6b5237);
  }
  for (const dz of [-1.1, 1.1]) b.prop('timber', hewnBeam(L(-half - 0.5, deck - 0.5, dz), L(half + 0.5, deck - 0.5, dz), 0.34, 0.38), DARK);
  b.prop('timber', panel(L(-half - 0.4, deck, 0), L(half + 0.4, deck, 0), P(0, 0, 1), 3, 0.14), 0x8a6d4a);
  logWall(b, L(-half - 0.4, deck + 0.07, 1.4), L(half + 0.4, deck + 0.07, 1.4), 1.1, { overrun: 0.2 });
  pitchedRoof(b, L(0, 0, 0), { length: width + 1.4, width: 2.6, eave: deck + 2.4, ridge: deck + 3.7, overhang: 0.7, icicles: true });
  eaveIcicles(b, L(-half, deck - 0.7, 1.1), L(half, deck - 0.7, 1.1), { length: 0.7 });
}

/**
 * A border beacon: a timber frame on a boulder footing carrying an iron fire
 * basket high enough to be seen down the valley, with the alarm bell under it.
 */
export function beacon(b, at, { height = 8 } = {}) {
  const L = (dx, dy, dz) => P(at.x + dx, at.y + dy, at.z + dz);
  b.prop('masonry', stoneBlock(3.4, 1.1, 3.4, at, { batter: 0.2, irregular: 0.6, bevel: 0.12 }), STONE);
  b.prop('masonry', stoneBlock(2.5, 0.7, 2.5, L(0, 1.1, 0), { batter: 0.16, irregular: 0.6, bevel: 0.1, yaw: 0.5 }), STONE);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.prop('timber', hewnBeam(L(sx * 1.25, 1.6, sz * 1.25), L(sx * 0.45, height, sz * 0.45), 0.3, 0.3, { taper: 0.1 }), LOG);
  }
  for (const y of [3.4, 5.6]) {
    const reach = 1.25 - (y - 1.6) / (height - 1.6) * 0.8;
    for (const [ax, az, cx, cz] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) {
      b.prop('timber', hewnBeam(L(ax * reach, y, az * reach), L(cx * reach, y, cz * reach), 0.16, 0.18), DARK);
    }
  }
  b.prop('timber', block(1.5, 0.16, 1.5, L(0, height, 0)), DARK);
  b.prop('iron', rod(L(0, height + 0.16, 0), L(0, height + 0.7, 0), 0.34, 0.62, 8), 0x5c6068);
  b.prop('glow', rod(L(0, height + 0.5, 0), L(0, height + 0.72, 0), 0.5, 0.42, 8), '#d2460f', 1.8);
  b.flame(L(0, height + 0.7, 0), { width: 1.2, height: 1.9, core: '#fff2bc', outer: '#ff520e' });
  b.light(L(0, height + 1.4, 0), '#ffb066', 12, 38, { radius: 2.4, halo: 4.5 });
  b.prop('iron', rod(L(0, height - 0.95, 0), L(0, height - 0.35, 0), 0.3, 0.08, 8), 0x7d7362);
  b.nav.block(at, 2.4, 4);
}

/**
 * The front of a hall built back into rock: a rubble plinth, a log gable with
 * its door and two shuttered windows, and the roof carried forward over a
 * porch so the door is never drifted shut. `at` is the middle of the doorway at
 * floor level; the hall lies behind it, toward -Z.
 */
export function gableFront(b, at, { width, wallHeight, roofRise, porch = 2.8, door = 2.3, footing = 1.6 }) {
  const L = (dx, dy, dz) => P(at.x + dx, at.y + dy, at.z + dz);
  const half = width / 2, sill = 1.1, ridge = wallHeight + roofRise;
  for (const [from, to] of [[-half, -door / 2], [door / 2, half]]) {
    b.prop('masonry', coursedWall(L(from, -footing, 0.12), L(to, -footing, 0.12), footing + sill, 0.55, { quoins: true }), STONE);
  }
  logWall(b, L(-half, sill, 0), L(half, sill, 0), wallHeight - sill, { gap: { from: half - door / 2, to: half + door / 2, height: 2.6 - sill } });
  for (let y = wallHeight + 0.1; y < ridge - 0.4; y += LOG_COURSE) {
    const reach = half * (1 - (y - wallHeight) / roofRise);
    b.prop('timber', rod(L(-reach, y, 0), L(reach, y, 0), LOG_RADIUS, LOG_RADIUS, 7), LOG);
  }
  pitchedRoof(b, L(0, 0, porch / 2 - 1), { length: porch + 2, width, eave: wallHeight, ridge, alongZ: true, icicles: true });
  for (const sx of [-1, 1]) {
    b.prop('timber', hewnBeam(L(sx * (half - 0.3), -footing, porch), L(sx * (half - 0.3), wallHeight - 0.1, porch), 0.34, 0.34, { taper: 0.05 }), LOG);
    b.prop('timber', hewnBeam(L(sx * (half - 0.3), wallHeight - 1.3, porch), L(sx * (half - 1.6), wallHeight - 0.15, porch), 0.18, 0.2), DARK);
    b.prop('timber', hewnBeam(L(sx * (door / 2 + 0.12), 0, 0.1), L(sx * (door / 2 + 0.12), 2.7, 0.1), 0.26, 0.3), DARK);
    b.nav.block(L(sx * (half - 0.3), 0, porch), 0.5, 3);
    // A shuttered window: the fire behind it, the shutters folded back against the logs.
    const x = sx * half * 0.58;
    b.prop('glow', box(0.8, 0.62, 0.1, L(x, 2.25, 0.16)), HEARTH, 2.2);
    b.prop('timber', box(1.04, 0.1, 0.2, L(x, 1.88, 0.2)), DARK);
    b.prop('timber', box(1.04, 0.1, 0.2, L(x, 2.62, 0.2)), DARK);
    b.prop('timber', box(0.06, 0.64, 0.14, L(x, 2.25, 0.22)), DARK);
    for (const side of [-1, 1]) b.prop('timber', box(0.42, 0.7, 0.05, L(x + side * 0.66, 2.25, 0.24)), 0x5d4631);
    b.light(L(x, 2.25, 1), HEARTH, 2.6, 10, { halo: 1.3 });
  }
  b.prop('timber', hewnBeam(L(-half + 0.2, wallHeight, porch), L(half - 0.2, wallHeight, porch), 0.3, 0.32), DARK);
  b.prop('timber', hewnBeam(L(-door / 2 - 0.4, 2.75, 0.1), L(door / 2 + 0.4, 2.75, 0.1), 0.3, 0.3), DARK);
  b.prop('timber', panel(L(door / 2 + 0.1, 1.3, 0.25), L(door / 2 + 0.55, 1.3, 1.35), P(0, 1, 0), 2.5, 0.1), 0x5d4631);
  lantern(b, L(-door / 2 - 0.9, 2.5, porch - 0.3), { intensity: 3.2, range: 11, halo: 1.2, hung: 0.6 });
  // Meltwater off the roof above a warm door.
  for (const sx of [-1, 1]) b.emit('drip', L(sx * (half + 0.85), wallHeight - 1, porch * 0.6));
}
