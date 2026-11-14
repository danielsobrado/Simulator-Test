import { box, hewnBeam, rod, roughTimber, stoneBlock, stoneBox } from '../gen/propKit.js';
import { barrel, crate, lantern, rails, timberSet } from './kits.js';

const P = (x, y, z) => ({ x, y, z });

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerpP = (a, c, t) => P(a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t, a.z + (c.z - a.z) * t);

function probeWallDistance(b, origin, dx, dz, maxReach) {
  const step = Math.max(0.12, b.grid.voxel * 0.4);
  let minWall = maxReach;
  for (const h of [1.25, 2.0]) {
    const y = origin.y + h;
    for (let d = 0.4; d <= maxReach; d += step) {
      if (b.grid.sample(origin.x + dx * d, y, origin.z + dz * d) < 0) {
        if (d < minWall) minWall = d;
        break;
      }
    }
  }
  return minWall;
}

/**
 * Places a `timberSet` aligned to the actual excavated rock walls and ceiling at `at`,
 * preserving required rail/walker clearance while preventing floating or buried frames.
 */
export function fitTimberSet(b, at, yaw, {
  width,
  height,
  minLeft = width * 0.44,
  minRight = width * 0.44,
  maxLeft = width * 0.5 + 0.55,
  maxRight = width * 0.5 + 0.55,
  minHeight = Math.max(2.05, height - 0.35),
  maxHeight = height + 0.85,
  postInset = 0.22,
  capInset = 0.34,
} = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const wallLeft = probeWallDistance(b, at, -c, s, maxLeft + 0.6);
  const wallRight = probeWallDistance(b, at, c, -s, maxRight + 0.6);

  const leftSpan = clamp(wallLeft - postInset, minLeft, maxLeft);
  const rightSpan = clamp(wallRight - postInset, minRight, maxRight);
  const shift = (rightSpan - leftSpan) * 0.5;
  const shiftedAt = P(at.x + c * shift, at.y, at.z - s * shift);
  const spanWidth = leftSpan + rightSpan;

  let minRoofY = at.y + maxHeight + capInset;
  for (const frac of [-0.62, 0, 0.62]) {
    const offset = frac < 0 ? frac * leftSpan : frac * rightSpan;
    const hitY = b.probe(shiftedAt.x + c * offset, at.y + 1.1, shiftedAt.z - s * offset, 1, maxHeight + 1.8);
    if (hitY !== null && hitY < minRoofY) minRoofY = hitY;
  }
  const capHeight = clamp(minRoofY - at.y - capInset, minHeight, maxHeight);
  timberSet(b, shiftedAt, yaw, spanWidth, capHeight);
  return { at: shiftedAt, leftSpan, rightSpan, width: spanWidth, height: capHeight };
}

/** Builds a miner's pickaxe or heavy sledge leaning against a support or rock wall. */
function buildMiningTool(b, foot, tip, { head = 'pick', yaw = 0 } = {}) {
  b.prop('timber', roughTimber(foot, tip, 0.055, 0.055, { bow: 0.015, irregular: 0.25 }), 0x72563c);
  if (head === 'pick') {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    b.prop('iron', hewnBeam(
      P(tip.x - c * 0.28, tip.y - 0.03, tip.z + s * 0.28),
      P(tip.x + c * 0.28, tip.y - 0.03, tip.z - s * 0.28),
      0.06, 0.025, { bevel: 0.01 },
    ), 0x767b86);
  } else {
    b.prop('iron', stoneBox(0.26, 0.13, 0.13, P(tip.x, tip.y - 0.03, tip.z), { yaw, bevel: 0.02 }), 0x727782);
  }
}

