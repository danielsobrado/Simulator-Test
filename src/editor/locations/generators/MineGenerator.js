import { fbm3 } from '../gen/noise.js';
import { rod } from '../gen/propKit.js';
import { mound, shaft } from '../gen/shapes.js';
import { lantern, rails, timberSet } from './kits.js';
import {
  buildAditPortal,
  buildCollapsedHeading,
  buildFloodedLevel,
  buildOreCart,
  buildSortingStation,
  buildStopeWorkings,
} from './mineWorkingsDetail.js';

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
  buildAditPortal(b, drift);

  // Timber sets down the drift, lanterns on every third, plus stacked pit-props mid-drift.
  const sets = Math.floor(44 / drift.setSpacing);
  for (let index = 0; index <= sets; index += 1) {
    const t = index / sets;
    const at = P(0, adit.y + (haulEnd.y - adit.y) * t, adit.z - 1 + (haulEnd.z - adit.z + 2) * t);
    timberSet(b, at, 0, drift.width - 0.5, drift.height - 0.45);
    if (index % 3 === 1) lantern(b, P(at.x + (drift.width / 2 - 0.55) * (index % 2 ? 1 : -1), at.y + drift.height - 0.95, at.z + 0.3), { hung: 0.3 });
  }
  for (const dy of [0.1, 0.3]) {
    b.prop('timber', rod(P(1.15, -0.35 + dy, -13), P(1.15, -0.35 + dy, -15.4), 0.11, 0.1, 8), 0x765a3e);
  }
  rails(b, P(-0.9, 0, 5), P(-0.9, -1, -40));
  rails(b, P(-0.9, -1, -40), P(-2.5, -1, -52));

  // Loaded ore cart on the main haulage rails + task lantern illuminating the siding.
  buildOreCart(b, P(-0.9, -0.62, -27), { loaded: true, yaw: 0 });
  lantern(b, P(1.05, 1.35, -25.4), { intensity: 4.0, range: 13, hung: 0.25 });

  buildSortingStation(b, shaftAt, hub);
  buildStopeWorkings(b, stope);
  buildCollapsedHeading(b, eastTurn, fall);
  buildFloodedLevel(b, inclineTop, flooded, waterY);

  b.spawn('entry', P(0, 0, 3.5), 0);
  b.exit('adit', P(0, 0, 5.6), { label: 'Leave the workings' });
}
