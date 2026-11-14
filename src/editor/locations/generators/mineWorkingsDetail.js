import { box, hewnBeam, rod, roughTimber, stoneBlock, stoneBox } from '../gen/propKit.js';
import {
  TimberGeometryCache,
  createTimberBeam,
  createTimberBoard,
  createTimberWedge,
} from '../gen/timberGeometry.js';
import { buildMineTunnelSupports, buildStandaloneTimberSet } from '../gen/timberSupportBuilder.js';
import { barrel, crate, lantern, rails } from './kits.js';
import {
  hangLanternOnFrame,
  placeAditDaylightTransition,
  resolveMineLightingSections,
} from './mineLightingLayout.js';

const P = (x, y, z) => ({ x, y, z });
const UP_DIR = P(0, 1, 0);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerpP = (a, c, t) => P(a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t, a.z + (c.z - a.z) * t);

function buildGroundedLanternPost(b, x, z, {
  probeStartY,
  fallbackFloorY,
  topY,
  width = 0.34,
  postTint = 0x5a442f,
  navBlock = true,
  ...lanternOptions
}) {
  const floorY = b.probe(x, probeStartY, z, -1, 3.8) ?? fallbackFloorY;
  const baseY = floorY - 0.12;
  const height = Math.max(0.5, topY - baseY);
  b.prop('timber', stoneBlock(width, height, width, P(x, baseY, z), {
    bevel: 0.03,
    batter: 0.08,
    irregular: 0.24,
  }), postTint);
  if (navBlock) b.nav.block(P(x, floorY, z), width * 0.95, height + 0.5);
  lantern(b, P(x, topY + 0.215, z), lanternOptions);
}

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
  buildStandaloneTimberSet(b, shiftedAt, yaw, spanWidth, capHeight, {
    archetype: 'standard',
    condition: 'maintained',
    jointStyle: 'housed',
    fitToRock: false,
  });
  return {
    at: shiftedAt,
    leftSpan,
    rightSpan,
    width: spanWidth,
    height: capHeight,
    leftFoot: P(shiftedAt.x - c * leftSpan, at.y, shiftedAt.z + s * leftSpan),
    rightFoot: P(shiftedAt.x + c * rightSpan, at.y, shiftedAt.z - s * rightSpan),
  };
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
export function buildAditPortal(b, drift, lightingSections = resolveMineLightingSections()) {
  const plankCount = Math.max(6, Math.round(drift.width / 0.38));
  const plankW = (drift.width + 0.2) / plankCount;
  for (let i = 0; i < plankCount; i += 1) {
    const px = -drift.width / 2 - 0.1 + (i + 0.5) * plankW;
    b.prop('timber', createTimberBoard(
      P(px, 0, 7.22),
      P(px, drift.height + 0.3, 7.22),
      P(1, 0, 0),
      plankW * 0.92,
      0.16,
      { irregular: 0.2, damp: 0.32, wear: 0.55, seed: 100 + i * 17 },
    ), 0x5a442f);
  }
  for (const side of [-1, 1]) {
    const jx = side * (drift.width / 2 + 0.12);
    const jTopX = side * (drift.width / 2 - 0.14);
    b.prop('timber', createTimberBeam(P(jx, -0.02, 6.84), P(jx, -0.02, 7.26), 0.34, 0.14, {
      sideHint: P(1, 0, 0), bevelRatio: 0.16, irregular: 0.25, bow: 0.002, dampStart: 0.6, dampEnd: 0.6, wear: 0.55, seed: 210 + side,
    }), 0x6a5038);
    b.prop('timber', createTimberBeam(P(jx, 0.1, 7.05), P(jTopX, drift.height + 0.3, 7.05), 0.24, 0.24, {
      sideHint: P(1, 0, 0), bevelRatio: 0.15, irregular: 0.24, bow: 0.008, taper: 0.06, dampStart: 0.45, dampEnd: 0.2, wear: 0.5, seed: 250 + side,
    }), 0x6a5038);
    b.prop('timber', createTimberBeam(
      P((jx + jTopX) * 0.5, drift.height - 0.55, 7.05),
      P(jTopX - side * 0.55, drift.height + 0.26, 7.05),
      0.13,
      0.13,
      { sideHint: P(0, 0, 1), bevelRatio: 0.14, irregular: 0.22, bow: 0.004, startCutNormal: P(-side, 0, 0), endCutNormal: UP_DIR, wear: 0.48, seed: 290 + side },
    ), 0x6a5038);
  }
  b.prop('timber', createTimberBeam(
    P(-drift.width / 2 - 0.55, drift.height + 0.28, 7.05),
    P(drift.width / 2 + 0.55, drift.height + 0.28, 7.05),
    0.26,
    0.26,
    { sideHint: P(0, 0, 1), bevelRatio: 0.15, irregular: 0.24, bow: 0.008, taper: 0.04, dampStart: 0.25, dampEnd: 0.25, wear: 0.5, seed: 330 },
  ), 0x6a5038);
  for (const x of [-0.9, 0, 0.9]) {
    b.prop('glow', box(0.03, drift.height * 0.68, 0.03, P(x, drift.height * 0.5, 7.11)), '#cfe0f5', 0.78);
  }
  b.prop('iron', stoneBox(drift.width + 0.1, 0.13, 0.26, P(0, 0.9, 7.12), { bevel: 0.015, irregular: 0.08 }), 0x707580);
  b.prop('iron', stoneBox(drift.width + 0.1, 0.13, 0.26, P(0, 2.2, 7.12), { bevel: 0.015, irregular: 0.08 }), 0x707580);
  placeAditDaylightTransition(b, drift, lightingSections);

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
export function buildSortingStation(b, shaftAt, hub, lightingSections = resolveMineLightingSections()) {
  const hubCfg = lightingSections.hub;
  const frameTop = 6.2;
  for (const [dx, dz] of [[-2.7, -2.7], [2.7, -2.7], [-2.7, 2.7], [2.7, 2.7]]) {
    const lx = shaftAt.x + dx;
    const lz = shaftAt.z + dz;
    const legFloorY = b.probe(lx, hub.y + 1.0, lz, -1, 3.0) ?? hub.y;
    b.prop('iron', stoneBlock(0.66, 0.45, 0.66, P(lx, legFloorY - 0.12, lz), { bevel: 0.04, batter: 0.15, irregular: 0.25 }), 0x6e737c);
    b.prop('timber', roughTimber(P(lx, legFloorY + 0.14, lz), P(shaftAt.x + dx * 0.55, frameTop, shaftAt.z + dz * 0.55), 0.34, 0.34, { taper: 0.12, bow: 0.022, irregular: 0.38 }), 0x7d6044);
    b.nav.block(P(lx, legFloorY, lz), 0.45, 3);
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
  // Work lamp seated on the windlass cheek post (post top y = 0.15; lantern base at at.y - 0.22) lighting the collar & headframe legs.
  lantern(b, P(wx, 0.37, wz - 0.65), {
    tint: hubCfg.tint,
    intensity: hubCfg.hoistIntensity * 0.62,
    range: 14.5,
    halo: 0.85,
    importance: 1.2,
    section: 'hub',
  });

  for (let index = 0; index < 10; index += 1) {
    const angle = index / 10 * Math.PI * 2, next = (index + 1) / 10 * Math.PI * 2;
    const at = (a, y) => P(shaftAt.x + Math.cos(a) * 2.75, y, shaftAt.z + Math.sin(a) * 2.75);
    b.prop('timber', roughTimber(at(angle, -0.1), at(next, -0.1), 0.12, 0.1, { bow: 0.015, irregular: 0.36 }), 0x6a5038);
    b.prop('timber', roughTimber(at(angle, -1), at(angle, 0.05), 0.12, 0.12, { irregular: 0.36 }), 0x6a5038);
  }
  // Iron clasp around headframe cross-beam + hanging hoist lantern.
  b.prop('iron', stoneBox(0.38, 0.08, 0.1, P(shaftAt.x, frameTop - 0.12, shaftAt.z - 1.2), { bevel: 0.01 }), 0x42464e);
  lantern(b, P(shaftAt.x, frameTop - 1.0, shaftAt.z - 1.2), {
    tint: hubCfg.tint,
    intensity: hubCfg.hoistIntensity,
    range: hubCfg.hoistRange,
    hung: 0.72,
    importance: 1.35,
    section: 'hub',
  });
  b.light(P(shaftAt.x, -15, shaftAt.z), hubCfg.shaftAbyssTint, hubCfg.shaftAbyssIntensity, 14, {
    halo: 1.2,
    haloGain: 0.2,
    dynamic: false,
    section: 'hub',
  });

  // Framed timber portal sets marking each gallery branching off the sorting hub.
  const westPortal = buildStandaloneTimberSet(b, P(-7.7, -1, -48), Math.PI / 2 - 0.2, 2.65, 2.45, {
    fitToRock: true, archetype: 'heavy', condition: 'maintained', jointStyle: 'bolster',
  });
  hangLanternOnFrame(b, westPortal, {
    hangDrop: 0.12,
    tint: hubCfg.tint,
    intensity: 4.1,
    range: 14.0,
    section: 'hub',
  });
  const eastPortal = buildStandaloneTimberSet(b, P(6.9, -1, -46), Math.PI / 2 + 0.35, 2.2, 2.18, {
    fitToRock: true, archetype: 'aged', condition: 'aged', jointStyle: 'notched',
  });
  hangLanternOnFrame(b, eastPortal, {
    hangDrop: 0.12,
    tint: lightingSections.abandoned.tint,
    intensity: 3.0,
    range: 12.5,
    flicker: lightingSections.abandoned.flickerAmount * 0.9,
    section: 'abandoned',
  });
  const inclinePortal = buildStandaloneTimberSet(b, P(0, -1, -57.2), 0, 2.8, 2.52, {
    fitToRock: true, archetype: 'heavy', condition: 'maintained', jointStyle: 'collared',
  });
  hangLanternOnFrame(b, inclinePortal, {
    hangDrop: 0.12,
    tint: hubCfg.tint,
    intensity: 4.4,
    range: 15.5,
    section: 'hub',
  });

  // Rail terminus timber bumper block + parked empty secondary ore tub + grounded switch lamp post.
  b.prop('timber', stoneBox(1.5, 0.42, 0.35, P(-2.6, -0.82, -52.2), { yaw: -0.2, bevel: 0.03 }), 0x6a5038);
  buildOreCart(b, P(-1.8, -1.0, -47.2), { loaded: false, yaw: -0.14 });
  const switchFloorY = b.probe(-0.92, 0.2, -45.5, -1, 3.0) ?? hub.y;
  const switchArmY = switchFloorY + 2.46;
  b.prop('timber', roughTimber(P(-0.92, switchFloorY - 0.1, -45.5), P(-0.92, switchArmY + 0.12, -45.5), 0.18, 0.18, { bow: 0.01, irregular: 0.26 }), 0x6a5038);
  b.prop('timber', hewnBeam(P(-0.84, switchArmY, -45.5), P(-1.38, switchArmY, -45.5), 0.12, 0.11, { bevel: 0.015 }), 0x6a5038);
  b.prop('timber', hewnBeam(P(-0.92, switchArmY - 0.36, -45.5), P(-1.24, switchArmY - 0.02, -45.5), 0.08, 0.08, { bevel: 0.01 }), 0x6a5038);
  b.prop('iron', stoneBox(0.06, 0.12, 0.08, P(-1.32, switchArmY, -45.5), { bevel: 0.008 }), 0x42464e);
  b.nav.block(P(-0.92, switchFloorY, -45.5), 0.3, 2.5);
  lantern(b, P(-1.32, switchArmY - 0.36, -45.5), { tint: hubCfg.tint, intensity: 4.2, range: 14.5, hung: 0.1, section: 'hub' });

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
  // Seated directly atop the plank tabletop (top y = -0.035; lantern base at at.y - 0.22).
  lantern(b, P(-5.14, 0.18, -44.77), { tint: '#ffc686', intensity: 4.6, range: 15.0, halo: 0.9, importance: 1.3, section: 'hub' });

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
}

/** Active West stope: wedged stulls, gallery supports, ore crib, mining tools, and seam lighting. */
export function buildStopeWorkings(b, stope, westShape = null, timberConfig = {}, lightingSections = resolveMineLightingSections()) {
  const stopeCfg = lightingSections.stope;
  const sharedCache = new TimberGeometryCache();
  let westSupports = null;
  if (westShape) {
    westSupports = buildMineTunnelSupports(b, {
      shape: westShape,
      width: 2.8,
      height: 2.7,
      condition: 'maintained',
      seedOffset: 202,
      entranceOffset: 3.6,
      endMargin: 2.8,
      cache: sharedCache,
    }, timberConfig);
  }
  for (let index = 0; index < 4; index += 1) {
    const x = stope.x + b.range(-5, 4), z = stope.z + b.range(-4, 4);
    const floorY = b.probe(x, stope.y + 1.2, z, -1, 2.5) ?? stope.y;
    const top = b.probe(x, stope.y + 1, z, 1, 9) ?? stope.y + 3;
    const tx = x + b.range(-0.22, 0.22);
    // Sill foot plate + chamfered mine stull + headboard + opposing tightening wedge at ceiling.
    b.prop('timber', createTimberBeam(P(x - 0.16, floorY + 0.04, z), P(x + 0.16, floorY + 0.04, z), 0.28, 0.09, {
      sideHint: P(0, 0, 1), bevelRatio: 0.16, irregular: 0.25, bow: 0.001, dampStart: 0.68, dampEnd: 0.68, wear: 0.55, seed: 410 + index,
    }), 0x6a5038);
    b.prop('timber', createTimberBeam(P(x, floorY + 0.08, z), P(tx, top - 0.11, z), 0.2, 0.2, {
      sideHint: P(1, 0, 0), bevelRatio: 0.15, irregular: 0.24, bow: 0.008, taper: 0.06, chipChance: 0.6, splitChance: 0.3, dampStart: 0.5, dampEnd: 0.28, wear: 0.5, seed: 510 + index * 19,
    }), 0x7d6044);
    b.prop('timber', createTimberBoard(P(tx - 0.26, top - 0.06, z), P(tx + 0.26, top - 0.06, z), P(0, 0, 1), 0.28, 0.075, {
      irregular: 0.2, damp: 0.45, wear: 0.48, seed: 610 + index,
    }), 0x6a5038);
    b.prop('timber', createTimberWedge(P(tx - 0.18, top - 0.01, z), P(tx + 0.18, top - 0.01, z), 0.14, 0.055, 0.014, {
      upHint: UP_DIR, damp: 0.3, wear: 0.4,
    }), 0x8d6e4c);
    b.nav.block(P(x, floorY, z), 0.32, 3);
  }
  // Working ore crib & blasting crates beside active pyrite seam face.
  const crib = P(stope.x - 1.8, stope.y, stope.z - 2.6);
  b.prop('timber', stoneBox(1.8, 0.72, 1.3, P(crib.x, crib.y + 0.36, crib.z), { yaw: 0.25, bevel: 0.03 }), 0x6a5038);
  b.prop('ore', stoneBox(1.3, 0.45, 0.85, P(crib.x, crib.y + 0.72, crib.z), { yaw: 0.25, bevel: 0.16, irregular: 0.55 }), 0xc4aa8a);
  buildMiningTool(b, P(crib.x + 1.15, stope.y, crib.z + 0.3), P(crib.x + 0.75, stope.y + 1.15, crib.z + 0.15), { head: 'pick', yaw: 0.3 });
  crate(b, P(stope.x + 2.8, stope.y, stope.z - 1.8), 0.72, 0.4);
  b.nav.block(crib, 1.1, 2);

  buildGroundedLanternPost(b, stope.x + 1.5, stope.z + 1, {
    probeStartY: stope.y + 1.0,
    fallbackFloorY: stope.y,
    topY: stope.y + 1.1,
    width: 0.38,
    postTint: 0x6a5038,
    navBlock: true,
    tint: stopeCfg.tint,
    intensity: stopeCfg.primaryIntensity,
    range: stopeCfg.primaryRange,
    importance: 1.4,
    flicker: stopeCfg.flickerAmount,
    section: 'stope',
  });
  if (westSupports && westSupports.frames.length > 2) {
    hangLanternOnFrame(b, westSupports.frames[2], {
      hangDrop: 0.1,
      tint: stopeCfg.workTint,
      intensity: 4.2,
      range: 14.5,
      flicker: stopeCfg.flickerAmount,
      section: 'stope',
    });
  } else {
    const fallbackFrame = fitTimberSet(b, P(-20, -2.0, -52), Math.PI / 2 - 0.45, { width: 2.5, height: 2.4, minLeft: 1.1, minRight: 1.1 });
    lantern(b, P(fallbackFrame.at.x, fallbackFrame.at.y + fallbackFrame.height - 0.38, fallbackFrame.at.z), {
      tint: stopeCfg.workTint,
      intensity: 4.2,
      range: 14.5,
      hung: 0.12,
      flicker: stopeCfg.flickerAmount,
      section: 'stope',
    });
  }
}

/** East heading collapse: aged timber barricade, snapped beam, fallen slate boulders, and warning lamp. */
export function buildCollapsedHeading(b, eastTurn, fall, eastShape = null, timberConfig = {}, lightingSections = resolveMineLightingSections()) {
  const abCfg = lightingSections.abandoned;
  const yawToFall = Math.atan2(-(fall.z - eastTurn.z), fall.x - eastTurn.x);
  const barrier = lerpP(eastTurn, fall, 0.68);
  const eastSupports = eastShape ? buildMineTunnelSupports(b, {
    shape: eastShape,
    width: 2.3,
    height: 2.4,
    condition: 'aged',
    seedOffset: 303,
    entranceOffset: 3.4,
    endMargin: 7.4,
  }, timberConfig) : null;
  const barrierSet = buildStandaloneTimberSet(b, barrier, yawToFall + Math.PI / 2, 2.05, 2.1, {
    fitToRock: true, archetype: 'repaired', condition: 'aged', jointStyle: 'collared', timberConfig,
  });

  // Diagonal timber X-barricade slats nailed across the drift frame.
  const rx = -Math.sin(yawToFall), rz = Math.cos(yawToFall);
  for (const [y0, y1] of [[0.55, 1.65], [1.65, 0.55], [1.1, 1.1]]) {
    b.prop('timber', createTimberBoard(
      P(barrier.x - rx * 0.95, barrier.y + y0, barrier.z - rz * 0.95),
      P(barrier.x + rx * 0.95, barrier.y + y1, barrier.z + rz * 0.95),
      UP_DIR, 0.15, 0.055, { irregular: 0.24, damp: 0.45, wear: 0.72, seed: 730 + Math.round(y0 * 100) },
    ), 0x6a5038);
  }
  // Snapped beam protruding from jagged fallen slate boulders past the barricade.
  const spill = lerpP(eastTurn, fall, 0.8);
  b.prop('timber', createTimberBeam(
    P(spill.x - 0.6, spill.y + 1.4, spill.z - 0.4),
    P(spill.x + 1.3, spill.y + 0.2, spill.z + 0.8),
    0.2, 0.2, { bow: 0.015, irregular: 0.34, chipChance: 0.8, splitChance: 0.7, dampStart: 0.5, dampEnd: 0.7, wear: 0.85, seed: 799 },
  ), 0x5c442f);
  for (const [dx, dy, dz, sx, sy, sz] of [
    [-0.4, 0.35, -0.2, 0.95, 0.7, 0.85], [0.35, 0.3, 0.25, 0.8, 0.55, 0.9], [-0.1, 0.75, 0.4, 0.75, 0.55, 0.7],
  ]) {
    b.prop('rock_debris', stoneBox(sx, sy, sz, P(spill.x + dx, spill.y + dy, spill.z + dz), {
      yaw: dx * 3, bevel: 0.14, irregular: 0.55,
    }), 0x9c958d);
  }
  if (eastSupports && eastSupports.frames.length > 1) {
    const midIdx = Math.min(4, eastSupports.frames.length - 1);
    hangLanternOnFrame(b, eastSupports.frames[midIdx], {
      hangDrop: 0.12,
      intensity: abCfg.intensity,
      range: abCfg.range,
      tint: abCfg.tint,
      flicker: abCfg.flickerAmount,
      importance: 0.85,
      section: 'abandoned',
    });
  } else {
    buildGroundedLanternPost(b, eastTurn.x + 4.0, eastTurn.z - 0.4, {
      probeStartY: eastTurn.y + 1.0,
      fallbackFloorY: eastTurn.y,
      topY: eastTurn.y + 1.25,
      width: 0.26,
      postTint: 0x56402c,
      intensity: abCfg.intensity,
      range: abCfg.range,
      tint: abCfg.tint,
      flicker: abCfg.flickerAmount,
      importance: 0.85,
      section: 'abandoned',
    });
  }
  hangLanternOnFrame(b, barrierSet, {
    lateralOffset: -0.58,
    hangDrop: 0.11,
    intensity: abCfg.intensity * 1.2,
    range: abCfg.range + 2.5,
    tint: abCfg.dimTint,
    flicker: abCfg.flickerAmount * 1.15,
    importance: 0.9,
    section: 'abandoned',
  });
}

/** Drowned lower level: damp aged incline supports, submerged rails, walkable duckboard pier & pool lighting. */
export function buildFloodedLevel(b, inclineTop, flooded, waterY, inclineShape = null, timberConfig = {}, lightingSections = resolveMineLightingSections()) {
  const flCfg = lightingSections.flooded;
  const inclineSupports = inclineShape ? buildMineTunnelSupports(b, {
    shape: inclineShape,
    width: 3.0,
    height: 3.0,
    condition: 'aged',
    seedOffset: 404,
    entranceOffset: 4.5,
    endMargin: 3.0,
    rail: { offset: 0 },
  }, timberConfig) : null;
  if (inclineSupports && inclineSupports.frames.length > 0) {
    const idx = Math.min(3, inclineSupports.frames.length - 1);
    hangLanternOnFrame(b, inclineSupports.frames[idx], {
      hangDrop: 0.12,
      tint: flCfg.tint,
      intensity: 3.8,
      range: 14.0,
      section: 'flooded',
    });
  } else {
    const floorAtZ = (z) => inclineTop.y + (-9 - inclineTop.y) * ((z - inclineTop.z) / (-80 - inclineTop.z));
    fitTimberSet(b, P(0, floorAtZ(-65), -65), 0, { width: 2.5, height: 2.5, minLeft: 1.15, minRight: 1.15 });
    const midSet = fitTimberSet(b, P(0, floorAtZ(-73), -73), 0, { width: 2.5, height: 2.5, minLeft: 1.15, minRight: 1.15 });
    lantern(b, P(midSet.at.x + 0.6, midSet.at.y + midSet.height - 0.34, midSet.at.z), {
      tint: flCfg.tint, intensity: 3.8, range: 14.0, hung: 0.12, section: 'flooded',
    });
  }
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
  buildGroundedLanternPost(b, -1.25, -81.1, {
    probeStartY: waterY + 1.0,
    fallbackFloorY: -9.0,
    topY: -7.52,
    width: 0.34,
    postTint: 0x5a442f,
    tint: flCfg.tint,
    intensity: flCfg.pierIntensity,
    range: flCfg.pierRange,
    importance: 1.3,
    section: 'flooded',
  });
  b.prop('timber', roughTimber(P(-3, waterY + 0.1, -84), P(-3.6, waterY + 0.4, -88), 0.3, 0.3, { taper: 0.1, bow: 0.025, irregular: 0.45 }), 0x4a3828);
  b.prop('timber', roughTimber(P(1.8, waterY + 0.05, -86.5), P(3.4, waterY + 0.08, -85.2), 0.24, 0.22, { bow: 0.02, irregular: 0.4 }), 0x523c28);

  // Far-side submerged piling post & rocky left-bank timber post lamps (no fake flat pool fill).
  buildGroundedLanternPost(b, 4.2, -89.2, {
    probeStartY: waterY + 1.0,
    fallbackFloorY: -9.0,
    topY: -7.65,
    width: 0.32,
    postTint: 0x523e2a,
    navBlock: false,
    tint: flCfg.tint,
    intensity: flCfg.farIntensity,
    range: flCfg.farRange,
    halo: 0.95,
    section: 'flooded',
  });
  buildGroundedLanternPost(b, -5.4, -85.0, {
    probeStartY: waterY + 1.2,
    fallbackFloorY: -9.0,
    topY: -7.38,
    width: 0.32,
    postTint: 0x5a442f,
    navBlock: false,
    tint: flCfg.tint,
    intensity: 3.6,
    range: 14.0,
    halo: 0.85,
    section: 'flooded',
  });
}

/**
 * Places selective, small angular rock debris tucked along wall-floor edges,
 * collapse fringes, and stope bases without encroaching on rail or walking lanes.
 */
export function scatterWallBaseDebris(b, pockets) {
  for (const pocket of pockets) {
    const { x, y, z, dx, dz, count = 3, tint = 0xa29a90 } = pocket;
    const step = 0.2;
    let wallDist = null;
    for (let d = 0.6; d <= 4.2; d += step) {
      if (b.grid.sample(x + dx * d, y + 0.75, z + dz * d) < 0) {
        wallDist = d;
        break;
      }
    }
    if (wallDist === null) continue;
    const baseDist = Math.max(0.8, wallDist - 0.36);
    for (let i = 0; i < count; i += 1) {
      const side = b.range(-0.65, 0.65);
      const sx = x + dx * baseDist - dz * side;
      const sz = z + dz * baseDist + dx * side;
      const floorY = b.terrainAt(sx, y + 1.2, sz, 2.5);
      if (floorY === null || Math.abs(floorY - y) > 0.65) continue;
      const w = b.range(0.18, 0.38);
      const h = b.range(0.1, 0.22);
      const d = b.range(0.18, 0.36);
      b.prop('rock_debris', stoneBox(w, h, d, P(sx, floorY + h * 0.3, sz), {
        yaw: b.range(0, Math.PI * 2),
        bevel: Math.min(w, h, d) * 0.28,
        irregular: 0.65,
        seed: Math.round((sx * 31 + sz * 17 + i * 13) * 100),
      }), tint);
    }
  }
}
