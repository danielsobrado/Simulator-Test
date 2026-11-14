import { beam, block, box, rod } from '../gen/propKit.js';
import { fbm3 } from '../gen/noise.js';
import { planDistance } from '../gen/plan.js';
import { column, crevasse, mound } from '../gen/shapes.js';
import { DARK, LOG, PALE, longhall, storehouse, torch } from './frostgardKit.js';
import { woodpile } from './frostgardDressing.js';
import { frozenFall, icicleCluster, scatter } from './glacierKit.js';
import { barrel, crate } from './kits.js';

/**
 * A natural ice cave under a Frostgard glacier, and the refuge inside it.
 *
 * The cave follows how glaciers make them: a wind-scoured mouth, a meltwater
 * tube that pinches to a crawl of clear ice before it opens into a hall
 * hollowed where channels met, and a crevasse that has split that hall through
 * roof and floor. People came after — and built on the bedrock at the glacier's
 * side, because a hearth cannot stand on ice.
 */

export const bounds = { min: { x: -58, y: -16, z: -106 }, max: { x: 34, y: 36, z: 30 } };

const P = (x, y, z) => ({ x, y, z });
const SKY = '#d6e8ff';
const CREVASSE_YAW = 0.5;

export function generate(b, params) {
  const mouth = P(0, 5, 22);
  const stream = [P(0.5, 2.6, 10), P(1.5, 0, 0), P(-4, -0.6, -11)];
  const squeeze = [P(-4, -0.6, -11), P(-5, -1, -22), P(-4.2, -1.8, -31)];
  const hallAt = P(-4, -2, -46);
  const refuge = P(-38, -1, -72);
  const vault = P(6, -3, -92);

  // The mouth, the meltwater tube, and the squeeze where the stream cut down through clear ice.
  b.passage(mouth, stream[0], { width: 8, height: 6.5, arch: 0.85, smooth: 1 });
  b.tube(stream, { width: 5.4, height: 5, arch: 0.9, smooth: 1, pinch: 0.3 });
  b.tube(squeeze, { width: 2.7, height: 3.3, arch: 0.95, smooth: 1.2, pinch: 0.08 });

  // The hall, and the crevasse split through its roof and floor.
  b.room(P(hallAt.x, 9, hallAt.z), { rx: 21, ry: 16, rz: 20, floorY: hallAt.y, smooth: 2, walkRadius: 0 });
  b.room(P(hallAt.x + 12, 6, hallAt.z - 8), { rx: 12, ry: 10, rz: 11, floorY: hallAt.y, smooth: 2, walkRadius: 0 });
  const cs = Math.sin(CREVASSE_YAW), cc = Math.cos(CREVASSE_YAW);
  const across = (along, offset) => P(hallAt.x + 3 + cc * along - cs * offset, hallAt.y, hallAt.z - 4 + cs * along + cc * offset);
  const split = (p) => Math.abs((p.z - hallAt.z + 4) * cc - (p.x - hallAt.x - 3) * cs);
  const lip = (along) => P(across(along, 0).x, hallAt.y - 13, across(along, 0).z);
  b.grid.carve(crevasse(lip(-20), lip(20), { topY: 34, topWidth: 5.2, bottomWidth: 2.6, wander: 0.7, seed: b.seed }), 0.8);
  // Walkable hall floor on both sides of the crevasse, joined by the plank bridge.
  b.nav.addRect(across(0, 9.5), 15, 6.3, CREVASSE_YAW);
  b.nav.addRect(across(-1, -9.5), 15, 6.3, CREVASSE_YAW);
  b.nav.addSegment(across(2, 3.6), across(2, -3.6), 1.5);

  // Ice pillars left where the hall melted out around them.
  for (const at of [across(-9, 8), across(10, 10), across(8, -11), across(-11, -8)]) {
    b.grid.fill(column(P(at.x, hallAt.y - 1, at.z), P(at.x + b.range(-1.5, 1.5), 22, at.z + b.range(-1.5, 1.5)), b.range(1.6, 2.2), b.range(2.4, 3.2)), 1.6);
    b.nav.block(at, 2.6, 6);
  }
  // Frozen fall: meltwater that came down the east wall and froze as it ran.
  const fallAt = P(hallAt.x + 21, hallAt.y, hallAt.z - 9);
  frozenFall(b, P(fallAt.x + 1.2, 13, fallAt.z), P(fallAt.x - 1.6, hallAt.y, fallAt.z), { x: 0, z: 1 });
  b.nav.block(fallAt, 4.2, 6);

  // West: the way to bedrock and the refuge.
  const choke = P(-27, -1.5, -56);
  b.passage(across(-12, 12), choke, { width: 3.6, height: 3.8, arch: 0.8, smooth: 0.8 });
  b.passage(choke, P(refuge.x + 9, refuge.y, refuge.z + 9), { width: 3.6, height: 3.8, arch: 0.8, smooth: 0.8 });
  b.room(P(refuge.x, 6, refuge.z), { rx: 15, ry: 10, rz: 15, floorY: refuge.y, smooth: 1.2, walkRadius: 12.5 });

  // North: the sealed vault.
  b.passage(across(4, -15), P(vault.x, vault.y, vault.z + 6), { width: 3, height: 3.4, arch: 0.9, smooth: 0.8 });
  b.room(P(vault.x, 3, vault.z), { rx: 9, ry: 8, rz: 9, floorY: vault.y, smooth: 1, walkRadius: 6.5 });

  // Drifted snow: blown in at the mouth, fallen through the crevasse.
  const drifts = [[P(-2.6, 3.9, 16), 3, 1.3, 5], [P(2.9, 2.2, 9), 2.4, 1, 4], [P(-2, 0.3, 2), 2, 0.7, 3]];
  for (let index = 0; index < 5; index += 1) {
    const at = across(b.range(-13, 13), b.range(-0.5, 0.5));
    drifts.push([P(at.x, hallAt.y - 13.4, at.z), 2.6, 1.6, 2.6]);
  }
  for (const at of [across(-5, 4.4), across(7, -4.2)]) drifts.push([P(at.x, at.y - 0.6, at.z), 3.2, 1.7, 2.8]);
  for (const [at, rx, ry, rz] of drifts) b.grid.fill(mound(at, rx, ry, rz), 0.8);

  // The crevasse is a clean break: noise on its narrow walls would shred them into flakes.
  const calm = (x, y, z) => (split(P(x, y, z)) < 4.5 ? 0.3 : 1);
  b.grid.roughen({ amp: 0.55, scale: 0.17, seed: b.seed, octaves: 2, floorAmp: 0.1, ampAt: calm });
  b.grid.striate({ ...params.strata, seed: b.seed + 9, ampAt: calm });
  b.grid.roughen({ amp: 0.16, scale: 0.7, seed: b.seed + 5, octaves: 2, floorAmp: 0.15, ampAt: calm });

  const near = (p, q, radius) => Math.max(0, 1 - Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) / radius);
  const channel = [...stream, ...squeeze.slice(1), across(-6, 9), across(-13, 10)];
  b.classify = (p, n, mask, mask2) => {
    const grain = fbm3(p.x * 0.11, p.y * 0.11, p.z * 0.11, b.seed + 3, 3);
    // Bedrock: the glacier's bed under the refuge, and moraine showing through the low floor.
    const bed = Math.max(0, 1 - Math.hypot(p.x - refuge.x, p.z - refuge.z) / 17) * 1.5;
    const moraine = Math.max(0, grain - 0.56) * 3 * Math.max(0, 1 - (p.y - hallAt.y) / 3);
    const rock = Math.min(1, Math.max(bed + (grain - 0.5) * 0.9, moraine * (n.y > 0.5 ? 1 : 0.4)));
    const cold = Math.max(near(p, mouth, 30), near(p, P(hallAt.x + 3, 16, hallAt.z - 4), 22) * 0.3);
    let snow = 0;
    const facingUp = Math.min(1, Math.max(0, (n.y - 0.25) / 0.45));
    for (const [at, rx] of drifts) snow = Math.max(snow, near(p, at, rx * 1.9));
    snow = Math.max(snow, near(p, mouth, 30) * 0.9) * facingUp;
    mask[0] = rock;
    mask[1] = Math.min(1, snow);
    mask[2] = Math.min(1, cold * 0.9 + Math.max(0, grain - 0.6) * 1.2);
    mask[3] = Math.min(1, Math.max(0, 1 - split(p) / 5) * 0.55 + near(p, vault, 13) + near(p, fallAt, 7) * 0.3);
    mask2[0] = Math.min(1, Math.max(0, 1 - (p.y - hallAt.y) / 4.5) * (0.35 + grain) + rock * 0.5);
    mask2[1] = Math.min(1, near(p, fallAt, 8) * 1.4 + Math.max(0, (p.y - 12) / 16) + near(p, mouth, 16) * 0.5);
    // The stream froze where it ran, and the squeeze it cut is water-smoothed all round.
    const bed2 = Math.max(0, 1 - planDistance(p, channel) / 1.5) * facingUp;
    mask2[2] = Math.min(1, bed2 + Math.max(0, 1 - planDistance(p, squeeze) / 2.4) * 0.85 + near(p, fallAt, 6) * 0.6);
    return 1 - rock;
  };

  // --- Light -------------------------------------------------------------
  // Overcast daylight at the mouth; the opening itself is a white-out.
  b.prop('glow', box(15, 12, 0.3, P(mouth.x, mouth.y + 4, mouth.z + 4.6)), SKY, 3.2);
  b.light(P(mouth.x, mouth.y + 3.4, mouth.z + 1.5), SKY, 1.3, 46, { flat: true });
  b.light(P(mouth.x, mouth.y + 2, mouth.z - 9), SKY, 0.4, 30, { flat: true });
  b.shaft(P(mouth.x, mouth.y + 5, mouth.z + 3), P(0.5, 0.4, 4), 8, SKY, 0.07);
  b.anchor('mouth', P(mouth.x, mouth.y + 2, mouth.z - 4));
  // Daylight down the crevasse, strongest where it is widest.
  for (const along of [-12, -4, 4, 12]) {
    const top = across(along, 0);
    b.light(P(top.x, 30, top.z), SKY, 0.55, 44, { flat: true });
  }
  b.prop('glow', box(36, 0.3, 3.6, P(hallAt.x + 3, 31.7, hallAt.z - 4), -CREVASSE_YAW), SKY, 3.2);
  b.shaft(P(across(3, 0).x, 31, across(3, 0).z), P(across(1, 1.5).x, hallAt.y, across(1, 1.5).z), 5, SKY, 0.06);
  b.shaft(P(across(-8, 0).x, 31, across(-8, 0).z), P(across(-9, -1).x, hallAt.y, across(-9, -1).z), 4, SKY, 0.045);
  // The sun above the glacier, reaching the cave only through the ice.
  for (const [x, z, power] of params.surfaceLight) b.light(P(x, 33, z), '#f2f8ff', power, 58, { flat: true });

  // --- The people's works --------------------------------------------------
  // Plank bridge over the crevasse, rope rails on stakes.
  for (const offset of [-0.55, 0, 0.55]) {
    const shift = (p) => P(p.x + cc * offset, p.y + 0.08, p.z + cs * offset);
    b.prop('timber', beam(shift(across(2, 4.4)), shift(across(2, -4.4)), 0.5, 0.12), LOG);
  }
  for (const end of [3.9, -3.9]) {
    for (const offset of [-0.95, 0.95]) {
      const foot = P(across(2 + offset, end).x, hallAt.y - 0.2, across(2 + offset, end).z);
      b.prop('timber', rod(foot, P(foot.x, foot.y + 1.3, foot.z), 0.07, 0.06, 6), DARK);
    }
  }
  for (const offset of [-0.95, 0.95]) {
    b.prop('timber', beam(P(across(2 + offset, 3.9).x, hallAt.y + 1, across(2 + offset, 3.9).z),
      P(across(2 + offset, -3.9).x, hallAt.y + 1, across(2 + offset, -3.9).z), 0.035), PALE);
  }
  torch(b, P(across(3.4, 4.8).x, hallAt.y, across(3.4, 4.8).z), { height: 1.05, intensity: 3.4, range: 12 });
  // Way-marker where the tube tightens: the last light before the squeeze.
  torch(b, P(squeeze[0].x + 2, squeeze[0].y - 0.1, squeeze[0].z + 1), { height: 1.4, intensity: 2.6, range: 10 });
  // A lamp set behind the ice at the end of the squeeze: thin ice glows, so the way out of the dark is marked in cyan.
  b.light(P(squeeze[2].x - 3.2, squeeze[2].y + 1.6, squeeze[2].z + 3), '#fff2d8', 5, 9, { radius: 1.4 });

  // Windbreak at the choke: a palisade of sharpened logs with a gap for one.
  for (let index = -3; index <= 3; index += 1) {
    if (index === 0 || index === 1) continue;
    const at = P(choke.x - index * 0.3, choke.y, choke.z + index * 0.42);
    b.prop('timber', rod(at, P(at.x, at.y + b.range(2.3, 2.9), at.z), 0.2, 0.05, 7), LOG);
  }
  b.prop('timber', beam(P(choke.x + 0.9, choke.y + 1.5, choke.z - 1.26), P(choke.x - 0.9, choke.y + 1.5, choke.z + 1.26), 0.14), DARK);

  longhall(b, P(refuge.x - 2, refuge.y, refuge.z - 3), params.longhall);
  // Torches on stakes mark the yard, and the cold of the ice above still reaches it.
  for (const [dx, dz] of [[9, 7], [-10, 9], [11, -3]]) torch(b, P(refuge.x + dx, refuge.y, refuge.z + dz));
  b.light(P(refuge.x, refuge.y + 8, refuge.z), '#7fb4e6', 0.5, 24, { flat: true });
  storehouse(b, P(refuge.x + 7, refuge.y, refuge.z - 8));
  woodpile(b, P(refuge.x - 8.9, refuge.y, refuge.z + 5.6));
  barrel(b, P(refuge.x + 4.4, refuge.y, refuge.z + 3.2));
  crate(b, P(refuge.x + 5.3, refuge.y, refuge.z + 3.8), 0.8, 0.4);
  b.nav.block(P(refuge.x + 4.9, refuge.y, refuge.z + 3.5), 0.9, 2);

  // The sealed vault: black standing stones the ice has grown around but not over.
  for (const [dx, dz, tall, lean] of [[0, -6.6, 6.2, 0.3], [-2.3, -6, 4.2, -0.5], [2.1, -6.2, 3.4, 0.6]]) {
    const foot = P(vault.x + dx, vault.y - 0.3, vault.z + dz);
    b.prop('seal', rod(foot, P(foot.x + lean, foot.y + tall, foot.z - 0.4), 1.1, 0.25, 5), 0xffffff);
    b.prop('clearIce', rod(P(foot.x, foot.y, foot.z + 0.2), P(foot.x + lean * 0.3, foot.y + tall * 0.45, foot.z), 1.7, 0.9, 7), 0xffffff);
    b.nav.block(foot, 1.6, 4);
  }
  b.light(P(vault.x, vault.y + 3, vault.z - 3), '#8fd0ff', 2.2, 15);
  for (const dx of [-3.4, 3.4]) {
    b.prop('masonry', block(0.7, 1.5, 0.7, P(vault.x + dx, vault.y, vault.z - 5.6)), 0xb9b4ad);
    b.prop('glow', box(0.3, 0.3, 0.3, P(vault.x + dx, vault.y + 1.7, vault.z - 5.6)), '#9fdcff', 2.5);
    b.light(P(vault.x + dx, vault.y + 1.9, vault.z - 5.6), '#9fdcff', 1.6, 9, { halo: 1.4 });
    b.nav.block(P(vault.x + dx, vault.y, vault.z - 5.6), 0.7, 2);
  }

  // Ice that came down when the crevasse opened, lying where it fell on the hall floor.
  for (const at of [across(-7, 5.5), across(9, -5.5)]) {
    scatter(b, at, 3.2, 9, () => hallAt.y, { material: 'iceBlock', size: [0.3, 1.3], blocky: 0.8 });
  }

  // Icicles wherever the roof hangs low enough to drip; over the refuge's warmth they do.
  for (let index = 0; index < params.icicles; index += 1) {
    const x = b.range(bounds.min.x + 6, bounds.max.x - 6), z = b.range(bounds.min.z + 6, bounds.max.z - 8);
    const floor = b.nav.surfaceAt(x, z, 40) ?? hallAt.y;
    const warm = Math.hypot(x - refuge.x, z - refuge.z) < 13;
    icicleCluster(b, P(x, floor + 1.9, z), { count: 4, length: [0.6, 2.8], reach: 17, drip: warm });
  }

  b.spawn('entry', P(0, 4.2, 17), 0);
  b.exit('mouth', P(mouth.x, mouth.y, mouth.z + 0.5), { radius: 3.4, label: 'Climb out onto the glacier' });
}
