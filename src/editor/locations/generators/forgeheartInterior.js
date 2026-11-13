import { coursedMasonryWall, emitRadialArch } from '../gen/dwarvenMasonry.js';
import { box, hewnBeam, rod, stoneBlock, stoneBox } from '../gen/propKit.js';
import { barrel, crate, rails } from './kits.js';

const P = (x, y, z) => ({ x, y, z });

/**
 * Builds an organized pallet rack of stacked bronze/iron ingots on timber sills.
 */
function buildIngotRack(b, at, yaw = 0) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const local = (lx, ly, lz) => P(at.x + c * lx + s * lz, at.y + ly, at.z - s * lx + c * lz);
  b.prop('timber', stoneBox(2.2, 0.16, 1.05, local(0, 0.08, 0), { yaw, bevel: 0.025, irregular: 0.08 }), 0x6a5038);
  b.prop('iron', stoneBox(2.28, 0.12, 1.12, local(0, 0.16, 0), { yaw, bevel: 0.02 }), 0x35312c);
  for (let row = 0; row < 3; row += 1) {
    const y = 0.28 + row * 0.16;
    const count = 4 - row;
    for (let i = 0; i < count; i += 1) {
      const lx = (i - (count - 1) * 0.5) * 0.44;
      const mat = row === 2 ? 'bronze' : 'iron';
      const tint = row === 2 ? 0xd9b06e : 0x565960;
      b.prop(mat, stoneBox(0.36, 0.14, 0.78, local(lx, y, 0), { yaw, bevel: 0.02, irregular: 0.03 }), tint);
    }
  }
  b.nav.block(at, 1.15, 1.6);
}

/**
 * Builds one side leather-and-iron bellows unit feeding an air tuyere into the main crucible.
 */
function buildForgeBellows(b, at, dirToFurnace) {
  const x = at.x, z = at.z;
  // Stone plinth + tilted timber-ribbed bellows chest + iron tuyere nozzle pipe.
  b.prop('masonry', stoneBlock(1.9, 1.0, 2.2, P(x, 0, z), { bevel: 0.06, batter: 0.08, irregular: 0.08 }));
  b.prop('timber', stoneBox(1.6, 0.55, 1.8, P(x, 1.35, z), { bevel: 0.04, irregular: 0.1 }), 0x5c3e26);
  b.prop('timber', stoneBox(1.72, 0.22, 1.92, P(x, 1.85, z), { bevel: 0.03, irregular: 0.08 }), 0x735136);
  for (const dz of [-0.55, 0, 0.55]) {
    b.prop('iron', stoneBox(1.76, 0.1, 0.14, P(x, 1.86, z + dz), { bevel: 0.015 }), 0x322e2a);
  }
  b.prop('iron', rod(
    P(x, 1.3, z),
    P(x + dirToFurnace * 1.9, 0.95, z),
    0.26, 0.16, 8,
  ), 0x3a3632);
  // Overhead counterweighted pull lever.
  b.prop('timber', hewnBeam(P(x - dirToFurnace * 0.6, 2.4, z), P(x + dirToFurnace * 0.9, 2.0, z), 0.14, 0.14, { bevel: 0.02 }), 0x6a4e35);
  b.prop('iron', rod(P(x - dirToFurnace * 0.55, 2.35, z), P(x - dirToFurnace * 0.55, 1.1, z), 0.025, 0.025, 6), 0x2a2623);
  b.nav.block(at, 1.2, 2.4);
}

/**
 * Forgeheart Interior: monumental central blast crucible & casting floor, twin
 * bellows, pivoting crucible crane, master forging anvil dais with glowing blade,
 * overhead iron exhaust gantry trusses with chains, secondary bloomeries, ingot
 * racks, and an ore-lift rail spur.
 */
