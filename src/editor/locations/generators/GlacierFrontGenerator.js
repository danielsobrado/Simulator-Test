import { fbm3 } from '../gen/noise.js';
import { onTrail } from '../gen/plan.js';
import { panel, rod } from '../gen/propKit.js';
import { chamber, column, crevasse, mound, tunnel } from '../gen/shapes.js';
import { DARK, torch } from './frostgardKit.js';
import { sled } from './frostgardDressing.js';
import { frozenFall, icicleCluster, scatter } from './glacierKit.js';

/**
 * The front of a Frostgard glacier, under the sky.
 *
 * A valley glacier ends between two rock walls in a cliff of ice. Flow has
 * split its lip into seracs; meltwater has undercut its foot and opened a cave
 * in it; a wall of older ice the front left behind still stands across the
 * forefield, holed through by an arch. Between that wall and the cliff lies the
 * frozen melt pool, and beyond the forefield the moraine the glacier pushed up
 * when it was longer. The way in runs moraine → arch → pool → cave.
 */

export const open = true;
export const bounds = { min: { x: -76, y: -8, z: -116 }, max: { x: 76, y: 66, z: 46 } };

const P = (x, y, z) => ({ x, y, z });
const clamp01 = (value) => Math.min(1, Math.max(0, value));
/** Clear headroom the walker's path is probed from, above the rough ground height. */
const HEADROOM = 2.2;
/** Half the width of the trodden line through the snow, metres. */
const TRAIL_HALF_WIDTH = 1.5;