/** Heavy planked timber adit door framed with iron strap hinges and exterior daylight slivers. */
export function buildAditPortal(b, drift) {
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
    const jTopX = side * (drift.width / 2 - 0.14);
    b.prop('timber', stoneBlock(0.38, 0.22, 0.42, P(jx, 0, 7.05), { bevel: 0.04, batter: 0.16, irregular: 0.4 }), 0x6a5038);
    b.prop('timber', roughTimber(P(jx, 0.22, 7.05), P(jTopX, drift.height + 0.34, 7.05), 0.3, 0.28, { taper: 0.08, bow: 0.02, irregular: 0.36 }), 0x6a5038);
    b.prop('timber', roughTimber(P((jx + jTopX) * 0.5, drift.height - 0.55, 7.05), P(jTopX - side * 0.55, drift.height + 0.3, 7.05), 0.16, 0.16, { bow: 0.02, irregular: 0.38 }), 0x6a5038);
  }
  b.prop('timber', roughTimber(P(-drift.width / 2 - 0.55, drift.height + 0.25, 7.05), P(drift.width / 2 + 0.55, drift.height + 0.25, 7.05), 0.34, 0.3, { bow: 0.025, irregular: 0.36 }), 0x6a5038);
  for (const x of [-0.9, 0, 0.9]) {
    b.prop('glow', box(0.05, drift.height * 0.72, 0.05, P(x, drift.height * 0.5, 7.02)), '#cfe2ff', 2.4);
  }
  b.prop('iron', stoneBox(drift.width + 0.1, 0.13, 0.26, P(0, 0.9, 7.12), { bevel: 0.015, irregular: 0.08 }), 0x707580);
  b.prop('iron', stoneBox(drift.width + 0.1, 0.13, 0.26, P(0, 2.2, 7.12), { bevel: 0.015, irregular: 0.08 }), 0x707580);
  b.light(P(0, 1.8, 5.6), '#bcd4ff', 1.4, 9, { flat: true });

  // Threshold supply rack right inside the drift entry.
  crate(b, P(1.22, -0.05, 4.1), 0.65, -0.2);
  buildMiningTool(b, P(1.38, -0.05, 3.35), P(1.58, 1.05, 3.55), { head: 'pick', yaw: 0.4 });
  b.nav.block(P(1.25, 0, 3.8), 0.6, 2);
}

/** Detailed rail ore cart with flanged steel wheels, axle hubs, corner straps, and jagged ore chunks. */
export function buildOreCart(b, at, { loaded = true, yaw = 0 } = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const local = (lx, ly, lz) => P(at.x + c * lx + s * lz, at.y + ly, at.z - s * lx + c * lz);

  b.prop('timber', stoneBox(1.1, 0.68, 1.7, local(0, 0.55, 0), { yaw, bevel: 0.03, batter: -0.14, irregular: 0.12 }), 0x6a5038);
  for (const dz of [-0.65, 0, 0.65]) {
    b.prop('timber', stoneBox(1.22, 0.68, 0.11, local(0, 0.55, dz), { yaw, bevel: 0.02, irregular: 0.15 }), 0x543e2b);
  }
  b.prop('iron', stoneBox(1.24, 0.09, 1.8, local(0, 0.9, 0), { yaw, bevel: 0.02, irregular: 0.06 }), 0x727780);
  b.prop('iron', stoneBox(1.18, 0.08, 1.86, local(0, 0.24, 0), { yaw, bevel: 0.015 }), 0x666b74);
  for (const dz of [-0.55, 0.55]) {
    b.prop('iron', rod(local(-0.56, 0.18, dz), local(0.56, 0.18, dz), 0.06, 0.06, 8), 0x6c717a);
    for (const sx of [-0.45, 0.45]) {
      b.prop('iron', rod(local(sx - 0.05, 0.18, dz), local(sx + 0.05, 0.18, dz), 0.19, 0.19, 10), 0x787d88);
    }
  }
  if (loaded) {
    for (const [ox, oy, oz, sc] of [[0, 0.95, 0, 0.48], [-0.26, 0.9, 0.35, 0.34], [0.24, 0.92, -0.32, 0.36], [-0.18, 0.9, -0.38, 0.3], [0.2, 0.94, 0.32, 0.32]]) {
      b.prop('ore', stoneBox(sc * 1.1, sc * 0.8, sc, local(ox, oy, oz), {
        yaw: yaw + ox * 3 + oz, bevel: sc * 0.22, irregular: 0.65,
      }), 0xc4aa8a);
    }
  }
  b.nav.block(at, 1.0, 2);
}

