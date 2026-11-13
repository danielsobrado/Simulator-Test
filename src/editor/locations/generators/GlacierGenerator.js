import { beam, block, box, rod } from '../gen/propKit.js';
import { fbm3 } from '../gen/noise.js';
import { column, hall, mound } from '../gen/shapes.js';
import { barrel, crate, lantern } from './kits.js';

/**
 * A Frostgard glacier refuge.
 *
 * The cave follows how glaciers make them: a wind-scoured mouth, a meltwater
 * tube running down-glacier, a hall hollowed where channels met, a crevasse
 * that has opened through its roof and floor. People came after — and built on
 * the bedrock at the glacier's side, because a hearth cannot stand on ice.
 */

export const bounds = { min: { x: -58, y: -16, z: -106 }, max: { x: 34, y: 36, z: 30 } };

const P = (x, y, z) => ({ x, y, z });
const SKY = '#d6e8ff';

export function generate(b, params) {
  const mouth = P(0, 5, 22), tubeEnd = P(0, 0, 0), bend = P(-5, -1, -22);
  const hallAt = P(-4, -2, -46);
  const refuge = P(-38, -1, -72);
  const vault = P(6, -3, -92);

  // Mouth and the meltwater tube.
  b.passage(mouth, tubeEnd, { width: 8, height: 6.5, arch: 0.85, smooth: 1 });
  b.passage(tubeEnd, bend, { width: 5.5, height: 5, arch: 0.9, smooth: 1 });
  b.passage(bend, P(hallAt.x, hallAt.y, hallAt.z + 14), { width: 5.5, height: 5.5, arch: 0.9, smooth: 1 });

  // The hall, and the crevasse split through its roof and floor.
  b.room(P(hallAt.x, 9, hallAt.z), { rx: 21, ry: 16, rz: 20, floorY: hallAt.y, smooth: 2, walkRadius: 0 });
  b.room(P(hallAt.x + 12, 6, hallAt.z - 8), { rx: 12, ry: 10, rz: 11, floorY: hallAt.y, smooth: 2, walkRadius: 0 });
  const crevasseYaw = 0.5;
  b.grid.carve(hall(P(hallAt.x + 3, hallAt.y - 12, hallAt.z - 4),
    { halfLength: 19, halfWidth: 1.5, height: 46, yaw: crevasseYaw }), 0.8);
  // Walkable hall floor on both sides of the crevasse, joined by the plank bridge.
  const cs = Math.sin(crevasseYaw), cc = Math.cos(crevasseYaw);
  const across = (along, offset) => P(hallAt.x + 3 + cc * along - cs * offset, hallAt.y, hallAt.z - 4 + cs * along + cc * offset);
  b.nav.addRect(across(0, 9.5), 15, 6.3, crevasseYaw);
  b.nav.addRect(across(-1, -9.5), 15, 6.3, crevasseYaw);
  const bridgeA = across(2, 3.4), bridgeB = across(2, -3.4);
  b.nav.addSegment(bridgeA, bridgeB, 1.5);

  // Ice pillars left where the hall melted out around them.
  const pillars = [across(-9, 8), across(10, 10), across(8, -11), across(-11, -8)];
  for (const at of pillars) {
    b.grid.fill(column(P(at.x, hallAt.y - 1, at.z), P(at.x + b.range(-1.5, 1.5), 22, at.z + b.range(-1.5, 1.5)), b.range(1.6, 2.2), b.range(2.4, 3.2)), 1.6);
    b.nav.block(at, 2.6, 6);
  }
  // Frozen fall: meltwater that came down the east wall and froze as it ran.
  const fallAt = P(hallAt.x + 21, hallAt.y, hallAt.z - 9);
  for (let index = 0; index < 9; index += 1) {
    const x = fallAt.x + b.range(-0.8, 0.8), z = fallAt.z + b.range(-3.5, 3.5);
    b.grid.fill(column(P(x - 1.6, hallAt.y - 0.5, z), P(x + 1.2, 13 + b.range(-2, 2), z), b.range(0.9, 1.5), b.range(0.4, 0.7)), 0.9);
  }

  // West: the way to bedrock and the refuge.
  const choke = P(-27, -1.5, -56);
  b.passage(across(-12, 12), choke, { width: 3.6, height: 3.8, arch: 0.8, smooth: 0.8 });
  b.passage(choke, P(refuge.x + 9, refuge.y, refuge.z + 9), { width: 3.6, height: 3.8, arch: 0.8, smooth: 0.8 });
  b.room(P(refuge.x, 6, refuge.z), { rx: 15, ry: 10, rz: 15, floorY: refuge.y, smooth: 1.2, walkRadius: 12.5 });

  // North: the sealed vault.
  const vaultDoor = across(4, -15);
  b.passage(vaultDoor, P(vault.x, vault.y, vault.z + 6), { width: 3, height: 3.4, arch: 0.9, smooth: 0.8 });
  b.room(P(vault.x, 3, vault.z), { rx: 9, ry: 8, rz: 9, floorY: vault.y, smooth: 1, walkRadius: 6.5 });

  // Drifted snow: blown in at the mouth, fallen through the crevasse.
  const drifts = [[P(-2.6, 3.9, 16), 3, 1.3, 5], [P(2.9, 2.2, 9), 2.4, 1, 4], [P(-2, 0.3, 2), 2, 0.7, 3]];
  for (let index = 0; index < 5; index += 1) {
    const at = across(b.range(-13, 13), b.range(-0.5, 0.5));
    drifts.push([P(at.x, hallAt.y - 13.4, at.z), 2.6, 1.6, 2.6]);
  }
  drifts.push([across(-5, 3.6), 2.6, 0.8, 2], [across(7, -3.4), 2.2, 0.7, 2.4]);
  for (const [at, rx, ry, rz] of drifts) b.grid.fill(mound(at, rx, ry, rz), 0.8);

  b.grid.roughen({ amp: 0.55, scale: 0.17, seed: b.seed, octaves: 2, floorAmp: 0.1 });
  b.grid.roughen({ amp: 0.16, scale: 0.7, seed: b.seed + 5, octaves: 2, floorAmp: 0.15 });

  const near = (p, q, radius) => Math.max(0, 1 - Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) / radius);
  b.classify = (p, n, mask, mask2) => {
    const grain = fbm3(p.x * 0.11, p.y * 0.11, p.z * 0.11, b.seed + 3, 3);
    // Bedrock: the glacier's bed under the refuge, and moraine showing through the low floor.
    const bed = Math.max(0, 1 - Math.hypot(p.x - refuge.x, p.z - refuge.z) / 17) * 1.5;
    const moraine = Math.max(0, grain - 0.56) * 3 * Math.max(0, 1 - (p.y - hallAt.y) / 3);
    const rock = Math.min(1, Math.max(bed + (grain - 0.5) * 0.9, moraine * (n.y > 0.5 ? 1 : 0.4)));
    const cold = Math.max(near(p, mouth, 30), near(p, P(hallAt.x + 3, 16, hallAt.z - 4), 22) * 0.8);
    let snow = 0;
    for (const [at, rx] of drifts) snow = Math.max(snow, near(p, at, rx * 1.9));
    snow = Math.max(snow, cold * (n.y > 0.55 ? 0.75 : 0), near(p, refuge, 16) * (n.y > 0.7 ? 0.35 : 0));
    const split = Math.abs((p.z - hallAt.z + 4) * cc - (p.x - hallAt.x - 3) * cs);
    mask[0] = rock;
    mask[1] = Math.min(1, snow);
    mask[2] = Math.min(1, cold * 0.9 + Math.max(0, grain - 0.6) * 1.2);
    mask[3] = Math.min(1, Math.max(0, 1 - split / 5) * 0.8 + near(p, vault, 13) + near(p, fallAt, 7) * 0.3);
    mask2[0] = Math.min(1, Math.max(0, 1 - (p.y - hallAt.y) / 4.5) * (0.35 + grain) + rock * 0.5);
    mask2[1] = Math.min(1, near(p, fallAt, 8) * 1.4 + Math.max(0, (p.y - 12) / 16) + near(p, mouth, 16) * 0.5);
    return 1 - rock;
  };

  // --- Light -------------------------------------------------------------
  // Overcast daylight at the mouth; the opening itself is a white-out.
  b.prop('glow', box(15, 12, 0.3, P(mouth.x, mouth.y + 4, mouth.z + 4.6)), SKY, 3.2);
  b.light(P(mouth.x, mouth.y + 3.4, mouth.z + 1.5), SKY, 2.6, 46, { flat: true });
  b.light(P(mouth.x, mouth.y + 2, mouth.z - 9), SKY, 0.8, 30, { flat: true });
  b.shaft(P(mouth.x, mouth.y + 5, mouth.z + 3), P(0.5, 0.4, 4), 8, SKY, 0.07);
  b.anchor('mouth', P(mouth.x, mouth.y + 2, mouth.z - 4));
  // Daylight down the crevasse, strongest where it is widest.
  for (const along of [-12, -4, 4, 12]) {
    const top = across(along, 0);
    b.light(P(top.x, 30, top.z), SKY, 1.7, 44, { flat: true });
  }
  b.prop('glow', box(36, 0.3, 3.6, P(hallAt.x + 3, 31.7, hallAt.z - 4), -crevasseYaw), SKY, 3.2);
  b.shaft(P(across(3, 0).x, 31, across(3, 0).z), P(across(1, 1.5).x, hallAt.y, across(1, 1.5).z), 5, SKY, 0.06);
  b.shaft(P(across(-8, 0).x, 31, across(-8, 0).z), P(across(-9, -1).x, hallAt.y, across(-9, -1).z), 4, SKY, 0.045);
  // The sun above the glacier, reaching the cave only through the ice.
  for (const [x, z, power] of [[-16, -40, 3.2], [12, -56, 3], [-2, -22, 2.2], [3, -8, 2], [10, -86, 2.4], [-18, -62, 1.6]]) {
    b.light(P(x, 33, z), '#f2f8ff', power, 40, { flat: true });
  }

  // --- The people's works --------------------------------------------------
  // Plank bridge over the crevasse, rope rails on stakes.
  const TIMBER = 0x7a5d40, DARK = 0x4d3a29;
  for (const offset of [-0.55, 0, 0.55]) {
    const shift = (p) => P(p.x + cc * offset, p.y + 0.08, p.z + cs * offset);
    b.prop('timber', beam(shift(across(2, 4.4)), shift(across(2, -4.4)), 0.5, 0.12), TIMBER);
  }
  for (const end of [3.9, -3.9]) {
    for (const offset of [-0.95, 0.95]) {
      const foot = P(across(2 + offset, end).x, hallAt.y - 0.2, across(2 + offset, end).z);
      b.prop('timber', rod(foot, P(foot.x, foot.y + 1.3, foot.z), 0.07, 0.06, 6), DARK);
    }
  }
  for (const offset of [-0.95, 0.95]) {
    b.prop('timber', beam(P(across(2 + offset, 3.9).x, hallAt.y + 1, across(2 + offset, 3.9).z),
      P(across(2 + offset, -3.9).x, hallAt.y + 1, across(2 + offset, -3.9).z), 0.035), 0x9c8a6a);
  }
  lantern(b, P(across(3.4, 4.6).x, hallAt.y + 1.25, across(3.4, 4.6).z), { tint: '#ffa257', intensity: 3.4, range: 12, halo: 1.3 });
  b.prop('timber', rod(P(across(3.4, 4.6).x, hallAt.y, across(3.4, 4.6).z), P(across(3.4, 4.6).x, hallAt.y + 1.05, across(3.4, 4.6).z), 0.06, 0.06, 6), DARK);

  // Way-marker torch where the tube meets the hall.
  lantern(b, P(bend.x + 2.2, bend.y + 1.6, bend.z - 2), { tint: '#ffa257', intensity: 2.6, range: 10, halo: 1.2 });
  b.prop('timber', rod(P(bend.x + 2.2, bend.y - 0.2, bend.z - 2), P(bend.x + 2.2, bend.y + 1.4, bend.z - 2), 0.06, 0.05, 6), DARK);

  // Windbreak at the choke: a palisade of sharpened logs with a gap for one.
  for (let index = -3; index <= 3; index += 1) {
    if (index === 0 || index === 1) continue;
    const at = P(choke.x - index * 0.3, choke.y, choke.z + index * 0.42);
    b.prop('timber', rod(at, P(at.x, at.y + b.range(2.3, 2.9), at.z), 0.2, 0.05, 7), TIMBER);
  }
  b.prop('timber', beam(P(choke.x + 0.9, choke.y + 1.5, choke.z - 1.26), P(choke.x - 0.9, choke.y + 1.5, choke.z + 1.26), 0.14), DARK);

  longhall(b, P(refuge.x - 2, refuge.y, refuge.z - 3), params.longhall);
  storehouse(b, P(refuge.x + 7, refuge.y, refuge.z - 8));
  // Woodpile, sled, stores by the door.
  for (let row = 0; row < 3; row += 1) {
    for (let index = 0; index < 5 - row; index += 1) {
      const z = refuge.z + 5.6 + index * 0.36 + row * 0.18;
      b.prop('timber', rod(P(refuge.x - 9.5, refuge.y + 0.17 + row * 0.31, z), P(refuge.x - 8.3, refuge.y + 0.17 + row * 0.31, z), 0.17, 0.17, 7), 0x8d7150);
    }
  }
  b.nav.block(P(refuge.x - 8.9, refuge.y, refuge.z + 6.3), 1.2, 2);
  barrel(b, P(refuge.x + 4.4, refuge.y, refuge.z + 3.2));
  crate(b, P(refuge.x + 5.3, refuge.y, refuge.z + 3.8), 0.8, 0.4);
  b.nav.block(P(refuge.x + 4.9, refuge.y, refuge.z + 3.5), 0.9, 2);
  for (const dx of [-0.35, 0.35]) {
    b.prop('timber', beam(P(refuge.x + 3 + dx, refuge.y + 0.08, refuge.z + 8), P(refuge.x + 3 + dx, refuge.y + 0.3, refuge.z + 10.2), 0.07, 0.1), DARK);
  }
  b.prop('timber', box(0.8, 0.06, 1.6, P(refuge.x + 3, refuge.y + 0.3, refuge.z + 9)), TIMBER);

  // The sealed vault: something dark stands in the far wall, behind a pane of clear ice.
  b.prop('seal', rod(P(vault.x, vault.y + 0.2, vault.z - 8.2), P(vault.x, vault.y + 6.4, vault.z - 8.6), 1.5, 0.5, 6), 0x1c1a20);
  b.prop('clearIce', box(7.5, 7.5, 0.5, P(vault.x, vault.y + 3.6, vault.z - 7.2)), 0xffffff);
  b.light(P(vault.x, vault.y + 2.6, vault.z - 3.5), '#8fd0ff', 1.3, 13, { halo: 0 });
  for (const dx of [-3.4, 3.4]) {
    b.prop('masonry', block(0.7, 1.5, 0.7, P(vault.x + dx, vault.y, vault.z - 5.6)), 0xb9b4ad);
    b.prop('glow', box(0.3, 0.3, 0.3, P(vault.x + dx, vault.y + 1.7, vault.z - 5.6)), '#9fdcff', 2.5);
    b.light(P(vault.x + dx, vault.y + 1.9, vault.z - 5.6), '#9fdcff', 1.6, 9, { halo: 1.4 });
    b.nav.block(P(vault.x + dx, vault.y, vault.z - 5.6), 0.7, 2);
  }

  // Icicles wherever the roof hangs low enough to drip.
  for (let index = 0; index < params.icicles; index += 1) {
    const x = b.range(bounds.min.x + 6, bounds.max.x - 6), z = b.range(bounds.min.z + 6, bounds.max.z - 8);
    const floor = b.nav.surfaceAt(x, z, 40);
    if (floor === null && b.grid.sample(x, hallAt.y + 2, z) < 0.5) continue;
    const base = floor ?? hallAt.y;
    const roof = b.probe(x, base + 1.6, z, 1, 30);
    if (roof === null || roof - base > 19 || b.grid.sample(x, base + 1.6, z) < 0) continue;
    for (let twin = 0; twin < 3; twin += 1) {
      const dx = b.range(-0.5, 0.5), dz = b.range(-0.5, 0.5), length = b.range(0.5, 2.4) * Math.min(1, (roof - base) / 5);
      const top = (b.probe(x + dx, roof - 0.8, z + dz, 1, 4) ?? roof) + 0.25;
      b.prop('clearIce', rod(P(x + dx, top - length, z + dz), P(x + dx, top, z + dz), 0.015, b.range(0.07, 0.16), 6), 0xffffff);
    }
  }

  b.spawn('entry', P(0, 4.2, 17), 0);
  b.exit('mouth', P(mouth.x, mouth.y, mouth.z + 0.5), { radius: 3.4, label: 'Climb out onto the glacier' });
}