export function generate(b, params) {
  const seed = b.seed;
  const { front, wall, moraine, pool, arch } = params;
  const wave = (x, z, scale, salt, octaves = 3) => fbm3(x * scale, 0.5, z * scale, seed + salt, octaves) - 0.5;

  // --- The valley: forefield, rock walls, the glacier ----------------------
  const basin = (x, z) => clamp01(1.6 - Math.hypot((x - pool.x) / pool.rx, (z - pool.z) / pool.rz) * 1.6);
  const ground = (x, z) => {
    const rolling = 0.6 + wave(x, z, 0.04, 1) * 3 + wave(x, z, 0.13, 2, 2) * 0.8
      + moraine.height * Math.exp(-(((z - moraine.z) / moraine.width) ** 2));
    const level = basin(x, z);
    return rolling + (pool.y - rolling) * level;
  };
  const wallX = (y, z) => wall.x + wave(z, y, 0.05, 3) * 9 + y * wall.lean;
  const faceZ = (x, y) => front.z - (x / 60) ** 2 * front.bow - y * front.lean
    + (fbm3(x * 0.05, y * 0.05, 0.5, seed + 4, 3) - 0.5) * 16 + (fbm3(x * 0.16, y * 0.16, 0.5, seed + 5, 2) - 0.5) * 4;
  const top = (x, z) => front.height + (front.z - z) * 0.08 + wave(x, z, 0.06, 6) * 7 - (x / 70) ** 2 * 6;
  b.grid.carve({
    box: bounds,
    air: (x, y, z) => Math.min(y - ground(x, z), wallX(y, z) - Math.abs(x), Math.max(z - faceZ(x, y), y - top(x, z))),
  });

  // Flow pulls the lip apart: crevasses run back from the face, others cross them, and what stands between is seracs.
  for (let index = 0; index < front.crevasses; index += 1) {
    const x = -52 + index * (104 / (front.crevasses - 1)) + b.range(-4, 4);
    const lipZ = faceZ(x, 30), floor = b.range(12, 26);
    b.grid.carve(crevasse(P(x + b.range(-3, 3), floor, lipZ + 12), P(x + b.range(-5, 5), floor, lipZ - b.range(14, 24)),
      { topY: 60, topWidth: b.range(2.4, 4.2), wander: 1.2, seed: seed + index }), 0.6);
  }
  for (const [from, to, back] of [[-48, -6, 9], [0, 46, 12], [-30, 30, 24]]) {
    b.grid.carve(crevasse(P(from, 20, faceZ(from, 30) - back), P(to, 20, faceZ(to, 30) - back),
      { topY: 60, topWidth: 3, wander: 2.5, seed: seed + from }), 0.6);
  }
  for (const x of front.spires) {
    const z = faceZ(x, 34) - 3.5, base = top(x, z);
    b.grid.fill(column(P(x, base - 9, z), P(x + b.range(-1.5, 1.5), base + b.range(4, 9), z + 1.5), 3.3, 1.3), 1.5);
  }

  // The wall of old ice across the forefield, and the arch melted through it.
  const ridgeZ = (x) => arch.z + Math.sin(x * 0.07) * 3;
  const ridgeTop = (x) => (arch.wallHeight + wave(x, 0, 0.09, 7, 2) * 10) * Math.max(0, 1 - Math.abs((x - arch.x) / 29) ** 4);
  b.grid.fill({
    box: { min: P(arch.x - 33, -4, arch.z - 11), max: P(arch.x + 33, arch.wallHeight + 9, arch.z + 11) },
    solid: (x, y, z) => Math.max(Math.abs(z - ridgeZ(x)) - (2.6 + Math.max(0, 14 - y) * 0.14), y - ridgeTop(x)),
  }, 2);
  const archFloor = ground(arch.x, arch.z) - 0.2;
  b.grid.carve(tunnel(P(arch.x, archFloor, arch.z + 9), P(arch.x, archFloor, arch.z - 9),
    { halfWidth: arch.width / 2, height: arch.height, arch: 0.95 }), 1.5);
  b.grid.carve(chamber(P(arch.x - 16, 8.5, ridgeZ(arch.x - 16)), { rx: 2.6, ry: 2.2, rz: 5 }), 0.8);

  // Meltwater undercut the foot of the cliff to the west, and bored the cave to the east of it.
  const notch = [-50, -40, -30, -19].map((x) => P(x, ground(x, faceZ(x, 2)), faceZ(x, 2) + 1));
  for (let index = 0; index < notch.length - 1; index += 1) {
    b.grid.carve(tunnel(notch[index], notch[index + 1], { halfWidth: 5.5, height: 5, arch: 0.75 }), 2);
  }
  const caveZ = faceZ(front.caveX, 3), caveFloor = ground(front.caveX, caveZ);
  const cave = [P(front.caveX, caveFloor - 0.1, caveZ + 5), P(front.caveX + 1.5, caveFloor - 0.5, caveZ - 8),
    P(front.caveX - 1, caveFloor - 1.2, caveZ - 20), P(front.caveX - 4.5, caveFloor - 1.6, caveZ - 30)];
  b.grid.carve(chamber(P(front.caveX, caveFloor + 3, caveZ - 1), { rx: 7.5, ry: 6.5, rz: 7, floorY: caveFloor - 0.2 }), 2);
  b.tube(cave, { width: 6, height: 5.5, arch: 0.9, smooth: 1.2, pinch: 0.25 });

  // A frozen fall down the east wall, bergs calved at the cliff's foot, drifts in their lee.
  const fallZ = -14;
  const fallFoot = P(wallX(1, fallZ) - 2.5, ground(wallX(1, fallZ) - 2.5, fallZ), fallZ);
  frozenFall(b, P(wallX(34, fallZ) - 0.5, 34, fallZ), fallFoot, { x: 0, z: 1 }, { width: 8, columns: 11 });
  for (const [x, out, size] of front.bergs) {
    const z = faceZ(x, 2) + out;
    b.grid.fill(mound(P(x, ground(x, z) + size * 0.3, z), size * 1.3, size, size * 0.9), 0.6);
    b.grid.fill(mound(P(x + size * 1.6, ground(x, z) + 0.1, z + size), size * 2.2, 0.8, size * 1.4), 1.2);
  }

  const ice = (x, y, z) => (z < faceZ(x, y) + 6 || Math.abs(z - ridgeZ(x)) < 9 ? 1 : 0);
  // The valley walls are broken rock: craggier than anything the ice does.
  const crag = (x, y, z) => (Math.abs(x) > wallX(y, z) - 6 ? wall.crag : 1);
  b.grid.roughen({ amp: 0.9, scale: 0.09, seed, octaves: 3, floorAmp: 0.08, ampAt: crag });
  b.grid.striate({ ...params.strata, seed: seed + 9, ampAt: ice });
  b.grid.roughen({ amp: 0.22, scale: 0.5, seed: seed + 5, octaves: 2, floorAmp: 0.12 });

  // --- Where it can be walked ---------------------------------------------
  const footing = (x, z) => b.terrainAt(x, ground(x, z) + HEADROOM, z);
  const stand = (x, z) => P(x, footing(x, z) ?? ground(x, z), z);
  b.nav.addSurface((x, z) => footing(x, z) ?? NaN, (x, z) => z < moraine.z - 6 && Math.abs(x) < wall.x - 6);

  // The line the Norths walk and sledge: in by the stakes to the cave, and off east to the hold.
  const trails = [
    [P(0, 0, moraine.z - 8), ...params.stakes.map(([x, z]) => P(x - 1.6, 0, z)), cave[0], cave[1], cave[3]],
    [P(params.stakes[0][0] - 1.6, 0, params.stakes[0][1]), P(wall.x - 24, 0, 15), P(wall.x - 11, 0, 16)],
  ];

  // --- What the surface is made of ------------------------------------------
  const near = (p, q, radius) => Math.max(0, 1 - Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) / radius);
  const archAt = P(arch.x, archFloor + 4, arch.z), mouthAt = P(front.caveX, caveFloor + 3, caveZ);
  b.classify = (p, n, mask, mask2) => {
    const grain = fbm3(p.x * 0.09, p.y * 0.09, p.z * 0.09, seed + 11, 3);
    const up = clamp01((n.y - 0.25) / 0.45);
    const height = p.y - ground(p.x, p.z);
    const margin = Math.abs(p.x) - wallX(p.y, p.z);
    const frozen = near(p, P(fallFoot.x + 2, p.y, fallFoot.z), 7);
    const lake = basin(p.x, p.z) * up * (height < 1.2 ? 1 : 0);
    const glacier = p.z < faceZ(p.x, p.y) + 2.5 || (Math.abs(p.z - ridgeZ(p.x)) < 7 && height > 0.7 && Math.abs(p.x - arch.x) < 32);
    // Rock is the valley walls and the till under the forefield; along the margin, ice and rock interleave.
    const rock = glacier ? clamp01((margin + 4 + (grain - 0.5) * 9) / 3) : clamp01(1 - frozen * 2 - lake * 2);
    mask[0] = rock;
    // Negative snow: where the wind scours it off — the pool, and bare patches of the forefield.
    mask[1] = -Math.max(lake * (1.25 - grain), clamp01((grain - 0.56) * 6) * 0.9);
    mask[2] = clamp01((p.y - front.height + 8) / 10) * 0.5;
    // The pool froze from the top down: clear, cracked right through, bubbles caught under the surface.
    mask[3] = clamp01(near(p, archAt, 13) * 0.8 + near(p, mouthAt, 15) * 0.7 + lake * 0.7 + (glacier ? Math.max(0, grain - 0.5) * 2.5 : 0));
    // Basal ice carries what the glacier scraped up; the high ice is young, white and full of air.
    mask2[0] = glacier ? clamp01(Math.max(0, 1 - height / 7) * (0.4 + grain) + clamp01((margin + 9) / 6) * 0.7) : 0;
    mask2[1] = clamp01(Math.max(0, (p.y - 24) / 14) + frozen + lake * 0.45);
    mask2[2] = clamp01(lake + near(p, mouthAt, 9) * 0.6 + frozen * 0.5);
    mask2[3] = onTrail(p, trails, TRAIL_HALF_WIDTH) * up;
    return 1 - rock;
  };

  // --- Dressing -------------------------------------------------------------
  for (const [x, out, size] of front.bergs) {
    scatter(b, P(x, 0, faceZ(x, 2) + out + 2), size * 3, 14, footing, { material: 'iceBlock', size: [0.3, 1.6], blocky: 0.8 });
  }
  scatter(b, P(arch.x + 9, 0, arch.z + 5), 5, 7, footing, { material: 'iceBlock', size: [0.3, 1.2], blocky: 0.8 });
  for (const x of [-34, -8, 22, 44]) {
    scatter(b, P(x, 0, moraine.z - 5), 9, 9, footing, { material: 'rock', size: [0.4, 2.4] });
  }
  scatter(b, P(0, 0, 12), 30, 22, footing, { material: 'rock', size: [0.3, 1.5] });

  // Icicles under every overhang: the undercut, the arch, the cave mouth.
  const hang = (minX, maxX, minZ, maxZ, attempts, options) => {
    for (let index = 0; index < attempts; index += 1) {
      const x = b.range(minX, maxX), z = b.range(minZ, maxZ);
      icicleCluster(b, P(x, ground(x, z) + 1.6, z), options);
    }
  };
  hang(-52, -17, front.z - 22, front.z + 6, params.icicles, { length: [0.8, 3.4], reach: 9 });
  hang(arch.x - 5, arch.x + 5, arch.z - 5, arch.z + 5, params.icicles / 4, { length: [0.6, 2.2], reach: 12 });
  hang(front.caveX - 8, front.caveX + 8, caveZ - 12, caveZ + 4, params.icicles / 2, { length: [0.8, 3], reach: 9 });

  // Sun through the wall's two openings, standing in the cold air of the hollow behind it.
  b.sunShaft(P(arch.x - 16, 8.5, ridgeZ(arch.x - 16)), 3.4, params.shafts);
  b.sunShaft(P(arch.x, archFloor + arch.height * 0.6, arch.z), arch.width * 0.6, params.shafts * 0.7);

  // Snow sifting off the lip, and the stakes the Norths set to mark the safe line to the cave.
  for (let x = -40; x <= 40; x += 16) b.emit('sift', P(x, top(x, faceZ(x, 36)) + 0.5, faceZ(x, 36) + 1));
  b.anchor('lip', P(0, front.height, front.z));
  for (const [x, z] of params.stakes) {
    const foot = stand(x, z);
    b.prop('timber', rod(P(foot.x, foot.y - 0.3, foot.z), P(foot.x + 0.06, foot.y + 2.3, foot.z), 0.06, 0.045, 6), DARK);
    b.prop('timber', panel(P(foot.x + 0.06, foot.y + 2.05, foot.z), P(foot.x + 0.75, foot.y + 1.95, foot.z + 0.2), P(0, 1, 0), 0.34, 0.02), 0x8c2f24);
    b.nav.block(foot, 0.3, 2.3);
  }
  torch(b, stand(cave[1].x + 2.2, cave[1].z + 3), { intensity: 4, range: 13 });
  sled(b, stand(front.caveX - 6.5, caveZ + 9), 0.7);

  const entry = stand(0, moraine.z - 13);
  b.spawn('entry', entry, 0);
  b.spawn('cave', P(cave[1].x, cave[1].y, cave[1].z), Math.PI);
  b.spawn('hold', stand(wall.x - 16, 16), Math.PI / 2);
  b.exit('surface', stand(0, moraine.z - 8), { radius: 2.6, label: 'Leave the glacier' });
  b.exit('cave', cave[3], { radius: 3, label: 'Go down into the ice cave' });
  b.exit('hold', stand(wall.x - 11, 16), { radius: 3, label: 'Follow the stakes to the hold' });
}