/** Sorting hub: headframe + skip cage + windlass winch, gallery portals, sorting bench & vault fill. */
export function buildSortingStation(b, shaftAt, hub) {
  const frameTop = 6.2;
  for (const [dx, dz] of [[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]]) {
    b.prop('iron', stoneBlock(0.65, 0.35, 0.65, P(shaftAt.x + dx, -1.05, shaftAt.z + dz), { bevel: 0.04, batter: 0.15, irregular: 0.25 }), 0x6e737c);
    b.prop('timber', roughTimber(P(shaftAt.x + dx, -0.8, shaftAt.z + dz), P(shaftAt.x + dx * 0.55, frameTop, shaftAt.z + dz * 0.55), 0.34, 0.34, { taper: 0.12, bow: 0.022, irregular: 0.38 }), 0x7d6044);
  }
  for (const [dx, dz] of [[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]]) {
    b.prop('timber', roughTimber(P(shaftAt.x + dx * 0.8, 2.4, shaftAt.z + dz * 0.8), P(shaftAt.x - dx * 0.8, 2.4, shaftAt.z + dz * 0.8), 0.18, 0.18, { bow: 0.02, irregular: 0.35 }), 0x6a5038);
  }
  b.prop('timber', roughTimber(P(shaftAt.x - 1.9, frameTop, shaftAt.z), P(shaftAt.x + 1.9, frameTop, shaftAt.z), 0.36, 0.34, { bow: 0.025, irregular: 0.34 }), 0x7d6044);
  b.prop('timber', roughTimber(P(shaftAt.x, frameTop, shaftAt.z - 1.9), P(shaftAt.x, frameTop, shaftAt.z + 1.9), 0.36, 0.34, { bow: 0.025, irregular: 0.34 }), 0x7d6044);
  b.prop('iron', rod(P(shaftAt.x - 0.5, frameTop + 0.45, shaftAt.z), P(shaftAt.x + 0.5, frameTop + 0.45, shaftAt.z), 0.5, 0.5, 14), 0x767b86);
  b.prop('iron', rod(P(shaftAt.x, frameTop, shaftAt.z + 0.45), P(shaftAt.x, -12, shaftAt.z + 0.45), 0.032, 0.032, 5), 0x5c6068);
  // Suspended iron-strapped ore skip hovering near collar + manual hoist windlass drum beside shaft.
  b.prop('timber', stoneBox(1.5, 0.85, 1.5, P(shaftAt.x, -0.55, shaftAt.z + 0.45), { bevel: 0.03, irregular: 0.15 }), 0x6a5038);
  b.prop('iron', stoneBox(1.56, 0.1, 1.56, P(shaftAt.x, -0.18, shaftAt.z + 0.45), { bevel: 0.015 }), 0x707580);
  b.prop('ore', stoneBox(0.9, 0.45, 0.85, P(shaftAt.x, -0.05, shaftAt.z + 0.45), { bevel: 0.16, irregular: 0.5 }), 0xc4aa8a);
  b.prop('timber', stoneBox(1.6, 0.16, 1.6, P(shaftAt.x, -12, shaftAt.z + 0.45), { bevel: 0.02, irregular: 0.15 }), 0x6a5038);

  // Manual hoist windlass winch anchored on the sorting floor beside the collar.
  const wx = shaftAt.x - 3.6, wz = shaftAt.z + 1.0;
  for (const dz of [-0.65, 0.65]) {
    b.prop('timber', stoneBlock(0.32, 1.15, 0.24, P(wx, -1.0, wz + dz), { bevel: 0.02 }), 0x6a5038);
  }
  b.prop('timber', rod(P(wx, 0.05, wz - 0.68), P(wx, 0.05, wz + 0.68), 0.24, 0.24, 10), 0x7d6044);
  b.prop('iron', rod(P(wx, 0.05, wz - 0.9), P(wx, 0.05, wz + 0.9), 0.08, 0.08, 8), 0x727780);
  b.prop('iron', hewnBeam(P(wx, 0.05, wz), P(shaftAt.x - 1.2, frameTop - 0.2, shaftAt.z + 0.4), 0.03, 0.03), 0x626670);
  b.nav.block(P(wx, -1, wz), 0.9, 2);

  for (let index = 0; index < 10; index += 1) {
    const angle = index / 10 * Math.PI * 2, next = (index + 1) / 10 * Math.PI * 2;
    const at = (a, y) => P(shaftAt.x + Math.cos(a) * 2.75, y, shaftAt.z + Math.sin(a) * 2.75);
    b.prop('timber', roughTimber(at(angle, -0.1), at(next, -0.1), 0.12, 0.1, { bow: 0.015, irregular: 0.36 }), 0x6a5038);
    b.prop('timber', roughTimber(at(angle, -1), at(angle, 0.05), 0.12, 0.12, { irregular: 0.36 }), 0x6a5038);
  }
  lantern(b, P(shaftAt.x, frameTop - 0.9, shaftAt.z - 1.2), { intensity: 7, range: 19, hung: 0.6 });
  b.light(P(shaftAt.x, -15, shaftAt.z), '#ff9a4d', 3, 12, { halo: 1.5 });

  // Framed timber portal sets marking each gallery branching off the sorting hub.
  fitTimberSet(b, P(-8.8, -1, -48), Math.PI / 2 - 0.2, { width: 2.7, height: 2.55, minLeft: 1.15, minRight: 1.15 });
  lantern(b, P(-8.8, 1.35, -46.8), { intensity: 3.4, range: 12, hung: 0.2 });
  fitTimberSet(b, P(7.5, -1, -45.5), Math.PI / 2 + 0.35, { width: 2.25, height: 2.25, minLeft: 1.0, minRight: 1.0 });
  lantern(b, P(7.5, 1.05, -44.4), { intensity: 3.0, range: 11, hung: 0.2 });
  fitTimberSet(b, P(0, -1, -58.5), 0, { width: 2.85, height: 2.6, minLeft: 1.25, minRight: 1.25 });

  // Rail terminus timber bumper block + parked empty secondary ore tub near sorting switch.
  b.prop('timber', stoneBox(1.5, 0.42, 0.35, P(-2.6, -0.82, -52.2), { yaw: -0.2, bevel: 0.03 }), 0x6a5038);
  buildOreCart(b, P(-1.8, -1.0, -47.2), { loaded: false, yaw: -0.14 });
  lantern(b, P(-1.1, 1.45, -45.5), { intensity: 3.8, range: 13, hung: 0.35 });

  // Sorting bench with planked top, braced legs, ore specimens & tool rack.
  b.prop('timber', stoneBox(3.2, 0.13, 1.3, P(-6, -0.1, -44.5), { yaw: 0.3, bevel: 0.025, irregular: 0.18 }), 0x7d6044);
  for (const [dx, dz] of [[-1.3, -0.4], [1.3, -0.4], [-1.3, 0.4], [1.3, 0.4]]) {
    b.prop('timber', roughTimber(P(-6 + dx, -1, -44.5 + dz), P(-6 + dx, -0.12, -44.5 + dz), 0.14, 0.14, { bow: 0.015, irregular: 0.32 }), 0x7d6044);
  }
  for (const [ox, oz, sc] of [[-0.7, 0.1, 0.26], [0.2, -0.15, 0.3], [0.9, 0.2, 0.22]]) {
    b.prop('ore', stoneBox(sc, sc * 0.75, sc, P(-6 + ox, 0.05, -44.5 + oz), { yaw: ox * 2, bevel: sc * 0.2, irregular: 0.6 }), 0xc4aa8a);
  }
  buildMiningTool(b, P(-7.5, -1, -43.7), P(-7.0, 0.22, -44.0), { head: 'sledge', yaw: 0.3 });
  b.nav.block(P(-6, -1, -44.5), 1.7, 2);
  lantern(b, P(-6, 0.25, -44.5), { intensity: 4.2, range: 13, halo: 0.95 });

  // Stacked timber pit-props & stores.
  for (const [dy, dz] of [[0.14, 0], [0.14, 0.28], [0.36, 0.14]]) {
    b.prop('timber', rod(P(2.6, -1 + dy, -57.5 + dz), P(5.2, -1 + dy, -57.5 + dz), 0.12, 0.11, 8), 0x785c40);
  }
  b.nav.block(P(3.9, -1, -57.4), 1.4, 2);
  const stores = [[-9.5, -55.5], [-8.6, -56.6], [-9.9, -57.2], [5.5, -42], [6.6, -41.6]];
  stores.forEach(([x, z], index) => {
    if (index % 2) barrel(b, P(x, -1, z)); else crate(b, P(x, -1, z), b.range(0.7, 1), b.range(0, 1));
    b.nav.block(P(x, -1, z), 0.6, 2);
  });
  crate(b, P(-8.9, -0.3, -56.2), 0.6, 0.5);
  lantern(b, P(-4, 3.6, -55), { intensity: 6.5, range: 18, hung: 1.2 });
  // Soft warm sorting-dome ceiling bounce so the vaulted chamber & hoist read cleanly.
  b.light(P(hub.x, 5.2, hub.z + 1.5), '#d8bfa4', 1.85, 22, { flat: true });
}