export function buildForgeheartInterior(b, { forge, lift, farZ, forgeTint, warmTint }) {
  const hearthZ = forge.z - 9.6;

  // --- 1. Monumental Central Blast Crucible (the visual anchor beyond Hero Gateway) ---
  b.prop('carved', stoneBlock(7.2, 1.05, 4.4, P(0, 0, hearthZ), { bevel: 0.09, batter: 0.12, irregular: 0.06 }));
  b.prop('masonry', stoneBlock(6.2, 4.4, 3.8, P(0, 1.05, hearthZ), { bevel: 0.08, batter: 0.05, irregular: 0.06 }));
  coursedMasonryWall(b, P(-3.0, 0.9, hearthZ + 1.92), P(3.0, 0.9, hearthZ + 1.92), 4.6, 0.42, {
    courseHeight: 0.68,
    openings: [{ s: 3.0, sill: 0, width: 2.8, height: 2.65, profile: 'round', dressed: true }],
    baseTint: 0xd0cec9,
    trimTint: 0xe6e3dc,
  });
  b.prop('carved', stoneBlock(5.0, 2.2, 3.2, P(0, 5.45, hearthZ), { bevel: 0.08, batter: 0.18, irregular: 0.05 }));
  b.prop('masonry', stoneBlock(3.2, 6.8, 2.6, P(0, 7.65, hearthZ - 0.1), { bevel: 0.08, batter: 0.12, irregular: 0.05 }));
  // Forged iron furnace braces, tension bands & keystone bronze crest.
  for (const sx of [-2.45, 2.45]) {
    b.prop('iron', stoneBlock(0.34, 5.6, 0.4, P(sx, 0.6, hearthZ + 1.98), { bevel: 0.025 }), 0x35312c);
  }
  for (const bandY of [3.9, 5.5, 7.4, 10.2]) {
    const bw = bandY < 6 ? 6.4 : 4.2;
    b.prop('iron', stoneBox(bw, 0.24, 3.95, P(0, bandY, hearthZ), { bevel: 0.02 }), 0x2f2b27);
  }
  emitRadialArch(b, 'carved', P(-1.65, 0.7, hearthZ + 2.02), P(1.65, 0.7, hearthZ + 2.02), 1.95, 0.62, 0.65, 11, {
    pointed: 0.16, tint: 0xe2dfd8, keystoneTint: 0xf0ede6, irregular: 0.05,
  });
  // Vertical iron furnace grate bars, deep coal glow bed & live flames inside blast firebox.
  b.prop('glow', box(2.55, 1.95, 0.35, P(0, 1.25, hearthZ + 1.65)), forgeTint, 3.8);
  b.prop('glow', box(1.85, 0.75, 0.65, P(0, 0.7, hearthZ + 1.95)), '#ffaa38', 3.4);
  for (const bx of [-0.95, -0.48, 0, 0.48, 0.95]) {
    b.prop('iron', rod(P(bx, 0.65, hearthZ + 1.95), P(bx, 2.15, hearthZ + 1.95), 0.042, 0.042, 6), 0x24201c);
  }
  b.flame(P(0, 1.15, hearthZ + 1.92), { width: 1.75, height: 2.15, core: '#fff5c2', outer: '#ff5c12', speed: 1.2 });
  b.light(P(0, 1.95, hearthZ + 3.4), forgeTint, 15.5, 29, { radius: 2.6, halo: 1.9 });
  b.nav.block(P(0, 0, hearthZ), 4.0, 6);

  // Twin great bellows flanking the central blast furnace.
  buildForgeBellows(b, P(-4.7, 0, hearthZ + 0.5), 1);
  buildForgeBellows(b, P(4.7, 0, hearthZ + 0.5), -1);

  // Molten runoff casting channel & floor ingot mold pit directly in front of the furnace lip.
  b.prop('iron', stoneBox(3.4, 0.12, 2.2, P(0, 0.06, hearthZ + 3.1), { bevel: 0.03 }), 0x5c6068);
  b.prop('iron', stoneBox(0.24, 0.2, 2.2, P(-1.58, 0.1, hearthZ + 3.1), { bevel: 0.02 }), 0x6c7078);
  b.prop('iron', stoneBox(0.24, 0.2, 2.2, P(1.58, 0.1, hearthZ + 3.1), { bevel: 0.02 }), 0x6c7078);
  b.prop('iron', stoneBox(3.4, 0.2, 0.24, P(0, 0.1, hearthZ + 4.18), { bevel: 0.02 }), 0x6c7078);
  b.prop('glow', box(0.4, 0.08, 1.9, P(0, 0.12, hearthZ + 3.0)), '#ff6818', 1.8);
  b.prop('glow', box(2.0, 0.08, 0.56, P(0, 0.12, hearthZ + 3.8)), '#ff7820', 1.7);
  b.nav.block(P(0, 0, hearthZ + 3.1), 1.9, 1.5);

  // --- 2. Central Forging Dais & Master Anvil Station (silhouetted inside Hero Gateway vista) ---
  const dais = P(0, 0, forge.z + 1.6);
  b.prop('carved', rod(P(dais.x, 0, dais.z), P(dais.x, 0.18, dais.z), 2.8, 2.65, 8), 0xc6c3bd);
  b.prop('iron', rod(P(dais.x, 0.18, dais.z), P(dais.x, 0.23, dais.z), 2.1, 2.05, 8), 0x686c74);
  // Master Anvil on hooped dwarf-oak block + red-hot blank bar across the anvil table.
  b.prop('timber', rod(P(dais.x, 0.22, dais.z), P(dais.x, 0.98, dais.z), 0.66, 0.6, 10), 0x6a5038);
  b.prop('iron', rod(P(dais.x, 0.36, dais.z), P(dais.x, 0.44, dais.z), 0.66, 0.66, 10), 0x5c6068);
  b.prop('iron', stoneBlock(1.45, 0.36, 0.62, P(dais.x, 0.98, dais.z), { bevel: 0.04, batter: 0.1 }), 0x686c74);
  b.prop('iron', stoneBlock(1.95, 0.46, 0.68, P(dais.x, 1.34, dais.z), { bevel: 0.045, batter: -0.05 }), 0x767a84);
  b.prop('iron', rod(P(dais.x + 0.95, 1.57, dais.z), P(dais.x + 1.75, 1.64, dais.z), 0.28, 0.04, 8), 0x767a84);
  b.prop('glow', stoneBox(0.75, 0.08, 0.22, P(dais.x - 0.15, 1.83, dais.z), { yaw: 0.25, bevel: 0.015 }), '#ff701e', 2.4);
  b.light(P(dais.x, 2.65, dais.z + 1.0), '#ffb86e', 4.6, 16, { radius: 1.5, halo: 0 });
  // Companion quench tank & barrel flanking the master anvil.
  b.prop('iron', stoneBox(1.25, 0.68, 0.85, P(dais.x - 1.75, 0.52, dais.z + 0.3), { yaw: 0.35, bevel: 0.03 }), 0x5e626a);
  barrel(b, P(dais.x + 1.85, 0.18, dais.z + 0.55), 0.34, 0.9);
  b.nav.block(dais, 2.75, 2.5);

  // Overhead Pivoting Crucible Jib Crane hoisting a glowing pouring kettle between furnace and dais.
  const cranePost = P(-3.6, 0, hearthZ + 6.4);
  b.prop('carved', stoneBlock(1.15, 0.85, 1.15, cranePost, { bevel: 0.05, batter: 0.1 }), 0xcac7c1);
  b.prop('iron', stoneBlock(0.42, 6.2, 0.42, P(cranePost.x, 0.85, cranePost.z), { bevel: 0.03 }), 0x62666e);
  b.prop('iron', hewnBeam(P(cranePost.x, 6.85, cranePost.z), P(0.1, 6.85, hearthZ + 3.4), 0.32, 0.38, { bevel: 0.025 }), 0x666a72);
  b.prop('iron', hewnBeam(P(cranePost.x, 4.4, cranePost.z), P(-1.4, 6.85, hearthZ + 4.7), 0.22, 0.22, { bevel: 0.02 }), 0x5c6068);
  b.prop('iron', rod(P(0.1, 6.75, hearthZ + 3.4), P(0.1, 3.15, hearthZ + 3.4), 0.055, 0.055, 6), 0x52565e);
  // Suspended iron pouring crucible ladle.
  b.prop('iron', rod(P(0.1, 2.35, hearthZ + 3.4), P(0.1, 3.18, hearthZ + 3.4), 0.52, 0.62, 10), 0x646870);
  b.prop('glow', rod(P(0.1, 3.12, hearthZ + 3.4), P(0.1, 3.24, hearthZ + 3.4), 0.48, 0.48, 10), '#ff6d1c', 2.8);
  b.nav.block(cranePost, 0.85, 7);

  // --- 3. Secondary Flanking Bloomery Furnaces & Ingot Storage ---
  for (const at of [-14, 14].map((x) => P(x, 0, hearthZ))) {
    b.prop('masonry', stoneBlock(5.5, 4.6, 3.6, at, { bevel: 0.08, batter: 0.06, irregular: 0.2 }));
    coursedMasonryWall(b, P(at.x - 2.6, 0, at.z + 1.82), P(at.x + 2.6, 0, at.z + 1.82), 4.5, 0.36, {
      courseHeight: 0.62, baseTint: 0xd0cec9, trimTint: 0xe6e3dc,
    });
    b.prop('masonry', stoneBlock(4.1, 1.6, 2.9, P(at.x, 4.6, at.z), { bevel: 0.08, batter: 0.12, irregular: 0.18 }));
    b.prop('masonry', stoneBlock(2.3, 9, 2.3, P(at.x, 6.2, at.z - 0.2), { bevel: 0.08, batter: 0.08, irregular: 0.18 }));
    emitRadialArch(b, 'masonry', P(at.x - 1.4, 0.4, at.z + 1.85), P(at.x + 1.4, 0.4, at.z + 1.85), 1.7, 0.52, 0.52, 9, {
      pointed: 0.15, irregular: 0.06,
    });
    b.prop('glow', box(2.3, 1.7, 0.2, P(at.x, 1.1, at.z + 1.75)), forgeTint, 3.6);
    b.flame(P(at.x, 1.0, at.z + 1.85), { width: 1.2, height: 1.5, core: '#fff2b0', outer: '#ff5e14', speed: 1.0 });
    b.prop('iron', stoneBox(5.7, 0.26, 3.9, P(at.x, 3.2, at.z), { bevel: 0.03 }), 0x2b2724);
    b.light(P(at.x, 1.7, at.z + 3.2), forgeTint, 12.5, 26, { radius: 2.2, halo: 1.8 });
    b.nav.block(at, 3.4, 6);

    const work = P(at.x + 1.2, 0, at.z + 5.8);
    b.prop('timber', rod(work, P(work.x, 0.6, work.z), 0.44, 0.4, 9), 0x6a5038);
    b.prop('iron', stoneBlock(0.92, 0.3, 0.42, P(work.x, 0.6, work.z), { bevel: 0.03, batter: 0.08 }), 0x45403b);
    b.prop('iron', rod(P(work.x + 0.45, 0.78, work.z), P(work.x + 0.85, 0.82, work.z), 0.14, 0.03, 6), 0x45403b);
    b.nav.block(work, 0.75, 2);
    b.prop('masonry', stoneBlock(2.25, 0.72, 0.95, P(at.x - 2.6, 0, at.z + 5.2), { bevel: 0.05, batter: 0.08 }));
    b.prop('iron', stoneBox(1.9, 0.06, 0.6, P(at.x - 2.6, 0.66, at.z + 5.2), { bevel: 0.015 }), 0x10161a);
    b.nav.block(P(at.x - 2.6, 0, at.z + 5.2), 1.2, 2);
  }

  // --- 4. Overhead Riveted Iron Gantry & Exhaust Ducts ---
  for (const gz of [forge.z - 4.2, forge.z + 4.4]) {
    b.prop('iron', hewnBeam(P(-19, 8.3, gz), P(19, 8.3, gz), 0.42, 0.56, { bevel: 0.03 }), 0x62666e);
    for (const cx of [-14, -7, 7, 14]) {
      b.prop('iron', rod(P(cx, 8.0, gz), P(cx, 5.2, gz), 0.035, 0.035, 6), 0x52565e);
    }
  }
  for (const gx of [-14, 14]) {
    b.prop('iron', hewnBeam(P(gx, 8.4, hearthZ + 1.0), P(0, 9.6, hearthZ), 0.48, 0.52, { bevel: 0.03 }), 0x666a72);
    b.light(P(gx * 0.72, 9.6, hearthZ + 5.8), '#ffa860', 2.8, 22, { flat: true });
  }
  b.light(P(0, 8.2, forge.z - 2.5), '#ffad64', 4.2, 26, { flat: true });

  // Organized ingot stacks, coal bunkers & ore crates between furnaces.
  for (const x of [-8.6, 8.6]) {
    for (const [ox, oy, oz, s] of [[0, 0.55, 0, 1.15], [-0.55, 0.35, 0.45, 0.72], [0.5, 0.32, -0.4, 0.68], [0.2, 0.85, 0.15, 0.6]]) {
      b.prop('masonry', stoneBox(s * 1.1, s * 0.75, s, P(x + ox, oy, forge.z - 9 + oz), {
        yaw: ox * 2 + oz, bevel: s * 0.2, irregular: 0.55,
      }), 0x1b1917);
    }
    b.nav.block(P(x, 0, forge.z - 9), 2, 2);
    buildIngotRack(b, P(x, 0, forge.z - 5.2), x < 0 ? 0.2 : -0.2);
  }

  // --- 5. Ore Lift Integration & Rail Spur (`lift = P(19, 0, forge.z)`) ---
  for (const [dx, dz] of [[-3.3, -3.3], [3.3, -3.3], [-3.3, 3.3], [3.3, 3.3]]) {
    b.prop('masonry', stoneBlock(0.95, 0.5, 0.95, P(lift.x + dx, 0, lift.z + dz), { bevel: 0.05, batter: 0.16, irregular: 0.22 }));
    b.prop('iron', hewnBeam(P(lift.x + dx, 0.4, lift.z + dz), P(lift.x + dx * 0.6, 8.6, lift.z + dz * 0.6), 0.32, 0.32, { bevel: 0.03 }), 0x2f2a26);
  }
  for (const [x0, z0, x1, z1] of [[-2, -2, 2, -2], [-2, 2, 2, 2], [-2, -2, -2, 2], [2, -2, 2, 2]]) {
    b.prop('iron', hewnBeam(P(lift.x + x0, 8.6, lift.z + z0), P(lift.x + x1, 8.6, lift.z + z1), 0.3, 0.3, { bevel: 0.03 }), 0x2f2a26);
  }
  b.prop('iron', rod(P(lift.x - 1.2, 9.2, lift.z), P(lift.x + 1.2, 9.2, lift.z), 0.9, 0.9, 14), 0x39332e);
  for (const dz of [-0.7, 0.7]) b.prop('iron', rod(P(lift.x, 9, lift.z + dz), P(lift.x, -1.2, lift.z + dz), 0.04, 0.04, 5), 0x1f1c1a);
  b.prop('timber', stoneBox(4, 0.25, 4, P(lift.x, -1.3, lift.z), { bevel: 0.03, irregular: 0.12 }), 0x6a5038);
  for (const [ox, oy, oz, s] of [[0, -0.75, 0, 1.0], [-0.6, -0.9, 0.5, 0.65], [0.55, -0.92, -0.45, 0.7], [-0.4, -0.95, -0.55, 0.55]]) {
    b.prop('ore', stoneBox(s * 1.15, s * 0.78, s, P(lift.x + ox, oy, lift.z + oz), {
      yaw: ox * 2 + oz, bevel: s * 0.2, irregular: 0.6,
    }), 0xb49a7c);
  }
  // Ore track spur feeding extracted ore from the lift platform toward the East furnace & central forge.
  rails(b, P(15.2, 0, lift.z - 0.8), P(7.4, 0, lift.z - 2.6), 0.9);
  crate(b, P(15.4, 0, lift.z + 2.5), 0.95, 0.15);
  b.nav.block(P(15.4, 0, lift.z + 2.5), 0.75, 2);

  // Cool mountain draft light descending the lift shaft contrasting the warm furnaces.
  b.light(P(lift.x, -12, lift.z), forgeTint, 2.2, 16, { halo: 0 });
  b.light(P(lift.x - 2, 6.5, lift.z), warmTint, 3.8, 15, { halo: 1.1 });
  b.light(P(lift.x, 11.2, lift.z), '#9cb6d4', 3.4, 24, { flat: true });
  b.prop('glow', box(0.2, 0.36, 0.2, P(lift.x - 2, 6.5, lift.z)), warmTint, 3.2);
}
