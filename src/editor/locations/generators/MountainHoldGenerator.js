import { arch, beam, block, box, coursedWall, hewnBeam, rod, stoneBlock, stoneBox } from '../gen/propKit.js';
import { hall, shaft } from '../gen/shapes.js';
import { brazier, bridge, crate, pillar, stairs } from './kits.js';

/**
 * A Stonehold mountain hold: everything is cut, squared and carried on
 * something. A gate hall behind bronze doors opens on a vaulted avenue whose
 * piers are the rock the masons left standing; galleries of dwellings run along
 * both walls above the aisles; a chasm crosses the floor under a stone bridge;
 * and the avenue ends at the forges, where the mountain's ore comes up a lift.
 */

export const bounds = { min: { x: -34, y: -20, z: -148 }, max: { x: 34, y: 30, z: 12 } };

const P = (x, y, z) => ({ x, y, z });
const ALONG_Z = Math.PI / 2;
const WARM = '#ffb066';

export function generate(b, params) {
  const { halfLength, halfWidth, height, vaultRise, pillarSpacing, pillarRadius } = params.avenue;
  const forgeTint = params.forgeTint;
  const avenueZ = -20 - halfLength;
  const farZ = avenueZ - halfLength;
  const galleryY = 7, galleryX = halfWidth + 4;
  const chasm = { z: avenueZ, half: 3.4, depth: 17 };
  const forge = P(0, 0, farZ - 14);
  const lift = P(19, 0, forge.z);

  b.grid.carve(hall(P(0, 0, -9), { halfLength: 13, halfWidth: 8, height: 8, vaultRise: 4, yaw: ALONG_Z }));
  b.grid.carve(hall(P(0, 0, avenueZ), { halfLength, halfWidth, height, vaultRise, yaw: ALONG_Z }));
  for (const sign of [-1, 1]) {
    b.grid.carve(hall(P(sign * galleryX, galleryY, avenueZ), { halfLength: halfLength - 4, halfWidth: 4.4, height: 4, vaultRise: 1.2, yaw: ALONG_Z }));
  }
  b.grid.carve(hall(P(0, -chasm.depth, chasm.z), { halfLength: halfWidth + 0.5, halfWidth: chasm.half, height: chasm.depth }));
  b.passage(P(0, 0, farZ + 4), P(0, 0, farZ - 5), { width: 9, height: 8.5, arch: 0.35 });
  b.grid.carve(hall(forge, { halfLength: 25, halfWidth: 12, height: 9, vaultRise: 5 }));
  b.grid.carve(shaft(lift, { radius: 3, bottomY: -18, topY: 13 }));
  b.grid.roughen({ amp: 0.4, scale: 0.4, seed: b.seed, octaves: 2, ampAt: (x, y) => (y < -1 ? 1 : 0.07) });

  // Floors.
  b.nav.addRect(P(0, 0, -8), 7.2, 11.4);
  const before = (-20 + chasm.z + chasm.half) / 2, after = (chasm.z - chasm.half + farZ) / 2;
  b.nav.addRect(P(0, 0, before), halfWidth - 0.8, (-20 - (chasm.z + chasm.half)) / 2 + 0.6);
  b.nav.addRect(P(0, 0, after), halfWidth - 0.8, ((chasm.z - chasm.half) - farZ) / 2);
  b.nav.addRect(forge, 24, 11.2);
  b.nav.block(lift, 3.9, 4);

  const furnaces = [-14, 0, 14].map((x) => P(x, 0, forge.z - 9.6));
  b.classify = (p, n, mask) => {
    let soot = 0;
    for (const at of furnaces) soot = Math.max(soot, 1 - Math.hypot(p.x - at.x, (p.y - 4) * 0.5, p.z - at.z) / 11);
    mask[1] = Math.min(1, Math.max(0, (-6 - p.y) / 8));
    mask[2] = Math.max(0, soot) + (p.z < farZ - 2 ? 0.25 : 0);
    // Living rock in the chasm and the lift shaft; everything else is dressed.
    mask[3] = p.y < -0.8 ? 0 : 1;
    return 0;
  };

  // --- Gate ---------------------------------------------------------------
  for (const sign of [-1, 1]) {
    const gx = sign * 5.2;
    b.prop('masonry', stoneBlock(2.7, 1.1, 1.9, P(gx, 0, 3.4), { bevel: 0.08, batter: 0.16, irregular: 0.28 }));
    b.prop('masonry', coursedWall(P(gx - 1.2, 1.1, 3.4), P(gx + 1.2, 1.1, 3.4), 7.2, 1.6, {
      courseHeight: 0.72, stoneWidth: 1.05, irregular: 0.36, quoins: true, bevel: 0.06,
    }));
    b.prop('masonry', stoneBlock(2.65, 0.7, 1.85, P(gx, 8.3, 3.4), { bevel: 0.07, batter: -0.08, irregular: 0.22 }));
  }
  b.prop('masonry', arch(P(-4, 7, 3.4), P(4, 7, 3.4), 3, 1.2, 1.6, 11));
  for (const sign of [-1, 1]) {
    b.prop('bronze', stoneBox(3.9, 9.6, 0.44, P(sign * 2, 4.8, 3.9), { bevel: 0.04, irregular: 0.06 }), 0xffffff);
    // Recessed coffer framing stiles on each bronze gate leaf.
    for (const dx of [-1.6, 1.6]) {
      b.prop('bronze', stoneBox(0.32, 9.2, 0.56, P(sign * 2 + dx, 4.8, 3.88), { bevel: 0.03, irregular: 0.05 }), 0xe8d0a8);
    }
    for (const y of [1.2, 3.6, 6, 8.2]) {
      b.prop('iron', stoneBox(3.75, 0.36, 0.6, P(sign * 2, y, 3.86), { bevel: 0.03, irregular: 0.08 }), 0x2b2724);
    }
    b.prop('bronze', rod(P(sign * 0.55, 3.4, 3.55), P(sign * 0.55, 4.2, 3.55), 0.14, 0.14, 8), 0xe0b070);
  }
  for (const sign of [-1, 1]) {
    pillar(b, P(sign * 5.2, 0, -6), 8, 1.1);
    pillar(b, P(sign * 5.2, 0, -15), 8, 1.1);
    brazier(b, P(sign * 3.2, 0, -1.5), { intensity: 7, range: 16 });
  }
  b.prop('masonry', arch(P(-5.2, 8, -6), P(5.2, 8, -6), 3.2, 0.9, 1.3, 11));
  b.prop('masonry', arch(P(-5.2, 8, -15), P(5.2, 8, -15), 3.2, 0.9, 1.3, 11));

  // --- The avenue ---------------------------------------------------------
  const rowX = halfWidth * 0.57;
  const bays = [];
  for (let z = -20 - pillarSpacing / 2; z > farZ + 2; z -= pillarSpacing) bays.push(z);
  for (const sign of [-1, 1]) {
    bays.forEach((z, index) => {
      pillar(b, P(sign * rowX, 0, z), height, pillarRadius);
      // Aisle rib to the wall, and the arcade to the next pier.
      b.prop('masonry', arch(P(sign * rowX, height, z), P(sign * (halfWidth + 0.3), height, z), 2.6, 0.8, 1.2, 7));
      if (index < bays.length - 1) {
        const next = bays[index + 1];
        b.prop('masonry', arch(P(sign * rowX, height - 4, z - pillarRadius), P(sign * rowX, height - 4, next + pillarRadius), 3.3, 0.9, 1.5, 9));
      }
    });
    b.prop('masonry', stoneBox(1.7, 1.1, halfLength * 2 - 2, P(sign * rowX, height + 0.25, avenueZ), { bevel: 0.08, irregular: 0.12 }));
    // Wall dressings: segmented coursed plinth, corbelled gallery sill, pilastered parapet, springing cornice.
    b.prop('masonry', coursedWall(P(sign * (halfWidth - 0.2), 0, avenueZ - halfLength), P(sign * (halfWidth - 0.2), 0, avenueZ + halfLength), 1.15, 0.72, {
      courseHeight: 0.55, stoneWidth: 1.6, irregular: 0.28, bevel: 0.06,
    }));
    b.prop('masonry', coursedWall(P(sign * (halfWidth - 0.15), galleryY - 0.5, avenueZ - halfLength + 4), P(sign * (halfWidth - 0.15), galleryY - 0.5, avenueZ + halfLength - 4), 0.52, 0.9, {
      courseHeight: 0.52, stoneWidth: 1.5, irregular: 0.22, bevel: 0.05,
    }));
    b.prop('masonry', coursedWall(P(sign * (halfWidth + 0.25), galleryY, avenueZ - halfLength + 4), P(sign * (halfWidth + 0.25), galleryY, avenueZ + halfLength - 4), 1.05, 0.46, {
      courseHeight: 0.38, stoneWidth: 1.1, irregular: 0.32, bevel: 0.04,
    }));
    b.prop('masonry', stoneBox(1, 0.8, halfLength * 2, P(sign * (halfWidth - 0.3), height + 0.2, avenueZ), { bevel: 0.07, irregular: 0.12 }));
    b.nav.addRect(P(sign * (galleryX + 0.3), galleryY, avenueZ), 3.4, halfLength - 4.6);

    // Gallery dwellings: coursed stone bays with corner pilasters, framed doors, and stone-dressed mullioned windows.
    for (let z = -20 - 8; z > farZ + 8; z -= 6) {
      const wall = sign * (galleryX + 4.3);
      b.prop('masonry', stoneBlock(0.62, 4.1, 0.78, P(sign * (halfWidth + 0.25), galleryY + 0.5, z + 3), {
        bevel: 0.05, batter: 0.06, irregular: 0.24,
      }));
      b.prop('masonry', coursedWall(P(wall, galleryY, z - 2.6), P(wall, galleryY, z + 2.6), 4.2, 0.32, {
        courseHeight: 0.52, stoneWidth: 0.95, irregular: 0.38, quoins: true, bevel: 0.04,
      }));
      if (Math.round(z / 6) % 2 === 0) {
        b.prop('timber', stoneBox(0.22, 2.1, 1.1, P(wall - sign * 0.08, galleryY + 1.05, z), { bevel: 0.02, irregular: 0.14 }), 0x4a3524);
        for (const dz of [-0.62, 0.62]) {
          b.prop('timber', stoneBlock(0.26, 2.22, 0.18, P(wall - sign * 0.1, galleryY, z + dz), { bevel: 0.025, irregular: 0.2 }), 0x5c422d);
        }
        b.prop('bronze', stoneBox(0.28, 0.16, 1.5, P(wall - sign * 0.12, galleryY + 2.22, z), { bevel: 0.025, irregular: 0.1 }), 0xffffff);
      } else {
        b.prop('glow', box(0.12, 1, 0.7, P(wall - sign * 0.08, galleryY + 1.8, z)), WARM, 2.4);
        b.prop('masonry', stoneBox(0.26, 0.14, 0.96, P(wall - sign * 0.12, galleryY + 1.24, z), { bevel: 0.02, irregular: 0.18 }));
        b.prop('masonry', stoneBox(0.24, 0.18, 1.04, P(wall - sign * 0.12, galleryY + 2.38, z), { bevel: 0.02, irregular: 0.18 }));
        b.prop('iron', box(0.06, 1.0, 0.06, P(wall - sign * 0.14, galleryY + 1.8, z)), 0x2b2724);
        b.prop('iron', box(0.06, 0.06, 0.72, P(wall - sign * 0.14, galleryY + 1.85, z)), 0x2b2724);
        b.light(P(wall - sign * 0.9, galleryY + 1.9, z), WARM, 2.2, 10, { halo: 1.1 });
      }
    }
    // Stair from the aisle to the gallery, with its coursed stone landing pier.
    const foot = P(sign * (halfWidth - 1.9), 0, -23), head = P(sign * (halfWidth - 1.9), galleryY, -37);
    stairs(b, foot, head, 2.2);
    b.prop('masonry', stoneBox(4.4, 0.6, 3, P(sign * (halfWidth - 0.6), galleryY - 0.3, -38.4), { bevel: 0.05, irregular: 0.18 }));
    b.prop('masonry', stoneBlock(2.5, galleryY - 0.6, 3.1, P(sign * (halfWidth - 1.9), 0, -38.4), { bevel: 0.08, batter: 0.08, irregular: 0.24 }));
    b.nav.addRect(P(sign * (halfWidth - 0.4), galleryY, -38.4), 2.4, 1.3);
    b.nav.block(P(sign * (halfWidth - 1.9), 0, -38.6), 1.7, 6);
  }
  // Great ribs across the nave on every pier pair.
  for (const z of bays) {
    b.prop('masonry', arch(P(-rowX, height + 0.6, z), P(rowX, height + 0.6, z), vaultRise - 1.4, 1, 1.5, 15));
  }
  for (const z of [bays[1], bays[3], bays[5], bays[7]]) {
    if (z === undefined) continue;
    for (const sign of [-1, 1]) brazier(b, P(sign * (rowX - 3.2), 0, z + 6), { tint: '#ff8f3f', intensity: 10, range: 22, size: 1.15 });
  }

  // --- The chasm and its bridge -------------------------------------------
  bridge(b, P(0, 0, chasm.z + chasm.half + 0.6), P(0, 0, chasm.z - chasm.half - 0.6), 6.4, { footY: -chasm.depth, spans: 1, parapet: 1.1 });
  for (const sign of [-1, 1]) {
    for (const x of [-halfWidth + 0.5, -3.6, 3.6, halfWidth - 0.5]) {
      const end = Math.abs(x) < 4 ? Math.sign(x) * (halfWidth - 0.5) : null;
      if (end !== null) {
        const pz = chasm.z + sign * (chasm.half + 0.3);
        b.prop('masonry', coursedWall(P(x, 0, pz), P(end, 0, pz), 1.0, 0.45, {
          courseHeight: 0.36, stoneWidth: 0.78, irregular: 0.35, bevel: 0.04,
        }));
        b.prop('masonry', hewnBeam(P(x, 1.06, pz), P(end, 1.06, pz), 0.54, 0.16, { bevel: 0.035, irregular: 0.18 }));
      }
    }
  }
  b.prop('glow', box(halfWidth * 2, 0.2, 1.6, P(0, -chasm.depth + 0.3, chasm.z)), forgeTint, 3);
  for (const x of [-9, 0, 9]) b.light(P(x, -chasm.depth + 2, chasm.z), forgeTint, 1.4, 24, { flat: true });

  // --- The Great Anvil under the ring of fires -----------------------------
  const dais = P(0, 0, (chasm.z - chasm.half + farZ) / 2 - 2);
  b.prop('masonry', stoneBlock(11, 0.45, 11, dais, { bevel: 0.06, batter: 0.08, irregular: 0.18 }));
  b.prop('masonry', stoneBlock(8.6, 0.45, 8.6, P(dais.x, 0.45, dais.z), { bevel: 0.06, batter: 0.08, irregular: 0.18 }));
  b.prop('masonry', stoneBlock(6.2, 0.45, 6.2, P(dais.x, 0.9, dais.z), { bevel: 0.06, batter: 0.08, irregular: 0.18 }));
  b.prop('masonry', stoneBlock(2.7, 1.3, 1.9, P(dais.x, 1.35, dais.z), { bevel: 0.07, batter: 0.12, irregular: 0.22 }));
  b.prop('iron', stoneBlock(2.25, 0.5, 1.25, P(dais.x, 2.65, dais.z), { bevel: 0.05, batter: 0.1, irregular: 0.1 }), 0x3a3531);
  b.prop('iron', stoneBlock(1.25, 0.55, 0.95, P(dais.x, 3.15, dais.z), { bevel: 0.05, irregular: 0.08 }), 0x3a3531);
  b.prop('iron', stoneBlock(3.8, 0.75, 1.3, P(dais.x, 3.7, dais.z), { bevel: 0.06, batter: -0.06, irregular: 0.08 }), 0x45403b);
  b.prop('iron', rod(P(dais.x + 1.9, 4.08, dais.z), P(dais.x + 3.4, 4.2, dais.z), 0.5, 0.08, 8), 0x45403b);
  for (const [dx, dz] of [[-4.2, -4.2], [4.2, -4.2], [-4.2, 4.2], [4.2, 4.2]]) {
    b.prop('masonry', stoneBlock(0.95, 1.2, 0.95, P(dais.x + dx, 0.45, dais.z + dz), { bevel: 0.06, batter: 0.12, irregular: 0.2 }));
    b.prop('masonry', rod(P(dais.x + dx, 1.65, dais.z + dz), P(dais.x + dx, 7.5, dais.z + dz), 0.65, 0.38, 4));
    b.prop('bronze', rod(P(dais.x + dx, 7.5, dais.z + dz), P(dais.x + dx, 8.2, dais.z + dz), 0.42, 0.05, 4), 0xffffff);
  }
  b.nav.block(dais, 6.6, 9);
  const ringY = height + 1.5, ringRadius = 6.2;
  for (let index = 0; index < 12; index += 1) {
    const a0 = index / 12 * Math.PI * 2, a1 = (index + 1) / 12 * Math.PI * 2;
    const on = (a, y) => P(dais.x + Math.cos(a) * ringRadius, y, dais.z + Math.sin(a) * ringRadius);
    b.prop('iron', hewnBeam(on(a0, ringY), on(a1, ringY), 0.3, 0.45, { bevel: 0.03, irregular: 0.08 }), 0x2b2724);
    b.prop('iron', rod(on(a0, ringY + 0.2), on(a0, ringY + 0.55), 0.3, 0.5, 8), 0x2b2724);
    b.prop('glow', rod(on(a0, ringY + 0.5), on(a0, ringY + 0.85), 0.42, 0.06, 7), '#ff8f3f', 5);
    b.light(on(a0, ringY + 1), '#ff8f3f', 3.4, 20, { halo: 1.8 });
    if (index % 3 === 0) b.prop('iron', rod(on(a0, ringY), P(dais.x + Math.cos(a0) * 1.5, height + vaultRise - 0.4, dais.z + Math.sin(a0) * 1.5), 0.04, 0.04, 5), 0x1f1c1a);
  }

  // --- The forges -----------------------------------------------------------
  for (const at of furnaces) {
    b.prop('masonry', stoneBlock(5.5, 4.6, 3.6, at, { bevel: 0.08, batter: 0.06, irregular: 0.28 }));
    b.prop('masonry', coursedWall(P(at.x - 2.65, 0, at.z + 1.82), P(at.x + 2.65, 0, at.z + 1.82), 4.5, 0.32, {
      courseHeight: 0.52, stoneWidth: 0.85, irregular: 0.42, quoins: true, bevel: 0.05,
    }));
    b.prop('masonry', stoneBlock(4.1, 1.6, 2.9, P(at.x, 4.6, at.z), { bevel: 0.08, batter: 0.12, irregular: 0.26 }));
    b.prop('masonry', stoneBlock(2.3, 9, 2.3, P(at.x, 6.2, at.z - 0.2), { bevel: 0.08, batter: 0.08, irregular: 0.26 }));
    b.prop('masonry', arch(P(at.x - 1.4, 0.4, at.z + 1.85), P(at.x + 1.4, 0.4, at.z + 1.85), 1.7, 0.52, 0.52, 9));
    b.prop('glow', box(2.3, 1.7, 0.2, P(at.x, 1.1, at.z + 1.75)), forgeTint, 4.5);
    b.prop('iron', stoneBox(5.7, 0.26, 3.9, P(at.x, 3.2, at.z), { bevel: 0.03, irregular: 0.06 }), 0x2b2724);
    b.light(P(at.x, 1.6, at.z + 3.2), forgeTint, 15, 28, { radius: 2, halo: 4.5 });
    b.nav.block(at, 3.4, 6);
    // Anvil on its chamfered timber block, beveled stone quench trough beside it.
    const work = P(at.x + 1.2, 0, at.z + 6);
    b.prop('timber', rod(work, P(work.x, 0.6, work.z), 0.44, 0.4, 9), 0x6a5038);
    b.prop('iron', stoneBlock(0.92, 0.3, 0.42, P(work.x, 0.6, work.z), { bevel: 0.03, batter: 0.08, irregular: 0.08 }), 0x45403b);
    b.prop('iron', rod(P(work.x + 0.45, 0.78, work.z), P(work.x + 0.85, 0.82, work.z), 0.14, 0.03, 6), 0x45403b);
    b.nav.block(work, 0.75, 2);
    b.prop('masonry', stoneBlock(2.25, 0.72, 0.95, P(at.x - 2.6, 0, at.z + 5.4), { bevel: 0.05, batter: 0.08, irregular: 0.24 }));
    b.prop('iron', stoneBox(1.9, 0.06, 0.6, P(at.x - 2.6, 0.66, at.z + 5.4), { bevel: 0.015, irregular: 0.05 }), 0x10161a);
    b.nav.block(P(at.x - 2.6, 0, at.z + 5.4), 1.2, 2);
  }
  // Coal and irregular ore/slag heaps between the furnaces.
  for (const x of [-7, 7]) {
    for (const [ox, oy, oz, s] of [[0, 0.55, 0, 1.15], [-0.55, 0.35, 0.45, 0.72], [0.5, 0.32, -0.4, 0.68], [0.2, 0.85, 0.15, 0.6]]) {
      b.prop('masonry', stoneBox(s * 1.1, s * 0.75, s, P(x + ox, oy, forge.z - 9 + oz), {
        yaw: ox * 2 + oz, bevel: s * 0.2, irregular: 0.65,
      }), 0x1b1917);
    }
    b.nav.block(P(x, 0, forge.z - 9), 2, 2);
    crate(b, P(x + 2.4, 0, forge.z - 5.5), 0.9, 0.3);
    b.nav.block(P(x + 2.4, 0, forge.z - 5.5), 0.7, 2);
  }
  // Great lintel over the way into the forge, with coursed stone piers.
  for (const px of [-5.6, 5.6]) {
    b.prop('masonry', stoneBlock(2.05, 1.1, 1.85, P(px, 0, farZ - 0.5), { bevel: 0.07, batter: 0.14, irregular: 0.25 }));
    b.prop('masonry', stoneBlock(1.85, 8.3, 1.65, P(px, 1.1, farZ - 0.5), { bevel: 0.07, irregular: 0.22 }));
  }
  b.prop('masonry', stoneBox(13.4, 1.5, 1.8, P(0, 9.9, farZ - 0.5), { bevel: 0.08, irregular: 0.16 }));
  b.prop('bronze', stoneBox(7, 0.7, 0.22, P(0, 9.9, farZ + 0.45), { bevel: 0.03, irregular: 0.08 }), 0xffffff);

  // --- Ore lift ---------------------------------------------------------------
  for (const [dx, dz] of [[-3.3, -3.3], [3.3, -3.3], [-3.3, 3.3], [3.3, 3.3]]) {
    b.prop('masonry', stoneBlock(0.95, 0.5, 0.95, P(lift.x + dx, 0, lift.z + dz), { bevel: 0.05, batter: 0.16, irregular: 0.28 }));
    b.prop('iron', hewnBeam(P(lift.x + dx, 0.4, lift.z + dz), P(lift.x + dx * 0.6, 8.6, lift.z + dz * 0.6), 0.32, 0.32, { bevel: 0.03, irregular: 0.1 }), 0x2f2a26);
  }
  for (const [x0, z0, x1, z1] of [[-2, -2, 2, -2], [-2, 2, 2, 2], [-2, -2, -2, 2], [2, -2, 2, 2]]) {
    b.prop('iron', hewnBeam(P(lift.x + x0, 8.6, lift.z + z0), P(lift.x + x1, 8.6, lift.z + z1), 0.3, 0.3, { bevel: 0.03, irregular: 0.08 }), 0x2f2a26);
  }
  b.prop('iron', rod(P(lift.x - 1.2, 9.2, lift.z), P(lift.x + 1.2, 9.2, lift.z), 0.9, 0.9, 14), 0x39332e);
  for (const dz of [-0.7, 0.7]) b.prop('iron', rod(P(lift.x, 9, lift.z + dz), P(lift.x, -1.2, lift.z + dz), 0.04, 0.04, 5), 0x1f1c1a);
  b.prop('timber', stoneBox(4, 0.25, 4, P(lift.x, -1.3, lift.z), { bevel: 0.03, irregular: 0.14 }), 0x6a5038);
  for (const [ox, oy, oz, s] of [[0, -0.75, 0, 1.0], [-0.6, -0.9, 0.5, 0.65], [0.55, -0.92, -0.45, 0.7], [-0.4, -0.95, -0.55, 0.55]]) {
    b.prop('ore', stoneBox(s * 1.15, s * 0.78, s, P(lift.x + ox, oy, lift.z + oz), {
      yaw: ox * 2 + oz, bevel: s * 0.2, irregular: 0.65,
    }), 0xb49a7c);
  }
  b.light(P(lift.x, -12, lift.z), forgeTint, 2.2, 16, { halo: 0 });
  b.light(P(lift.x - 2, 6.5, lift.z), WARM, 4, 15, { halo: 1.4 });
  b.prop('glow', box(0.2, 0.36, 0.2, P(lift.x - 2, 6.5, lift.z)), WARM, 4);

  b.spawn('entry', P(0, 0, 0), 0);
  b.exit('gate', P(0, 0, 2.2), { radius: 2.6, label: 'Leave by the mountain gate' });
}
