import { beam, block, box, hewnBeam, rod, stoneBlock, stoneBox } from '../gen/propKit.js';
import { fbm3 } from '../gen/noise.js';
import { mound, shaft } from '../gen/shapes.js';
import { barrel, crate, lantern, rails, timberSet } from './kits.js';

/**
 * A working mine, laid out the way one is dug rather than the way a cave forms:
 * a level haulage drift driven in from the adit, a sorting chamber where the
 * shaft comes up, galleries following the ore out to a worked stope, an old
 * heading lost to a fall, and an incline down to a level the water has taken.
 */

export const bounds = { min: { x: -52, y: -20, z: -96 }, max: { x: 50, y: 14, z: 14 } };

const P = (x, y, z) => ({ x, y, z });

export function generate(b, params) {
  const drift = params.drift;
  const adit = P(0, 0, 6), haulEnd = P(0, -1, -40);
  const hub = P(0, -1, -50);
  const stope = P(-36, -3, -62);
  const shaftAt = P(7, -1, -54);
  const flooded = P(0, -9, -86);

  // Haulage drift and the sorting chamber.
  b.passage(adit, haulEnd, { width: drift.width, height: drift.height, arch: 0.3 });
  b.room(P(hub.x, 4, hub.z), { rx: 12, ry: 6.5, rz: 11, floorY: hub.y, smooth: 0.8 });
  b.grid.carve(shaft(shaftAt, { radius: 2.3, bottomY: -18, topY: 8 }));
  b.nav.block(shaftAt, 3.1, 3);

  // West: the ore gallery and the stope it feeds.
  const westTurn = P(-20, -2, -52);
  b.passage(P(-9, -1, -48), westTurn, { width: 2.8, height: 2.7, arch: 0.35 });
  b.passage(westTurn, P(-30, -3, -60), { width: 2.8, height: 2.7, arch: 0.35 });
  b.room(P(stope.x, 0.5, stope.z), { rx: 8, ry: 5, rz: 7, floorY: stope.y, smooth: 0.6 });

  // East: the old heading, lost to a fall.
  const eastTurn = P(26, 0.5, -38);
  const fall = P(38, 2, -24);
  b.passage(P(9, -1, -45), eastTurn, { width: 2.3, height: 2.4, arch: 0.45 });
  b.passage(eastTurn, fall, { width: 2.3, height: 2.4, arch: 0.45 });
  for (let index = 0; index < 5; index += 1) {
    b.grid.fill(mound(P(fall.x + b.range(-1.6, 1.6), fall.y + b.range(0, 1.6), fall.z + b.range(-1.2, 1.8)),
      b.range(1, 1.9), b.range(0.8, 1.5), b.range(1, 1.9)), 0.5);
  }
  b.nav.block(P(fall.x, fall.y, fall.z + 0.6), 2.2, 3);

  // Down: the incline to the drowned level.
  const inclineTop = P(0, -1, -59);
  b.passage(inclineTop, P(0, -9, -80), { width: 3, height: 3, arch: 0.35 });
  b.room(P(flooded.x, -5.5, flooded.z), { rx: 9, ry: 4.5, rz: 7, floorY: flooded.y, smooth: 0.6, walkRadius: 0 });
  b.nav.addDisc(P(0, -9, -81.5), 2.6);

  // Ore: where the seam shows, in the walls and in the heaps won from it.
  const deposits = [
    [stope.x - 6, 0, stope.z - 2, 7], [stope.x + 1, 1, stope.z - 6, 5], [-24, -1, -56, 4], [-3, 1, -22, 3.5],
    [4, 1.5, -47, 3], [30, 2, -34, 4], [3, -8, -90, 5],
  ];
  const heaps = [P(-33, -3, -59), P(-38, -3, -65), P(-4, -1, -55), P(3.5, -1, -44)];
  for (const heap of heaps) {
    b.grid.fill(mound(heap, b.range(1.1, 1.7), b.range(0.6, 0.9), b.range(1.1, 1.7)), 0.3);
    deposits.push([heap.x, heap.y + 0.4, heap.z, 2]);
    b.nav.block(heap, 1.3, 2);
  }

  b.grid.roughen({ amp: 0.3, scale: 0.42, seed: b.seed, octaves: 2 });
  b.grid.roughen({ amp: 0.1, scale: 1.7, seed: b.seed + 9, octaves: 2, floorAmp: 0.3 });

  const waterY = flooded.y + 0.45;
  b.classify = (p, n, mask) => {
    let ore = 0;
    for (const [x, y, z, radius] of deposits) {
      ore = Math.max(ore, 1 - Math.hypot(p.x - x, p.y - y, p.z - z) / radius);
    }
    mask[0] = Math.max(0, ore);
    // Water finds the low ground and seeps down the incline walls.
    const seep = fbm3(p.x * 0.2, p.y * 0.5, p.z * 0.2, b.seed + 31, 2);
    mask[1] = Math.min(1, Math.max(0, (-3.5 - p.y) / 4) + Math.max(0, seep - 0.62) * 3);
    mask[2] = 0;
    mask[3] = 0;
    return 0;
  };

  // --- Built works -------------------------------------------------------
  // Adit door: varied-width hand-hewn planks, heavy portal jambs & lintel, strap iron, daylight in the gaps.
  const plankCount = Math.max(6, Math.round(drift.width / 0.38));
  const plankW = (drift.width + 0.2) / plankCount;
  for (let i = 0; i < plankCount; i += 1) {
    const px = -drift.width / 2 - 0.1 + (i + 0.5) * plankW;
    b.prop('timber', stoneBox(plankW * 0.91, drift.height + 0.3, 0.18, P(px, (drift.height + 0.3) / 2, 7.22), {
      bevel: 0.02, irregular: 0.25, seed: 100 + i * 17,
    }), 0x5a442f);
  }
  for (const side of [-1, 1]) {
    const jx = side * (drift.width / 2 + 0.12);
    b.prop('timber', stoneBlock(0.36, 0.22, 0.42, P(jx, 0, 7.05), { bevel: 0.03, batter: 0.14, irregular: 0.25 }), 0x6a5038);
    b.prop('timber', hewnBeam(P(jx, 0.22, 7.05), P(jx, drift.height + 0.22, 7.05), 0.3, 0.28, { taper: 0.06, irregular: 0.25 }), 0x6a5038);
    b.prop('timber', hewnBeam(P(jx, drift.height - 0.55, 7.05), P(jx - side * 0.6, drift.height + 0.15, 7.05), 0.16, 0.16, { irregular: 0.2 }), 0x6a5038);
  }
  b.prop('timber', hewnBeam(P(-drift.width / 2 - 0.4, drift.height + 0.25, 7.05), P(drift.width / 2 + 0.4, drift.height + 0.25, 7.05), 0.34, 0.3, { irregular: 0.25 }), 0x6a5038);
  for (const x of [-0.9, 0, 0.9]) {
    b.prop('glow', box(0.05, drift.height * 0.72, 0.05, P(x, drift.height * 0.5, 7.02)), '#cfe2ff', 3);
  }
  b.prop('iron', stoneBox(drift.width + 0.1, 0.13, 0.26, P(0, 0.9, 7.12), { bevel: 0.015, irregular: 0.08 }), 0x2e2925);
  b.prop('iron', stoneBox(drift.width + 0.1, 0.13, 0.26, P(0, 2.2, 7.12), { bevel: 0.015, irregular: 0.08 }), 0x2e2925);
  b.light(P(0, 1.8, 5.6), '#bcd4ff', 1.4, 9, { flat: true });

  // Timber sets down the drift, lamps on every third.
  const sets = Math.floor(44 / drift.setSpacing);
  for (let index = 0; index <= sets; index += 1) {
    const t = index / sets;
    const at = P(0, adit.y + (haulEnd.y - adit.y) * t, adit.z - 1 + (haulEnd.z - adit.z + 2) * t);
    timberSet(b, at, 0, drift.width - 0.5, drift.height - 0.45);
    if (index % 3 === 1) lantern(b, P(at.x + (drift.width / 2 - 0.55) * (index % 2 ? 1 : -1), at.y + drift.height - 0.95, at.z + 0.3), { hung: 0.3 });
  }
  rails(b, P(-0.9, 0, 5), P(-0.9, -1, -40));
  rails(b, P(-0.9, -1, -40), P(-2.5, -1, -52));

  // An ore cart on the rails, built of beveled planks, timber ribs, iron straps and jagged ore chunks.
  const cart = P(-0.9, -0.62, -27);
  b.prop('timber', stoneBox(1.1, 0.68, 1.7, P(cart.x, cart.y + 0.55, cart.z), { bevel: 0.03, batter: -0.14, irregular: 0.12 }), 0x6a5038);
  for (const dz of [-0.65, 0, 0.65]) {
    b.prop('timber', stoneBox(1.22, 0.68, 0.11, P(cart.x, cart.y + 0.55, cart.z + dz), { bevel: 0.02, irregular: 0.15 }), 0x543e2b);
  }
  b.prop('iron', stoneBox(1.24, 0.09, 1.8, P(cart.x, cart.y + 0.9, cart.z), { bevel: 0.02, irregular: 0.06 }), 0x2e2925);
  for (const dz of [-0.55, 0.55]) {
    b.prop('iron', rod(P(cart.x - 0.52, cart.y + 0.18, cart.z + dz), P(cart.x + 0.52, cart.y + 0.18, cart.z + dz), 0.19, 0.19, 10), 0x2e2925);
  }
  for (const [ox, oy, oz, s] of [[0, 0.95, 0, 0.48], [-0.26, 0.9, 0.35, 0.34], [0.24, 0.92, -0.32, 0.36], [-0.18, 0.9, -0.38, 0.3], [0.2, 0.94, 0.32, 0.32]]) {
    b.prop('ore', stoneBox(s * 1.1, s * 0.8, s, P(cart.x + ox, cart.y + oy, cart.z + oz), {
      yaw: ox * 3 + oz, bevel: s * 0.22, irregular: 0.65,
    }), 0xb0a090);
  }
  b.nav.block(P(cart.x, -0.7, cart.z), 1, 2);

  // Sorting chamber: hand-hewn headframe with stone footing pads over the shaft, stores, sorting bench.
  const frameTop = 6.2;
  for (const [dx, dz] of [[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]]) {
    b.prop('iron', stoneBlock(0.65, 0.35, 0.65, P(shaftAt.x + dx, -1.05, shaftAt.z + dz), { bevel: 0.04, batter: 0.15, irregular: 0.25 }), 0x39332e);
    b.prop('timber', hewnBeam(P(shaftAt.x + dx, -0.8, shaftAt.z + dz), P(shaftAt.x + dx * 0.55, frameTop, shaftAt.z + dz * 0.55), 0.34, 0.34, { taper: 0.1, irregular: 0.25 }), 0x7d6044);
  }
  for (const [dx, dz] of [[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]]) {
    b.prop('timber', hewnBeam(P(shaftAt.x + dx * 0.8, 2.4, shaftAt.z + dz * 0.8), P(shaftAt.x - dx * 0.8, 2.4, shaftAt.z + dz * 0.8), 0.18, 0.18, { irregular: 0.2 }), 0x6a5038);
  }
  b.prop('timber', hewnBeam(P(shaftAt.x - 1.9, frameTop, shaftAt.z), P(shaftAt.x + 1.9, frameTop, shaftAt.z), 0.36, 0.34, { irregular: 0.2 }), 0x7d6044);
  b.prop('timber', hewnBeam(P(shaftAt.x, frameTop, shaftAt.z - 1.9), P(shaftAt.x, frameTop, shaftAt.z + 1.9), 0.36, 0.34, { irregular: 0.2 }), 0x7d6044);
  b.prop('iron', rod(P(shaftAt.x - 0.5, frameTop + 0.45, shaftAt.z), P(shaftAt.x + 0.5, frameTop + 0.45, shaftAt.z), 0.5, 0.5, 14), 0x39332e);
  b.prop('iron', rod(P(shaftAt.x, frameTop, shaftAt.z + 0.45), P(shaftAt.x, -12, shaftAt.z + 0.45), 0.025, 0.025, 5), 0x1f1c1a);
  b.prop('timber', stoneBox(1.6, 0.16, 1.6, P(shaftAt.x, -12, shaftAt.z + 0.45), { bevel: 0.02, irregular: 0.15 }), 0x6a5038);
  for (let index = 0; index < 10; index += 1) {
    const angle = index / 10 * Math.PI * 2, next = (index + 1) / 10 * Math.PI * 2;
    const at = (a, y) => P(shaftAt.x + Math.cos(a) * 2.75, y, shaftAt.z + Math.sin(a) * 2.75);
    b.prop('timber', hewnBeam(at(angle, -0.1), at(next, -0.1), 0.12, 0.1, { irregular: 0.2 }), 0x6a5038);
    b.prop('timber', hewnBeam(at(angle, -1), at(angle, 0.05), 0.12, 0.12, { irregular: 0.2 }), 0x6a5038);
  }
  lantern(b, P(shaftAt.x, frameTop - 0.9, shaftAt.z - 1.2), { intensity: 7, range: 17, hung: 0.6 });
  b.light(P(shaftAt.x, -15, shaftAt.z), '#ff9a4d', 3, 12, { halo: 2 });

  // Sorting bench with planked top, braced legs, and sorted ore chunks.
  b.prop('timber', stoneBox(3.2, 0.13, 1.3, P(-6, -0.1, -44.5), { yaw: 0.3, bevel: 0.025, irregular: 0.18 }), 0x7d6044);
  for (const [dx, dz] of [[-1.3, -0.4], [1.3, -0.4], [-1.3, 0.4], [1.3, 0.4]]) {
    b.prop('timber', hewnBeam(P(-6 + dx, -1, -44.5 + dz), P(-6 + dx, -0.12, -44.5 + dz), 0.14, 0.14, { irregular: 0.2 }), 0x7d6044);
  }
  for (const [ox, oz, s] of [[-0.7, 0.1, 0.26], [0.2, -0.15, 0.3], [0.9, 0.2, 0.22]]) {
    b.prop('ore', stoneBox(s, s * 0.75, s, P(-6 + ox, 0.05, -44.5 + oz), { yaw: ox * 2, bevel: s * 0.2, irregular: 0.6 }), 0xb0a090);
  }
  b.nav.block(P(-6, -1, -44.5), 1.7, 2);
  lantern(b, P(-6, 0.25, -44.5), { intensity: 3.5, range: 10, halo: 1.1 });
  const stores = [[-9.5, -55.5], [-8.6, -56.6], [-9.9, -57.2], [5.5, -42], [6.6, -41.6]];
  stores.forEach(([x, z], index) => {
    if (index % 2) barrel(b, P(x, -1, z)); else crate(b, P(x, -1, z), b.range(0.7, 1), b.range(0, 1));
    b.nav.block(P(x, -1, z), 0.6, 2);
  });
  crate(b, P(-8.9, -0.3, -56.2), 0.6, 0.5);
  lantern(b, P(-4, 3.6, -55), { intensity: 6, range: 16, hung: 1.2 });

  // Stope: wedged hand-hewn stulls with headboard/footblock pads, a lamp at the face.
  for (let index = 0; index < 4; index += 1) {
    const x = stope.x + b.range(-5, 4), z = stope.z + b.range(-4, 4);
    const top = b.probe(x, stope.y + 1, z, 1, 9) ?? stope.y + 3;
    const tx = x + b.range(-0.3, 0.3);
    b.prop('timber', stoneBlock(0.45, 0.14, 0.45, P(x, stope.y, z), { bevel: 0.03, batter: 0.15, irregular: 0.3 }), 0x6a5038);
    b.prop('timber', hewnBeam(P(x, stope.y + 0.1, z), P(tx, top + 0.15, z), 0.32, 0.32, { taper: 0.08, irregular: 0.32 }), 0x7d6044);
    b.prop('timber', stoneBox(0.55, 0.12, 0.45, P(tx, top + 0.1, z), { bevel: 0.025, irregular: 0.25 }), 0x6a5038);
    b.nav.block(P(x, stope.y, z), 0.35, 3);
  }
  lantern(b, P(stope.x + 1.5, stope.y + 1.1, stope.z + 1), { intensity: 6, range: 14 });
  b.prop('timber', stoneBlock(0.38, 1.1, 0.38, P(stope.x + 1.5, stope.y, stope.z + 1), { bevel: 0.03, batter: 0.1, irregular: 0.25 }), 0x6a5038);
  timberSet(b, P(-14, -1.5, -50), Math.PI / 2 - 0.32, 2.3, 2.2);
  timberSet(b, P(-25, -2.5, -56), Math.PI / 2 - 0.65, 2.3, 2.2);
  lantern(b, P(-20, 0.1, -51.6), { intensity: 3.5, range: 11, hung: 0.25 });

  // Old heading: boarded off before the fall with irregular planks, one guttering lamp.
  for (const [y, tilt] of [[0.7, 0.08], [1.35, -0.06], [1.9, 0.12]]) {
    b.prop('timber', hewnBeam(P(fall.x - 3.2, fall.y + y - 0.4 + tilt, fall.z - 3.6), P(fall.x - 1.4, fall.y + y - 0.2 - tilt, fall.z - 5.2), 0.19, 0.07, { irregular: 0.3 }), 0x5a442f);
  }
  timberSet(b, P(20, -0.1, -40.3), Math.PI / 2 + 0.4, 1.9, 2);
  lantern(b, P(27, 2.3, -37.6), { intensity: 2.2, range: 9, hung: 0.2, tint: '#ff9c4a' });

  // Incline and the drowned level.
  timberSet(b, P(0, -3.2, -65), 0, 2.5, 2.5);
  timberSet(b, P(0, -6.2, -73), 0, 2.5, 2.5);
  lantern(b, P(1, -4.6, -70), { intensity: 3, range: 11, hung: 0.3 });
  b.prop('water', box(22, 0.05, 18, P(flooded.x, waterY, flooded.z)), 0xffffff);
  lantern(b, P(-1.2, -7.4, -81), { intensity: 4, range: 13 });
  b.prop('timber', stoneBlock(0.34, 1.5, 0.34, P(-1.2, -9, -81), { bevel: 0.03, batter: 0.08, irregular: 0.25 }), 0x5a442f);
  b.prop('timber', hewnBeam(P(-3, waterY + 0.1, -84), P(-3.6, waterY + 0.4, -88), 0.3, 0.3, { irregular: 0.3 }), 0x4a3828);

  // A lamp left burning on the far side shows how far the water goes.
  lantern(b, P(4.5, -7.6, -90), { intensity: 3.5, range: 15, halo: 1.2 });
  b.spawn('entry', P(0, 0, 3.5), 0);
  b.exit('adit', P(0, 0, 5.6), { label: 'Leave the workings' });
}