/** A Norths longhall on a rubble plinth: hewn-log walls, a steep roof, the hearth showing at the door. */
function longhall(b, at, { length, width, wallHeight, roofRise }) {
  const TIMBER = 0x7f6243, DARK = 0x4d3a29, HEARTH = '#ff9a45';
  const P3 = (dx, dy, dz) => P(at.x + dx, at.y + dy, at.z + dz);
  b.prop('masonry', block(length + 0.8, 0.9, width + 0.8, P3(0, 0, 0)), 0xa8a39b);
  const logs = Math.round(wallHeight / 0.36);
  for (let row = 0; row < logs; row += 1) {
    const y = 1.08 + row * 0.36, over = row % 2 ? 0.25 : 0;
    for (const dz of [-width / 2, width / 2]) {
      // The door breaks the front wall's lower courses.
      if (dz > 0 && y < 3) {
        b.prop('timber', rod(P3(-length / 2 - over, y, dz), P3(-0.9, y, dz), 0.19, 0.19, 7), TIMBER);
        b.prop('timber', rod(P3(0.9, y, dz), P3(length / 2 + over, y, dz), 0.19, 0.19, 7), TIMBER);
      } else {
        b.prop('timber', rod(P3(-length / 2 - over, y, dz), P3(length / 2 + over, y, dz), 0.19, 0.19, 7), TIMBER);
      }
    }
    for (const dx of [-length / 2, length / 2]) {
      b.prop('timber', rod(P3(dx, y + 0.18, -width / 2 - 0.25 + over), P3(dx, y + 0.18, width / 2 + 0.25 - over), 0.19, 0.19, 7), TIMBER);
    }
  }
  const eave = 0.9 + wallHeight, ridge = eave + roofRise, overhang = 0.9;
  for (const sign of [-1, 1]) {
    for (let index = 0; index <= 10; index += 1) {
      const x = -length / 2 - 0.5 + (length + 1) * index / 10;
      b.prop('timber', beam(P3(x, eave - 0.25, sign * (width / 2 + overhang)), P3(x, ridge, 0), 0.16, 0.2), DARK);
    }
    // Sod and snow over plank sheathing.
    b.prop('roof', beam(P3(0, eave - 0.05, sign * (width / 2 + overhang)), P3(0, ridge + 0.2, sign * 0.05), length + 1.6, 0.34), 0xffffff);
    for (const end of [-1, 1]) {
      b.prop('timber', beam(P3(end * (length / 2 + 0.75), eave - 0.2, sign * (width / 2 + overhang)), P3(end * (length / 2 + 0.75), ridge + 0.25, 0), 0.12, 0.3), DARK);
    }
  }
  b.prop('timber', beam(P3(-length / 2 - 0.9, ridge + 0.1, 0), P3(length / 2 + 0.9, ridge + 0.1, 0), 0.3), DARK);
  for (const end of [-1, 1]) {
    for (let row = 0; row < 6; row += 1) {
      const y = eave + 0.1 + row * 0.36, half = (width / 2) * (1 - (y - eave) / roofRise);
      if (half < 0.3) break;
      b.prop('timber', rod(P3(end * length / 2, y, -half), P3(end * length / 2, y, half), 0.19, 0.19, 7), 0x7f6243);
    }
  }
  // Smoke vent on the ridge and the door standing open on the fire.
  b.prop('timber', block(1.5, 0.9, 1.1, P3(length * 0.15, ridge - 0.1, 0)), DARK);
  b.prop('timber', box(0.14, 2.3, 0.14, P3(-0.95, 2.05, width / 2 + 0.05)), DARK);
  b.prop('timber', box(0.14, 2.3, 0.14, P3(0.95, 2.05, width / 2 + 0.05)), DARK);
  b.prop('timber', box(2.2, 0.2, 0.2, P3(0, 3.25, width / 2 + 0.05)), DARK);
  b.prop('timber', box(0.1, 2.2, 1.3, P3(1.55, 2, width / 2 + 0.7), 0.35), 0x5d4631);
  b.prop('glow', box(1.7, 2.2, 0.1, P3(0, 2, width / 2 - 0.3)), HEARTH, 2.6);
  b.light(P3(0, 2.2, width / 2 + 1.4), HEARTH, 9, 22, { radius: 1.6, halo: 3.4 });
  for (const dx of [-length * 0.32, length * 0.32]) {
    b.prop('glow', box(0.6, 0.5, 0.1, P3(dx, 2.5, width / 2 + 0.22)), HEARTH, 2);
    b.prop('timber', box(0.8, 0.1, 0.16, P3(dx, 2.2, width / 2 + 0.24)), DARK);
    b.light(P3(dx, 2.5, width / 2 + 1), HEARTH, 2.4, 10, { halo: 1.2 });
  }
  // Steps down from the plinth.
  b.prop('masonry', block(2.4, 0.6, 0.8, P3(0, 0, width / 2 + 0.8)), 0xa8a39b);
  b.prop('masonry', block(2.4, 0.3, 0.8, P3(0, 0, width / 2 + 1.6)), 0xa8a39b);
  b.light(P3(length * 0.15, ridge + 1.5, 0), HEARTH, 1.2, 9, { halo: 0 });
  b.nav.addRect(P3(0, 0.3, width / 2 + 1.6), 1.2, 0.4);
  b.nav.addRect(P3(0, 0.6, width / 2 + 0.8), 1.2, 0.4);
  b.nav.block(P3(-length * 0.27, 0, 0), width * 0.62, 6);
  b.nav.block(P3(length * 0.27, 0, 0), width * 0.62, 6);
  b.nav.block(P3(0, 0, -0.6), width * 0.62, 6);
}

