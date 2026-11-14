import { createMineGeologyClassifier } from '../gen/mineGeology.js';
import { mound, shaft } from '../gen/shapes.js';
import { TimberGeometryCache, createTimberBeam } from '../gen/timberGeometry.js';
import { buildMineTunnelSupports } from '../gen/timberSupportBuilder.js';
import { rails } from './kits.js';
import {
  mountWallSconceLantern,
  placeHaulageLanterns,
  resolveMineLightingSections,
} from './mineLightingLayout.js';
import {
  buildAditPortal,
  buildCollapsedHeading,
  buildFloodedLevel,
  buildOreCart,
  buildSortingStation,
  buildStopeWorkings,
  scatterWallBaseDebris,
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
  const tunnelGeometry = params.tunnelGeometry;
  const adit = P(0, 0, 6), haulEnd = P(0, -1, -40);
  const hub = P(0, -1, -50);
  const stope = P(-36, -3, -62);
  const shaftAt = P(7, -1, -54);
  const flooded = P(0, -9, -86);

  // Chambers and shaft first, roughened before tunnels carve cleanly into them.
  // Keep ellipsoid equators balanced so lower curved chamber walls stay crisp without swallowing sorting headframe legs.
  b.room(P(hub.x, hub.y + 2.8, hub.z), { rx: 12, ry: 5.8, rz: 11, floorY: hub.y, smooth: 0.8 });
  b.room(P(shaftAt.x, hub.y + 2.6, shaftAt.z), { rx: 4.9, ry: 6.4, rz: 4.9, floorY: hub.y, smooth: 0.7 });
  b.grid.carve(shaft(shaftAt, { radius: 2.3, bottomY: -18, topY: 8 }));
  b.nav.block(shaftAt, 3.1, 3);
  b.room(P(stope.x, stope.y + 2.5, stope.z), { rx: 8, ry: 5.2, rz: 7, floorY: stope.y, smooth: 0.6 });
  b.room(P(flooded.x, flooded.y + 2.5, flooded.z), { rx: 9, ry: 5.0, rz: 7, floorY: flooded.y, smooth: 0.6, walkRadius: 0 });
  b.nav.addDisc(P(0, -9, -81.5), 2.6);
  b.grid.roughen({ amp: 0.3, scale: 0.42, seed: b.seed, octaves: 2 });

  // Haulage drift: left clearance reserves the rail bed & cart envelope.
  const haulShape = b.minePassage([adit, haulEnd], {
    width: drift.width,
    height: drift.height,
    seedOffset: 101,
    tunnelGeometry,
    clearance: { left: 1.82, right: 1.48, height: 2.45 },
    smooth: 0.35,
  });

  // West: the ore gallery and the stope it feeds (continuous curve through westTurn).
  const westTurn = P(-20, -2, -52);
  const westShape = b.minePassage([P(-7.2, -1, -48), westTurn, P(-30, -3, -60)], {
    width: 2.8,
    height: 2.7,
    seedOffset: 202,
    tunnelGeometry,
    clearance: { left: 1.15, right: 1.15, height: 2.25 },
    smooth: 0.35,
  });

  // East: the old heading, lost to a fall.
  const eastTurn = P(26, 0.5, -38);
  const fall = P(38, 2, -24);
  const eastShape = b.minePassage([P(6.5, -1, -46), eastTurn, fall], {
    width: 2.3,
    height: 2.4,
    seedOffset: 303,
    tunnelGeometry,
    clearance: { left: 0.98, right: 0.98, height: 2.1 },
    blendEnds: { start: true, end: false },
    smooth: 0.35,
  });
  const mounds = [];
  for (let index = 0; index < 5; index += 1) {
    const mx = fall.x + b.range(-1.6, 1.6);
    const my = fall.y + b.range(0, 1.6);
    const mz = fall.z + b.range(-1.2, 1.8);
    const rx = b.range(1, 1.9);
    const ry = b.range(0.8, 1.5);
    const rz = b.range(1, 1.9);
    b.grid.fill(mound(P(mx, my, mz), rx, ry, rz), 0.5);
    mounds.push({ x: mx, y: my, z: mz, radius: Math.max(rx, rz) + 0.3 });
  }
  b.nav.block(P(fall.x, fall.y, fall.z + 0.6), 2.2, 3);

  // Down: the incline to the drowned level.
  const inclineTop = P(0, -1, -57);
  const inclineShape = b.minePassage([inclineTop, P(0, -9, -80)], {
    width: 3,
    height: 3,
    seedOffset: 404,
    tunnelGeometry,
    clearance: { left: 1.25, right: 1.25, height: 2.35 },
    smooth: 0.35,
  });

  // Ore: where the seam shows, in the walls and in the heaps won from it.
  const deposits = [
    [stope.x - 6, 0, stope.z - 2, 7], [stope.x + 1, 1, stope.z - 6, 5], [-24, -1, -56, 4], [-3, 1, -22, 3.5],
    [4, 1.5, -47, 3], [30, 2, -34, 4], [3, -8, -90, 5],
  ];
  const heaps = [P(-33, -3, -59), P(-38, -3, -65), P(-4, -1, -55), P(3.5, -1, -44)];
  for (const heap of heaps) {
    const rx = b.range(1.1, 1.7);
    const ry = b.range(0.6, 0.9);
    const rz = b.range(1.1, 1.7);
    b.grid.fill(mound(heap, rx, ry, rz), 0.3);
    deposits.push([heap.x, heap.y + 0.4, heap.z, 2]);
    mounds.push({ x: heap.x, y: heap.y, z: heap.z, radius: Math.max(rx, rz) + 0.3 });
    b.nav.block(heap, 1.3, 2);
  }

  // Fine surface grit (keeps floors flat for rails and walkers).
  b.grid.roughen({ amp: 0.08, scale: 1.7, seed: b.seed + 9, octaves: 2, floorAmp: 0 });

  const waterY = flooded.y + 0.45;
  const footings = [];
  const railSegments = [
    [-0.9, 0, 5, -0.9, -1, -40],
    [-0.9, -1, -40, -2.5, -1, -52],
    [inclineTop.x, inclineTop.y, inclineTop.z, 0, -9.2, -83],
  ];
  const rubblePoints = [
    { x: fall.x, y: fall.y, z: fall.z, radius: 7.5 },
    { x: 35.6, y: 1.7, z: -26.8, radius: 5.0 },
    ...heaps.map((heap) => ({ x: heap.x, y: heap.y, z: heap.z, radius: 2.8 })),
  ];
  const zones = [
    { x: 0, y: -0.5, z: -18, radius: 24, freshness: 0.45, earthBias: 0.78, gravelBias: 0.14, wetBias: 0, mineralBias: 0.08 },
    { x: hub.x, y: hub.y, z: hub.z, radius: 13.5, freshness: 0.52, earthBias: 0.82, gravelBias: 0.22, wetBias: 0.04, mineralBias: 0.12 },
    { x: -24, y: -2.2, z: -55, radius: 11.5, freshness: 0.76, earthBias: 0.48, gravelBias: 0.52, wetBias: 0.02, mineralBias: 0.34 },
    { x: stope.x, y: stope.y, z: stope.z, radius: 11, freshness: 0.88, earthBias: 0.34, gravelBias: 0.68, wetBias: 0.02, mineralBias: 0.48 },
    { x: 24, y: 0.5, z: -40, radius: 13.5, freshness: 0.18, earthBias: 0.52, gravelBias: 0.55, wetBias: 0.05, mineralBias: 0.12 },
    { x: fall.x, y: fall.y, z: fall.z, radius: 12, freshness: 0.12, earthBias: 0.38, gravelBias: 0.82, wetBias: 0.08, mineralBias: 0.1 },
    { x: 0, y: -5, z: -70, radius: 13, freshness: 0.4, earthBias: 0.64, gravelBias: 0.3, wetBias: 0.52, mineralBias: 0.14 },
    { x: flooded.x, y: flooded.y, z: flooded.z, radius: 14, freshness: 0.34, earthBias: 0.7, gravelBias: 0.22, wetBias: 0.85, mineralBias: 0.16 },
  ];
  const passages = [
    { spine: haulShape.spine, halfWidth: drift.width * 0.5 },
    { spine: westShape.spine, halfWidth: 2.8 * 0.5 },
    { spine: eastShape.spine, halfWidth: 2.3 * 0.5 },
    { spine: inclineShape.spine, halfWidth: 3 * 0.5 },
  ];
  const rooms = [
    { x: hub.x, z: hub.z, rx: 12, rz: 11, floorY: hub.y },
    { x: stope.x, z: stope.z, rx: 8, rz: 7, floorY: stope.y },
    { x: flooded.x, z: flooded.z, rx: 9, rz: 7, floorY: flooded.y },
  ];
  b.classify = createMineGeologyClassifier({
    seed: b.seed,
    grid: b.grid,
    config: params.geology,
    deposits,
    rails: railSegments,
    zones,
    rubblePoints,
    footings,
    passages,
    rooms,
    mounds,
    waterY,
  });

  // --- Built works -------------------------------------------------------
  const lightingSections = resolveMineLightingSections(params);
  buildAditPortal(b, drift, lightingSections);

  // Procedural geology-adapted timber supports down the haulage drift + hung lanterns.
  const sharedTimberCache = new TimberGeometryCache();
  const haulSupports = buildMineTunnelSupports(b, {
    shape: haulShape,
    width: drift.width,
    height: drift.height,
    condition: 'maintained',
    seedOffset: 101,
    entranceOffset: 5.4,
    endMargin: 2.8,
    rail: { offset: -0.9 },
    avoidZones: [{ x: hub.x, y: hub.y, z: hub.z, radius: 9.2, height: 6 }],
    cache: sharedTimberCache,
  }, params.timber);

  for (const plan of haulSupports.plans) {
    footings.push(
      P(plan.center.x + plan.right.x * plan.leftPostOffset, plan.floorLeftY, plan.center.z + plan.right.z * plan.leftPostOffset),
      P(plan.center.x + plan.right.x * plan.rightPostOffset, plan.floorRightY, plan.center.z + plan.right.z * plan.rightPostOffset),
    );
  }

  placeHaulageLanterns(b, haulSupports.frames, lightingSections, { skipNearZ: [-25.6] });
  for (const dy of [0.1, 0.3]) {
    b.prop('timber', createTimberBeam(
      P(1.12, -0.35 + dy, -13),
      P(1.12, -0.35 + dy, -15.4),
      0.16,
      0.15,
      { bevelRatio: 0.15, irregular: 0.2, bow: 0.004, taper: 0.04, dampStart: 0.35, dampEnd: 0.35, seed: 801 + Math.round(dy * 100) },
    ), 0x765a3e);
  }
  rails(b, P(-0.9, 0, 5), P(-0.9, -1, -40));
  rails(b, P(-0.9, -1, -40), P(-2.5, -1, -52));

  // Loaded ore cart on the main haulage rails + iron wall sconce anchored into right rock wall.
  buildOreCart(b, P(-0.9, -0.62, -27), { loaded: true, yaw: 0 });
  mountWallSconceLantern(b, P(0, -0.687, -25.6), 1, 0, {
    heightAboveFloor: 1.68,
    armLength: 0.30,
    hangDrop: 0.09,
    tint: lightingSections.haulage.warmAltTint,
    intensity: lightingSections.haulage.intensity * 0.94,
    range: 13,
    importance: 1.25,
    flicker: lightingSections.haulage.flickerAmount,
    section: 'haulage',
  });

  buildSortingStation(b, shaftAt, hub, lightingSections);
  buildStopeWorkings(b, stope, westShape, params.timber, lightingSections);
  buildCollapsedHeading(b, eastTurn, fall, eastShape, params.timber, lightingSections);
  buildFloodedLevel(b, inclineTop, flooded, waterY, inclineShape, params.timber, lightingSections);

  // Selective physical rock talus tucked along wall-floor skirts, stope bases, and collapse fringe.
  scatterWallBaseDebris(b, [
    { x: 0.2, y: -0.2, z: -8, dx: 1, dz: 0, count: 2 },
    { x: 0.2, y: -0.45, z: -19, dx: 1, dz: 0, count: 3 },
    { x: 0.2, y: -0.7, z: -31, dx: 1, dz: 0, count: 2 },
    { x: -16, y: -1.7, z: -50, dx: 0, dz: 1, count: 3 },
    { x: -34, y: -3, z: -61, dx: -1, dz: 0, count: 4 },
    { x: -36, y: -3, z: -63, dx: 0, dz: -1, count: 3 },
    { x: 24, y: 0.3, z: -39, dx: 0.5, dz: -0.86, count: 3 },
    { x: 32, y: 1.4, z: -31, dx: 0.7, dz: -0.7, count: 4 },
  ]);

  b.spawn('entry', P(0, 0, 3.5), 0);
  b.exit('adit', P(0, 0, 5.6), { label: 'Leave the workings' });
}