/** Active West stope: wedged stulls, lagging stacks, ore crib, mining tools, and seam lighting. */
export function buildStopeWorkings(b, stope) {
  for (let index = 0; index < 4; index += 1) {
    const x = stope.x + b.range(-5, 4), z = stope.z + b.range(-4, 4);
    const top = b.probe(x, stope.y + 1, z, 1, 9) ?? stope.y + 3;
    const tx = x + b.range(-0.3, 0.3);
    b.prop('timber', stoneBlock(0.45, 0.14, 0.45, P(x, stope.y, z), { bevel: 0.03, batter: 0.15, irregular: 0.3 }), 0x6a5038);
    b.prop('timber', roughTimber(P(x, stope.y + 0.1, z), P(tx, top + 0.15, z), 0.32, 0.32, { taper: 0.1, bow: 0.025, irregular: 0.42 }), 0x7d6044);
    b.prop('timber', stoneBox(0.55, 0.12, 0.45, P(tx, top + 0.1, z), { bevel: 0.025, irregular: 0.25 }), 0x6a5038);
    b.nav.block(P(x, stope.y, z), 0.35, 3);
  }
  // Working ore crib & blasting crates beside active pyrite seam face.
  const crib = P(stope.x - 1.8, stope.y, stope.z - 2.6);
  b.prop('timber', stoneBox(1.8, 0.72, 1.3, P(crib.x, crib.y + 0.36, crib.z), { yaw: 0.25, bevel: 0.03 }), 0x6a5038);
  b.prop('ore', stoneBox(1.3, 0.45, 0.85, P(crib.x, crib.y + 0.72, crib.z), { yaw: 0.25, bevel: 0.16, irregular: 0.55 }), 0xc4aa8a);
  buildMiningTool(b, P(crib.x + 1.15, stope.y, crib.z + 0.3), P(crib.x + 0.75, stope.y + 1.15, crib.z + 0.15), { head: 'pick', yaw: 0.3 });
  crate(b, P(stope.x + 2.8, stope.y, stope.z - 1.8), 0.72, 0.4);
  b.nav.block(crib, 1.1, 2);

  lantern(b, P(stope.x + 1.5, stope.y + 1.1, stope.z + 1), { intensity: 6.5, range: 16 });
  b.prop('timber', stoneBlock(0.38, 1.1, 0.38, P(stope.x + 1.5, stope.y, stope.z + 1), { bevel: 0.03, batter: 0.1, irregular: 0.25 }), 0x6a5038);
  b.light(P(stope.x - 2.2, stope.y + 3.2, stope.z), '#ffd29e', 2.4, 15, { flat: true });
  fitTimberSet(b, P(-14, -1.5, -50), Math.PI / 2 - 0.32, { width: 2.3, height: 2.2, minLeft: 1.05, minRight: 1.05 });
  fitTimberSet(b, P(-25, -2.5, -56), Math.PI / 2 - 0.65, { width: 2.3, height: 2.2, minLeft: 1.05, minRight: 1.05 });
  lantern(b, P(-20, 0.1, -51.6), { intensity: 3.8, range: 13, hung: 0.25 });
}

