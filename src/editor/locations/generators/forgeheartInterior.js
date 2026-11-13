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
  b.prop('carved', stoneBlock(7.2, 1.05, 4.4, P(0, 0, hearthZ), { bevel: 0.09, batter: 0.12, irregular: 0.06 }), 0xcbc7c0);
  b.prop('masonry', stoneBlock(6.2, 4.4, 3.8, P(0, 1.05, hearthZ), { bevel: 0.08, batter: 0.05, irregular: 0.06 }), 0xd4d0c8);
  coursedMasonryWall(b, P(-3.0, 0.9, hearthZ + 1.92), P(3.0, 0.9, hearthZ + 1.92), 4.6, 0.42, {
    courseHeight: 0.68,
    openings: [{ s: 3.0, sill: 0, width: 2.8, height: 2.65, profile: 'round', dressed: true }],
    baseTint: 0xd0cec9,
    trimTint: 0xe6e3dc,
  });
  b.prop('carved', stoneBlock(5.0, 2.2, 3.2, P(0, 5.45, hearthZ), { bevel: 0.08, batter: 0.18, irregular: 0.05 }), 0xc6c3bd);
  b.prop('carved', stoneBox(6.6, 0.34, 4.1, P(0, 5.45, hearthZ), { bevel: 0.05, irregular: 0.04 }), 0xd6d3cd);
  b.prop('masonry', stoneBlock(3.2, 6.8, 2.6, P(0, 7.65, hearthZ - 0.1), { bevel: 0.08, batter: 0.12, irregular: 0.05 }), 0xc4c0b9);
  // Forged iron furnace braces, tension bands & bronze keystone crest on upper mantel.
  for (const sx of [-2.45, 2.45]) {
    b.prop('iron', stoneBlock(0.34, 5.6, 0.4, P(sx, 0.6, hearthZ + 1.98), { bevel: 0.025 }), 0x6c717a);
  }
  for (const bandY of [3.9, 5.5, 7.4, 10.2]) {
    const bw = bandY < 6 ? 6.4 : 4.2;
    b.prop('iron', stoneBox(bw, 0.24, 3.95, P(0, bandY, hearthZ), { bevel: 0.02 }), 0x686c76);
  }
  b.prop('bronze', stoneBox(1.1, 1.1, 0.2, P(0, 4.75, hearthZ + 2.02), { bevel: 0.03 }), 0xcba66d);
  emitRadialArch(b, 'carved', P(-1.65, 0.7, hearthZ + 2.02), P(1.65, 0.7, hearthZ + 2.02), 1.95, 0.62, 0.65, 11, {
    pointed: 0.16, tint: 0xe2dfd8, keystoneTint: 0xf0ede6, irregular: 0.05,
  });
  // Recessed dark iron fireback, sculpted glowing coal bed, clinker chunks, iron grate & layered live flames.
  b.prop('iron', box(2.6, 2.1, 0.3, P(0, 1.3, hearthZ + 1.55)), 0x2a2725);
  b.prop('glow', stoneBox(2.1, 0.42, 0.75, P(0, 0.85, hearthZ + 1.85), { bevel: 0.06, irregular: 0.3 }), '#dc460c', 1.65);
  for (const [cx, cy, cz, cs] of [[-0.65, 1.05, 1.88, 0.42], [0.0, 1.1, 1.86, 0.48], [0.62, 1.02, 1.9, 0.4], [-0.3, 0.92, 2.0, 0.34], [0.35, 0.94, 1.98, 0.36]]) {
    b.prop('glow', stoneBox(cs, cs * 0.65, cs, P(cx, cy, hearthZ + cz), { yaw: cx * 2, bevel: 0.05, irregular: 0.45 }), '#ff6a18', 1.55);
  }
  for (const [cx, cz, ang] of [[-0.48, 2.04, 0.4], [0.15, 2.06, 1.1], [0.58, 2.02, 2.0]]) {
    b.prop('iron', stoneBox(0.32, 0.2, 0.28, P(cx, 0.96, hearthZ + cz), { yaw: ang, bevel: 0.03, irregular: 0.45 }), 0x26211e);
  }
  for (const bx of [-0.95, -0.48, 0, 0.48, 0.95]) {
    b.prop('iron', rod(P(bx, 0.65, hearthZ + 2.08), P(bx, 2.18, hearthZ + 2.08), 0.042, 0.042, 6), 0x626670);
  }
  b.flame(P(-0.48, 1.15, hearthZ + 1.92), { width: 0.95, height: 1.55, core: '#fff4c4', outer: '#ff520e', speed: 1.15 });
  b.flame(P(0, 1.22, hearthZ + 1.96), { width: 1.18, height: 1.95, core: '#fff5c8', outer: '#ff5610', speed: 1.25 });
  b.flame(P(0.48, 1.12, hearthZ + 1.92), { width: 0.9, height: 1.48, core: '#fff4c4', outer: '#ff520e', speed: 1.08 });
  b.light(P(0, 1.95, hearthZ + 3.4), forgeTint, 15.0, 29, { radius: 2.6, halo: 1.35 });
  b.nav.block(P(0, 0, hearthZ), 4.0, 6);

  // Twin great bellows flanking the central blast furnace.
  buildForgeBellows(b, P(-4.7, 0, hearthZ + 0.5), 1);
  buildForgeBellows(b, P(4.7, 0, hearthZ + 0.5), -1);

  // Molten runoff casting channel & floor ingot mold pit directly in front of the furnace lip.
  b.prop('iron', stoneBox(3.4, 0.12, 2.2, P(0, 0.06, hearthZ + 3.1), { bevel: 0.03 }), 0x6c717a);
  b.prop('iron', stoneBox(0.24, 0.2, 2.2, P(-1.58, 0.1, hearthZ + 3.1), { bevel: 0.02 }), 0x767b84);
  b.prop('iron', stoneBox(0.24, 0.2, 2.2, P(1.58, 0.1, hearthZ + 3.1), { bevel: 0.02 }), 0x767b84);
  b.prop('iron', stoneBox(3.4, 0.2, 0.24, P(0, 0.1, hearthZ + 4.18), { bevel: 0.02 }), 0x767b84);
  b.prop('glow', box(0.38, 0.08, 1.9, P(0, 0.12, hearthZ + 3.0)), '#ff6014', 1.45);
  b.prop('glow', box(1.95, 0.08, 0.52, P(0, 0.12, hearthZ + 3.8)), '#ff6c1a', 1.4);
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
    b.prop('iron', box(2.35, 1.85, 0.22, P(at.x, 1.1, at.z + 1.62)), 0x262220);
    b.prop('glow', stoneBox(1.8, 0.36, 0.55, P(at.x, 0.72, at.z + 1.84), { bevel: 0.05, irregular: 0.3 }), '#dc460c', 1.65);
    for (const cx of [-0.45, 0, 0.45]) {
      b.prop('iron', rod(P(at.x + cx, 0.52, at.z + 1.94), P(at.x + cx, 1.78, at.z + 1.94), 0.036, 0.036, 6), 0x646872);
    }
    b.flame(P(at.x, 1.0, at.z + 1.86), { width: 1.25, height: 1.65, core: '#fff4c4', outer: '#ff520e', speed: 1.05 });
    b.prop('iron', stoneBox(5.7, 0.26, 3.9, P(at.x, 3.2, at.z), { bevel: 0.03 }), 0x6c717a);
    b.light(P(at.x, 1.7, at.z + 3.2), forgeTint, 12.0, 26, { radius: 2.2, halo: 1.1 });
    b.nav.block(at, 3.4, 6);

    const work = P(at.x + 1.2, 0, at.z + 5.8);
    b.prop('timber', rod(work, P(work.x, 0.6, work.z), 0.44, 0.4, 9), 0x6a5038);
    b.prop('iron', stoneBlock(0.92, 0.3, 0.42, P(work.x, 0.6, work.z), { bevel: 0.03, batter: 0.08 }), 0x6c717a);
    b.prop('iron', rod(P(work.x + 0.45, 0.78, work.z), P(work.x + 0.85, 0.82, work.z), 0.14, 0.03, 6), 0x6c717a);
    b.nav.block(work, 0.75, 2);
    b.prop('masonry', stoneBlock(2.25, 0.72, 0.95, P(at.x - 2.6, 0, at.z + 5.2), { bevel: 0.05, batter: 0.08 }));
    b.prop('iron', stoneBox(1.9, 0.06, 0.6, P(at.x - 2.6, 0.66, at.z + 5.2), { bevel: 0.015 }), 0x10161a);
    b.nav.block(P(at.x - 2.6, 0, at.z + 5.2), 1.2, 2);
  }

  // --- 4. Overhead Riveted Iron Gantry & Exhaust Ducts ---
  for (const gz of [forge.z - 4.2, forge.z + 4.4]) {
    b.prop('iron', hewnBeam(P(-19, 8.3, gz), P(19, 8.3, gz), 0.42, 0.56, { bevel: 0.03 }), 0x70747d);
    for (const cx of [-14, -7, 7, 14]) {
      b.prop('iron', rod(P(cx, 8.0, gz), P(cx, 5.2, gz), 0.035, 0.035, 6), 0x686c74);
    }
  }
  for (const gx of [-14, 14]) {
    b.prop('iron', hewnBeam(P(gx, 8.4, hearthZ + 1.0), P(0, 9.6, hearthZ), 0.48, 0.52, { bevel: 0.03 }), 0x70747d);
    b.light(P(gx * 0.72, 9.6, hearthZ + 5.8), '#ffa860', 3.1, 22, { flat: true });
  }
  b.light(P(0, 8.2, forge.z - 2.5), '#ffad64', 4.2, 26, { flat: true });
  b.light(P(0, 3.2, forge.z + 6.5), '#ffb874', 3.4, 17, { flat: true });

  // Organized ingot stacks, coal bunkers & ore crates between furnaces.
  for (const x of [-8.6, 8.6]) {
    for (const [ox, oy, oz, s] of [[0, 0.55, 0, 1.15], [-0.55, 0.35, 0.45, 0.72], [0.5, 0.32, -0.4, 0.68], [0.2, 0.85, 0.15, 0.6]]) {
      b.prop('masonry', stoneBox(s * 1.1, s * 0.75, s, P(x + ox, oy, forge.z - 9 + oz), {
        yaw: ox * 2 + oz, bevel: s * 0.2, irregular: 0.55,
      }), 0x2e2a26);
    }
    b.nav.block(P(x, 0, forge.z - 9), 2, 2);
    buildIngotRack(b, P(x, 0, forge.z - 5.2), x < 0 ? 0.2 : -0.2);
  }

  // West-wall Crushed Ore Hopper, Slag Wheelbarrow & Supply Lantern balancing East Ore Lift.
  b.prop('masonry', stoneBlock(2.8, 1.5, 3.2, P(-18.5, 0, forge.z + 1.2), { bevel: 0.06, batter: 0.08 }), 0xb4b8c2);
  b.prop('timber', stoneBox(2.4, 1.1, 2.7, P(-18.3, 2.0, forge.z + 1.2), { bevel: 0.04 }), 0x6a5038);
  for (const [ox, oy, oz, s] of [[0, 2.7, 0, 0.9], [-0.45, 2.65, 0.5, 0.65], [0.4, 2.65, -0.4, 0.6]]) {
    b.prop('ore', stoneBox(s * 1.1, s * 0.75, s, P(-18.3 + ox, oy, forge.z + 1.2 + oz), { yaw: ox + oz, bevel: s * 0.2, irregular: 0.5 }), 0xb49a7c);
  }
  crate(b, P(-16.2, 0, forge.z + 4.4), 0.92, 0.25);
  b.light(P(-16.5, 4.4, forge.z + 1.2), '#ffb86e', 4.0, 18, { radius: 1.4, halo: 0.8 });
  b.nav.block(P(-18.0, 0, forge.z + 1.2), 2.2, 3.8);

  // --- 5. Ore Lift Integration & Rail Spur (`lift = P(19, 0, forge.z)`) ---
  for (const [dx, dz] of [[-3.3, -3.3], [3.3, -3.3], [-3.3, 3.3], [3.3, 3.3]]) {
    b.prop('masonry', stoneBlock(0.95, 0.5, 0.95, P(lift.x + dx, 0, lift.z + dz), { bevel: 0.05, batter: 0.16, irregular: 0.22 }));
    b.prop('iron', hewnBeam(P(lift.x + dx, 0.4, lift.z + dz), P(lift.x + dx * 0.6, 8.6, lift.z + dz * 0.6), 0.32, 0.32, { bevel: 0.03 }), 0x686c74);
  }
  for (const [x0, z0, x1, z1] of [[-2, -2, 2, -2], [-2, 2, 2, 2], [-2, -2, -2, 2], [2, -2, 2, 2]]) {
    b.prop('iron', hewnBeam(P(lift.x + x0, 8.6, lift.z + z0), P(lift.x + x1, 8.6, lift.z + z1), 0.3, 0.3, { bevel: 0.03 }), 0x686c74);
  }
  b.prop('iron', rod(P(lift.x - 1.2, 9.2, lift.z), P(lift.x + 1.2, 9.2, lift.z), 0.9, 0.9, 14), 0x70747d);
  for (const dz of [-0.7, 0.7]) b.prop('iron', rod(P(lift.x, 9, lift.z + dz), P(lift.x, -1.2, lift.z + dz), 0.04, 0.04, 5), 0x5c6068);
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
