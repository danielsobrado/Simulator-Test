import { boulder } from '../gen/iceKit.js';
import { fbm3 } from '../gen/noise.js';
import { block, box, hewnBeam, rod, stoneBlock } from '../gen/propKit.js';
import { crevasse, hall as hallShape, mound, shaft, tunnel } from '../gen/shapes.js';
import { DARK, LOG, STONE, beacon, gableFront, longhall, palisade, storehouse, torch, watchGate } from './frostgardKit.js';
import { doorHide, dryingRack, hallInterior, sled, woodpile } from './frostgardDressing.js';
import { icicleCluster } from './glacierKit.js';
import { barrel, crate, lantern, timberSet } from './kits.js';

/**
 * A Frostgard hold at the foot of a glacier.
 *
 * The Norths did not build in the ice. Where the glacier's edge rides over a
 * bluff of bedrock they cut a great hall into the rock, faced it in timber and
 * let the snow bury its roof: rock holds a fire's heat, and ice would melt
 * round it. A palisade and watch gate keep the wind off the yard; the beacon
 * answers the border. Only the store is in the glacier — a passage from the
 * back of the hall leaves the rock, enters the ice, and ends in a chamber that
 * has never been above freezing.
 */

export const open = true;
export const bounds = { min: { x: -56, y: -8, z: -84 }, max: { x: 56, y: 52, z: 48 } };

const P = (x, y, z) => ({ x, y, z });
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const smooth01 = (value) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const HEADROOM = 2.2;
const MEAT = [0x7a4a3e, 0x8d6654, 0x9c9082];