/** East heading collapse: timber barricade, snapped beam, fallen slate boulders, and warning lamp. */
export function buildCollapsedHeading(b, eastTurn, fall) {
  const yawToFall = Math.atan2(-(fall.z - eastTurn.z), fall.x - eastTurn.x);
  const barrier = lerpP(eastTurn, fall, 0.68);
  fitTimberSet(b, P(20, -0.1, -40.3), Math.PI / 2 + 0.4, { width: 1.9, height: 2, minLeft: 0.9, minRight: 0.9 });
  fitTimberSet(b, barrier, yawToFall + Math.PI / 2, { width: 2.05, height: 2.1, minLeft: 0.95, minRight: 0.95 });

  // Diagonal timber X-barricade slats nailed across the drift frame.
  const rx = -Math.sin(yawToFall), rz = Math.cos(yawToFall);
  for (const [y0, y1] of [[0.55, 1.65], [1.65, 0.55], [1.1, 1.1]]) {
    b.prop('timber', roughTimber(
      P(barrier.x - rx * 0.95, barrier.y + y0, barrier.z - rz * 0.95),
      P(barrier.x + rx * 0.95, barrier.y + y1, barrier.z + rz * 0.95),
      0.16, 0.09, { bow: 0.02, irregular: 0.42 },
    ), 0x6a5038);
  }
  // Snapped beam protruding from jagged fallen slate boulders past the barricade.
  const spill = lerpP(eastTurn, fall, 0.8);
  b.prop('timber', roughTimber(
    P(spill.x - 0.6, spill.y + 1.4, spill.z - 0.4),
    P(spill.x + 1.3, spill.y + 0.2, spill.z + 0.8),
    0.26, 0.24, { bow: 0.03, irregular: 0.48 },
  ), 0x5c442f);
  for (const [dx, dy, dz, sx, sy, sz] of [
    [-0.4, 0.35, -0.2, 0.95, 0.7, 0.85], [0.35, 0.3, 0.25, 0.8, 0.55, 0.9], [-0.1, 0.75, 0.4, 0.75, 0.55, 0.7],
  ]) {
    b.prop('ore', stoneBox(sx, sy, sz, P(spill.x + dx, spill.y + dy, spill.z + dz), {
      yaw: dx * 3, bevel: 0.14, irregular: 0.55,
    }), 0x867e76);
  }
  lantern(b, P(27, 2.3, -37.6), { intensity: 3.4, range: 13, hung: 0.2, tint: '#ff9c4a' });
  lantern(b, P(barrier.x - rx * 0.72, barrier.y + 1.75, barrier.z - rz * 0.72), { intensity: 3.8, range: 13, tint: '#ff9640' });
}