/** A raised store on staddle posts, heated from the hall side. */
function storehouse(b, at) {
  const TIMBER = 0x86694a, DARK = 0x4d3a29;
  for (const [dx, dz] of [[-1.6, -1.2], [1.6, -1.2], [-1.6, 1.2], [1.6, 1.2]]) {
    b.prop('masonry', block(0.6, 0.8, 0.6, P(at.x + dx, at.y, at.z + dz)), 0xa8a39b);
  }
  b.prop('timber', block(4.2, 2.3, 3.2, P(at.x, at.y + 0.8, at.z)), TIMBER);
  for (const sign of [-1, 1]) {
    b.prop('roof', beam(P(at.x, at.y + 3, at.z + sign * 2.2), P(at.x, at.y + 4.5, at.z + sign * 0.04), 4.9, 0.3), 0xffffff);
  }
  b.prop('timber', beam(P(at.x - 2.5, at.y + 4.45, at.z), P(at.x + 2.5, at.y + 4.45, at.z), 0.22), DARK);
  b.prop('timber', box(0.9, 1.5, 0.1, P(at.x, at.y + 1.6, at.z + 1.63)), DARK);
  b.prop('timber', beam(P(at.x, at.y, at.z + 3), P(at.x, at.y + 0.85, at.z + 1.7), 0.8, 0.08), DARK);
  b.nav.block(at, 2.9, 5);
}