export function generate(b, params) {
  const seed = b.seed;
  const { hall, knoll, glacier, wall, rise, store } = params;
  const wave = (x, z, scale, salt, octaves = 3) => fbm3(x * scale, 0.5, z * scale, seed + salt, octaves) - 0.5;
  const floor = hall.floor;
  const hallAt = P(0, floor, knoll.front - 2.5 - hall.halfLength);

  // --- The land: yard, rock walls, the bluff, the glacier over it ------------
  const ground = (x, z) => 0.5 + wave(x, z, 0.05, 1) * 2.2 + wave(x, z, 0.15, 2, 2) * 0.5
    - 0.5 * Math.exp(-((x / 3.5) ** 2)) + rise.height * Math.exp(-(((z - rise.z) / rise.width) ** 2));
  const wallX = (y, z) => wall.x + wave(z, y, 0.05, 3) * 8 + y * wall.lean;
  // The front swings south along the west side, so ice walls the yard's north-west corner.
  const faceZ = (x, y) => glacier.z + glacier.swing * smooth01((-22 - x) / 24) - y * glacier.lean
    + (fbm3(x * 0.05, y * 0.05, 0.5, seed + 4, 3) - 0.5) * 12 + (fbm3(x * 0.17, y * 0.17, 0.5, seed + 5, 2) - 0.5) * 3;
  const top = (x, z) => glacier.height + (glacier.z - z) * 0.1 + wave(x, z, 0.06, 6) * 6;
  const bluff = (x, y, z) => Math.max(
    Math.abs(x) - (knoll.halfWidth - y * 0.25 + wave(z, y, 0.08, 7) * 3),
    z - (knoll.front - y * 0.1),
    y - (knoll.height + wave(x, z, 0.1, 8) * 3),
  );
  b.grid.carve({
    box: bounds,
    air: (x, y, z) => Math.min(y - ground(x, z), wallX(y, z) - Math.abs(x),
      Math.max(z - faceZ(x, y), y - top(x, z)), bluff(x, y, z)),
  });
  for (const [from, to, back] of glacier.crevasses) {
    b.grid.carve(crevasse(P(from, 22, faceZ(from, 30) - back), P(to, 22, faceZ(to, 30) - back - 6),
      { topY: 50, topWidth: 3.2, wander: 2, seed: seed + from }), 0.6);
  }

  // --- Cut into the bluff: the hall, its doors, the flue ---------------------
  b.grid.carve(hallShape(hallAt, { halfLength: hall.halfLength, halfWidth: hall.halfWidth, height: hall.wallHeight, vaultRise: hall.vaultRise, yaw: Math.PI / 2 }));
  const south = hallAt.z + hall.halfLength, north = hallAt.z - hall.halfLength;
  b.grid.carve(tunnel(P(0, floor, knoll.front + 2.5), P(0, floor, south - 0.5), { halfWidth: 1.15, height: 2.55, arch: 0.1 }));
  b.grid.carve(tunnel(P(0, floor, north + 0.5), P(0, floor, north - 4), { halfWidth: 1.1, height: 2.5, arch: 0.1 }));
  b.grid.carve(shaft(P(0, 0, hallAt.z + 1), { radius: 0.75, bottomY: floor + hall.wallHeight + hall.vaultRise - 0.5, topY: knoll.height + 5 }));
  // Behind the hall the passage leaves the rock for the ice, and ends in the store.
  const passage = [P(0, floor, north - 3.5), P(-8, floor - 0.4, north - 8.5), P(store.x + 5, store.floor, store.z + 5)];
  for (let index = 0; index < passage.length - 1; index += 1) {
    b.passage(passage[index], passage[index + 1], { width: 2.5, height: 2.7, arch: 0.3, smooth: 0.5 });
  }
  b.room(P(store.x, store.floor + 3.3, store.z), { rx: store.radius, ry: 5, rz: store.radius - 0.5, floorY: store.floor, smooth: 0.8, walkRadius: store.radius - 1.6 });

  // Drifts where the wind drops its load: against the palisade, the bluff and the buildings.
  const gateZ = params.yard.gateZ;
  for (const [x, z, rx, rz] of [[-9, gateZ + 1.6, 6, 2.2], [12, gateZ + 1.4, 7, 2], [-25, gateZ + 1.2, 6, 2.4], [26, gateZ + 1.5, 6, 2],
    [-9, knoll.front + 1.5, 5, 2.4], [10, knoll.front + 1.2, 6, 2.2], [-20, 4, 3, 5]]) {
    b.grid.fill(mound(P(x, ground(x, z) + 0.1, z), rx, 1, rz), 1);
  }

  // Cut rock and laid timber stay true; only the natural faces are broken up.
  const built = (x, y, z) => (Math.abs(x) < hall.halfWidth + 2.5 && z < knoll.front + 3 && z > north - 5 && y < knoll.height - 1 ? 0 : 1);
  b.grid.roughen({ amp: 0.7, scale: 0.1, seed, octaves: 3, floorAmp: 0.08, ampAt: built });
  b.grid.striate({ ...params.strata, seed: seed + 9, ampAt: (x, y, z) => (z < faceZ(x, y) + 5 ? built(x, y, z) : 0) });
  b.grid.roughen({ amp: 0.2, scale: 0.5, seed: seed + 5, octaves: 2, floorAmp: 0.12, ampAt: built });

  // --- Where it can be walked ------------------------------------------------
  const footing = (x, z) => b.terrainAt(x, ground(x, z) + HEADROOM, z);
  const stand = (x, z) => P(x, footing(x, z) ?? ground(x, z), z);
  const stoopZ = knoll.front + 4.6;
  b.nav.addSurface((x, z) => footing(x, z) ?? NaN, (x, z) => z > stoopZ && z < rise.z - 5 && Math.abs(x) < wall.x - 6);
  b.nav.addRect(P(0, floor, knoll.front + 2.2), 1.7, 2.3);
  b.nav.addRect(P(0, floor * 0.66, stoopZ + 0.4), 1.4, 0.4);
  b.nav.addRect(P(0, floor * 0.33, stoopZ + 1.1), 1.4, 0.4);
  b.nav.addSegment(P(0, floor, knoll.front + 1), P(0, floor, south - 0.4), 1.7);
  b.nav.addSegment(P(0, floor, north + 0.6), passage[0], 1.6);

  // --- What the surface is made of ---------------------------------------------
  const near = (p, q, radius) => Math.max(0, 1 - Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) / radius);
  const storeAt = P(store.x, store.floor + 2, store.z);
  b.classify = (p, n, mask, mask2) => {
    const grain = fbm3(p.x * 0.09, p.y * 0.09, p.z * 0.09, seed + 11, 3);
    const up = clamp01((n.y - 0.25) / 0.45);
    const into = faceZ(p.x, p.y) - p.z;
    // Ice is whatever lies behind the glacier's face; the contact with the rock is ragged, not a line.
    const rock = clamp01(0.5 - (into + (grain - 0.5) * 5) / 2.5);
    const cold = near(p, storeAt, store.radius + 6);
    mask[0] = rock;
    mask[1] = 0;
    mask[2] = clamp01(cold * 0.75 + clamp01((p.y - glacier.height + 8) / 10) * 0.4);
    mask[3] = clamp01(cold * 0.35 + Math.max(0, grain - 0.5) * 2.2);
    // The glacier's sole is dirty with what it rode over: it shows wherever the passage cuts it.
    mask2[0] = clamp01(Math.max(0, 1 - (p.y - ground(p.x, p.z)) / 6) * (0.5 + grain));
    mask2[1] = clamp01((p.y - 22) / 14);
    mask2[2] = clamp01(cold * up * 0.9);
    return 1 - rock;
  };

  // --- The hall ------------------------------------------------------------------
  const ridge = hall.wallHeight + hall.vaultRise - 0.35;
  hallInterior(b, hallAt, { halfWidth: hall.halfWidth, halfLength: hall.halfLength, wallHeight: hall.wallHeight, ridge });
  gableFront(b, P(0, floor, knoll.front + 0.35), { width: hall.halfWidth * 2 + 2.4, wallHeight: 4.2, roofRise: 4, footing: floor + 1 });
  // The stoop and its steps, and the door passages dressed in stone under timber lintels.
  b.prop('masonry', stoneBlock(3.8, floor + 1, 4.9, P(0, -1, knoll.front + 2.2), { irregular: 0.2 }), STONE);
  for (const [step, z] of [[0.66, stoopZ + 0.4], [0.33, stoopZ + 1.1]]) {
    b.prop('masonry', stoneBlock(3, floor * step + 0.5, 0.75, P(0, -0.5, z), { irregular: 0.25 }), STONE);
  }
  for (const [from, to] of [[knoll.front + 0.2, south], [north, north - 4]]) {
    for (const sx of [-1, 1]) {
      b.prop('masonry', stoneBlock(0.3, 2.5, Math.abs(to - from), P(sx * 1.25, floor, (from + to) / 2), { irregular: 0.2 }), STONE);
    }
    b.prop('timber', block(2.9, 0.25, Math.abs(to - from), P(0, floor + 2.5, (from + to) / 2)), DARK);
  }
  doorHide(b, P(0, floor, north - 1.2));
  doorHide(b, P(0, floor, north - 3.6));
  // The smoke turret on the bluff, over the hearth.
  const vent = P(0, b.probe(3, knoll.height + 6, hallAt.z + 1, -1, 12) ?? knoll.height, hallAt.z + 1);
  b.prop('masonry', stoneBlock(2.4, 1.6, 2.4, P(vent.x, vent.y - 0.5, vent.z), { batter: 0.15, irregular: 0.4 }), STONE);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    b.prop('timber', hewnBeam(P(vent.x + sx * 0.85, vent.y + 1, vent.z + sz * 0.85), P(vent.x + sx * 0.85, vent.y + 2, vent.z + sz * 0.85), 0.18, 0.18), DARK);
  }
  b.prop('roof', block(2.7, 0.3, 2.7, P(vent.x, vent.y + 2, vent.z)), 0xffffff);
  b.light(P(vent.x, vent.y + 1.6, vent.z), '#ff9a45', 2.2, 9, { halo: 1.6 });
  b.emit('smoke', P(vent.x, vent.y + 1.7, vent.z));

  // --- The passage and the store ---------------------------------------------------
  timberSet(b, passage[1], Math.atan2(passage[2].x - passage[0].x, passage[2].z - passage[0].z), 2.3, 2.45);
  const mid = P((passage[1].x + passage[2].x) / 2, (passage[1].y + passage[2].y) / 2, (passage[1].z + passage[2].z) / 2);
  timberSet(b, mid, Math.atan2(passage[2].x - passage[1].x, passage[2].z - passage[1].z), 2.3, 2.45);
  lantern(b, P(passage[1].x, passage[1].y + 2.05, passage[1].z), { intensity: 2.4, range: 9, halo: 1 });
  // Lamps set in niches behind the ice: a wall a metre thick glows, and lights the store without warming it.
  for (const [dx, dz] of [[-store.radius - 1.2, 1], [1.5, -store.radius - 0.7], [store.radius + 1, -2.5]]) {
    b.light(P(store.x + dx, store.floor + 2, store.z + dz), '#fff0d0', 6, 10, { radius: 1.4 });
  }
  const S = (dx, dy, dz) => P(store.x + dx, store.floor + dy, store.z + dz);
  // Carcasses and split fish hung on a rail, clear of the floor.
  for (const dx of [-3.2, 3.2]) {
    b.prop('timber', hewnBeam(S(dx, 0, -2), S(dx, 2.9, -2), 0.2, 0.2), LOG);
    b.nav.block(S(dx, 0, -2), 0.4, 3);
  }
  b.prop('timber', hewnBeam(S(-3.6, 2.8, -2), S(3.6, 2.8, -2), 0.18, 0.2), DARK);
  for (let dx = -2.6; dx <= 2.6; dx += 0.75) {
    const long = b.range(0.7, 1.5);
    b.prop('timber', rod(S(dx, 2.7, -2), S(dx, 2.55 - long, -2), 0.05, b.range(0.14, 0.24), 7), MEAT[Math.floor(b.range(0, 3))]);
  }
  // Cut ice stacked for the summer, stores on sleepers, the sled they came on.
  for (let row = 0; row < 3; row += 1) {
    for (let index = 0; index < 4 - row; index += 1) {
      b.prop('clearIce', box(0.9, 0.5, 0.6, S(4.2 - row * 0.1, 0.25 + row * 0.5, 0.8 + index * 0.95 + row * 0.45), 0.05 * index), 0xffffff);
    }
  }
  b.nav.block(S(4.2, 0, 2.2), 1.9, 2);
  for (const [dx, dz] of [[-4.2, 1.2], [-4.6, 2.2], [-3.6, 2.6]]) {
    barrel(b, S(dx, 0, dz));
    b.nav.block(S(dx, 0, dz), 0.5, 2);
  }
  crate(b, S(-4.4, 0, 0), 0.9, 0.2);
  crate(b, S(-4.3, 0.74, 0.1), 0.7, 0.5);
  b.nav.block(S(-4.4, 0, 0), 0.8, 2);
  sled(b, S(0.6, 0, 3), 2.4);
  for (let index = 0; index < params.icicles; index += 1) {
    const dx = b.range(-store.radius, store.radius), dz = b.range(-store.radius, store.radius);
    icicleCluster(b, S(dx, 2, dz), { length: [0.4, 1.6], reach: 8 });
  }

  // --- The yard --------------------------------------------------------------------
  palisade(b, P(-wall.x + 2, 0, gateZ), P(wall.x - 2, 0, gateZ), ground, { skip: [wall.x - 2 - 2.9, wall.x - 2 + 2.9] });
  watchGate(b, stand(0, gateZ));
  for (const sx of [-1, 1]) {
    torch(b, stand(sx * 3.6, gateZ + 2.2));
    torch(b, stand(sx * 3, stoopZ + 1.6), { height: 1.7 });
  }
  beacon(b, stand(11, gateZ - 6));
  longhall(b, stand(-17, 0), params.cottage, { icicles: true });
  storehouse(b, stand(15, -2), { icicles: true });
  woodpile(b, stand(-8, knoll.front + 4.6), { length: 1.3, rows: 4, count: 7 });
  woodpile(b, stand(-6.4, knoll.front + 4.6), { length: 1.3, rows: 3, count: 6 });
  sled(b, stand(5.5, 6), 0.5);
  dryingRack(b, stand(17, 6.5));
  dryingRack(b, stand(-27, 8), { hides: true });
  barrel(b, stand(12.2, 1.6));
  crate(b, stand(11.4, 0.6), 0.8, 0.4);
  b.nav.block(stand(11.8, 1.1), 0.9, 2);
  // Boulders the bluff has shed, half buried.
  for (const [x, z, size] of [[-13, knoll.front + 3, 1.5], [14, knoll.front + 2.4, 1.9], [24, 3, 1.3], [-30, -2, 1.7], [-34, gateZ + 9, 1.4], [30, gateZ + 12, 1.8]]) {
    const at = stand(x, z);
    b.prop('rock', boulder(P(at.x, at.y - size * 0.3, at.z), size, size * 0.75, size * 0.9, { seed: Math.round(x * 7 + z), blocky: 0.25 }), 0xb9bcc2);
    b.nav.block(at, size, 2);
  }

  b.anchor('gate', P(0, 3, gateZ + 8));
  b.spawn('entry', stand(0, rise.z - 11), 0);
  b.exit('road', stand(0, rise.z - 7), { radius: 2.6, label: 'Take the sled road down the valley' });
}