/** Drowned lower level: submerged rails, walkable duckboard pier, floating timbers & pool lighting. */
export function buildFloodedLevel(b, inclineTop, flooded, waterY) {
  fitTimberSet(b, P(0, -3.2, -65), 0, { width: 2.5, height: 2.5, minLeft: 1.15, minRight: 1.15 });
  fitTimberSet(b, P(0, -6.2, -73), 0, { width: 2.5, height: 2.5, minLeft: 1.15, minRight: 1.15 });
  lantern(b, P(1, -4.6, -70), { intensity: 3.6, range: 13, hung: 0.3 });
  rails(b, inclineTop, P(0, -9.2, -83), 0.9);

  // Walkable wooden duckboard pier jutting cleanly to the edge of the flooded cavern lake.
  const pierY = waterY + 0.18;
  for (const pz of [-80.5, -81.8, -83.1]) {
    for (const px of [-0.95, 0.95]) {
      b.prop('timber', stoneBlock(0.24, 0.9, 0.24, P(px, pierY - 0.85, pz), { bevel: 0.02 }), 0x543e2b);
    }
    b.prop('timber', stoneBox(2.25, 0.1, 1.24, P(0, pierY, pz), { bevel: 0.02, irregular: 0.2 }), 0x664e36);
  }
  b.nav.addSegment(P(0, pierY + 0.05, -79.8), P(0, pierY + 0.05, -83.5), 1.8);

  b.prop('water', box(26, 0.05, 22, P(flooded.x, waterY, flooded.z)), 0xffffff);
  lantern(b, P(-1.2, -7.4, -81), { intensity: 4.5, range: 15 });
  b.prop('timber', stoneBlock(0.34, 1.5, 0.34, P(-1.2, -9, -81), { bevel: 0.03, batter: 0.08, irregular: 0.25 }), 0x5a442f);
  b.prop('timber', roughTimber(P(-3, waterY + 0.1, -84), P(-3.6, waterY + 0.4, -88), 0.3, 0.3, { taper: 0.1, bow: 0.025, irregular: 0.45 }), 0x4a3828);
  b.prop('timber', roughTimber(P(1.8, waterY + 0.05, -86.5), P(3.4, waterY + 0.08, -85.2), 0.24, 0.22, { bow: 0.02, irregular: 0.4 }), 0x523c28);

  // Far-side & rocky left-bank lamps plus cavern vault bounce across the drowned pool.
  lantern(b, P(4.5, -7.6, -90), { intensity: 4.2, range: 17, halo: 1.0 });
  lantern(b, P(-5.4, -7.2, -85), { intensity: 3.0, range: 12, halo: 0.85 });
  b.prop('timber', stoneBlock(0.32, 1.35, 0.32, P(-5.4, -8.55, -85), { bevel: 0.03, batter: 0.08, irregular: 0.25 }), 0x5a442f);
  b.light(P(0, waterY + 2.8, -85), '#9eb4c4', 1.4, 18, { flat: true });
}
