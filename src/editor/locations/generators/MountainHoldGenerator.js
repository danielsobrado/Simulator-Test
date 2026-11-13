import { coursedMasonryWall, emitRadialArch } from '../gen/dwarvenMasonry.js';
import { beam, block, box, coursedWall, hewnBeam, rod, stoneBlock, stoneBox } from '../gen/propKit.js';
import { hall, shaft } from '../gen/shapes.js';
import { buildForgeheartInterior } from './forgeheartInterior.js';
import { brazier, bridge, crate, pillar, stairs } from './kits.js';
import { buildEntranceHall, buildFloorInlay, buildHeroGateway, buildVaultedCeiling, buildWallBay } from './stoneholdArchitecture.js';

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
  b.passage(P(0, 0, farZ + 4), P(0, 0, farZ - 5), { width: 9.2, height: 10.8, arch: 0.48 });
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
    b.prop('masonry', stoneBlock(2.7, 1.1, 1.9, P(gx, 0, 3.4), { bevel: 0.08, batter: 0.16, irregular: 0.12 }));
    coursedMasonryWall(b, P(gx - 1.2, 1.1, 3.4), P(gx + 1.2, 1.1, 3.4), 7.2, 1.6, {
      courseHeight: 0.82, baseTint: 0xe6e4e0, trimTint: 0xf0ede7,
    });
    b.prop('masonry', stoneBlock(2.65, 0.7, 1.85, P(gx, 8.3, 3.4), { bevel: 0.07, batter: -0.08, irregular: 0.1 }));
  }
  emitRadialArch(b, 'masonry', P(-4, 7, 3.4), P(4, 7, 3.4), 3, 1.25, 1.6, 13, {
    pointed: 0.18, tint: 0xe8e5e0, keystoneTint: 0xf4f1eb, irregular: 0.06,
  });
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
  buildEntranceHall(b, { height: 8 });
  for (const sign of [-1, 1]) {
    pillar(b, P(sign * 5.2, 0, -6), 8, 1.1, { variant: 'reinforced', trimMaterial: 'carved' });
    pillar(b, P(sign * 5.2, 0, -15), 8, 1.1, { variant: 'reinforced', trimMaterial: 'carved' });
    brazier(b, P(sign * 3.2, 0, -1.8), { tint: '#ffcf98', intensity: 4.8, range: 20, trimMaterial: 'carved', bronzeRim: true });
  }
  emitRadialArch(b, 'carved', P(-5.2, 7.7, -6), P(5.2, 7.7, -6), 3.3, 1.0, 1.35, 15, {
    pointed: 0.2, tint: 0xe6e3de, keystoneTint: 0xf4f0ea, irregular: 0.04,
  });
  emitRadialArch(b, 'carved', P(-5.2, 7.7, -15), P(5.2, 7.7, -15), 3.3, 1.0, 1.35, 15, {
    pointed: 0.2, tint: 0xe6e3de, keystoneTint: 0xf4f0ea, irregular: 0.04,
  });
  b.light(P(0, 10.5, -10.5), '#a4b2c6', 1.25, 26, { flat: true });
  b.light(P(0, 3.2, -10.5), '#9aa6b8', 0.55, 22, { flat: true });

  // --- The avenue ---------------------------------------------------------
  const rowX = halfWidth * 0.57;
  const bays = [];
  for (let z = -20 - pillarSpacing / 2; z > farZ + 2; z -= pillarSpacing) bays.push(z);
  const leftVariants = ['structural', 'alcove', 'heritage', 'chasm-heritage', 'engineering', 'alcove', 'storage'];
  const rightVariants = ['structural', 'storage', 'heritage', 'chasm-heritage', 'heritage', 'alcove', 'engineering'];
  for (const sign of [-1, 1]) {
    const bayVariants = sign < 0 ? leftVariants : rightVariants;
    bays.forEach((z, index) => {
      const pVariant = index === bays.length - 1
        ? 'reinforced'
        : (index === 0 || index === 3 || index === 4) ? 'ceremonial' : 'structural';
      pillar(b, P(sign * rowX, 0, z), height, pillarRadius, { variant: pVariant, trimMaterial: 'carved' });
      // Structural wall buttress aligned with each bay.
      b.prop('carved', stoneBlock(1.35, 1.05, 1.48, P(sign * (halfWidth - 0.35), 0, z), { bevel: 0.06, batter: 0.1, irregular: 0.06 }));
      b.prop('carved', stoneBlock(1.08, height - 1.05, 1.18, P(sign * (halfWidth - 0.3), 1.05, z), { bevel: 0.05, irregular: 0.05 }), 0xe8e4dc);
      // Radial voussoir aisle rib to the wall, and arcade arch to the next pier.
      emitRadialArch(b, 'carved', P(sign * rowX, height - 0.2, z), P(sign * (halfWidth + 0.15), height - 0.2, z), 2.7, 0.88, 1.25, 11, {
        pointed: 0.16, tint: 0xe6e3de, keystoneTint: 0xf4f0ea, irregular: 0.04,
      });
      if (index < bays.length - 1) {
        const next = bays[index + 1];
        emitRadialArch(b, 'carved', P(sign * rowX, height - 4.1, z - pillarRadius), P(sign * rowX, height - 4.1, next + pillarRadius), 3.4, 0.98, 1.55, 13, {
          pointed: 0.18, tint: 0xe6e3de, keystoneTint: 0xf4f0ea, irregular: 0.04,
        });
        const variant = bayVariants[index] ?? 'structural';
        buildWallBay(b, sign, halfWidth, height, galleryY, z, next, variant, index, chasm);
      }
    });
    b.prop('carved', stoneBox(1.85, 1.15, halfLength * 2 - 2, P(sign * rowX, height + 0.25, avenueZ), { bevel: 0.08, irregular: 0.08 }));
    // Elevated gallery sill, pilastered parapet, and springing cornice (lower wall bays now own 0..galleryY cleanly).
    b.prop('masonry', coursedWall(P(sign * (halfWidth - 0.15), galleryY - 0.5, avenueZ - halfLength + 4), P(sign * (halfWidth - 0.15), galleryY - 0.5, avenueZ + halfLength - 4), 0.52, 0.9, {
      courseHeight: 0.52, stoneWidth: 1.5, irregular: 0.12, bevel: 0.05,
    }));
    b.prop('masonry', coursedWall(P(sign * (halfWidth + 0.25), galleryY, avenueZ - halfLength + 4), P(sign * (halfWidth + 0.25), galleryY, avenueZ + halfLength - 4), 1.05, 0.46, {
      courseHeight: 0.38, stoneWidth: 1.1, irregular: 0.14, bevel: 0.04,
    }));
    b.prop('carved', stoneBox(1.1, 0.85, halfLength * 2, P(sign * (halfWidth - 0.3), height + 0.2, avenueZ), { bevel: 0.07, irregular: 0.08 }));
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
      // Alternating gallery parapet lanterns so upper dwarf dwellings & walkways stay readable rather than black void.
      if (Math.round(z / 6) % 2 === 0) {
        const lx = sign * (halfWidth + 0.55);
        b.prop('iron', stoneBox(0.24, 0.24, 0.24, P(lx, galleryY + 2.45, z), { bevel: 0.02 }), 0x2c2824);
        b.flame(P(lx, galleryY + 2.22, z), { width: 0.2, height: 0.3, core: '#fff1b4', outer: '#ff5e14', speed: 1.0 });
        b.light(P(lx - sign * 0.4, galleryY + 2.35, z), '#ffcc8e', 4.0, 16, { radius: 1.2, halo: 0.65 });
      }
    }
    // Purposeful upper gallery installations (chasm windlass on West, alloy supply tally on East).
    if (sign < 0) {
      const gx = -halfWidth - 1.2;
      b.prop('timber', stoneBlock(1.4, 0.3, 1.4, P(gx, galleryY, chasm.z), { bevel: 0.03 }), 0x6a5038);
      b.prop('timber', rod(P(gx, galleryY + 0.9, chasm.z - 0.55), P(gx, galleryY + 0.9, chasm.z + 0.55), 0.28, 0.28, 8), 0x6a5038);
      b.prop('iron', rod(P(gx + 0.55, galleryY + 0.9, chasm.z), P(gx + 0.55, galleryY - 3.6, chasm.z), 0.035, 0.035, 6), 0x2c2824);
    } else {
      const sx = halfWidth + 2.6;
      crate(b, P(sx, galleryY, chasm.z - 12), 0.82, 0.15);
      b.prop('bronze', stoneBox(0.75, 0.16, 0.42, P(sx, galleryY + 0.72, chasm.z - 12), { bevel: 0.02 }), 0xd9b06e);
    }
    // Stair from the aisle to the gallery, with its coursed stone landing pier.
    const foot = P(sign * (halfWidth - 1.9), 0, -23), head = P(sign * (halfWidth - 1.9), galleryY, -37);
    stairs(b, foot, head, 2.2);
    b.prop('masonry', stoneBox(4.4, 0.6, 3, P(sign * (halfWidth - 0.6), galleryY - 0.3, -38.4), { bevel: 0.05, irregular: 0.18 }));
    b.prop('masonry', stoneBlock(2.5, galleryY - 0.6, 3.1, P(sign * (halfWidth - 1.9), 0, -38.4), { bevel: 0.08, batter: 0.08, irregular: 0.24 }));
    b.nav.addRect(P(sign * (halfWidth - 0.4), galleryY, -38.4), 2.4, 1.3);
    b.nav.block(P(sign * (halfWidth - 1.9), 0, -38.6), 1.7, 6);
  }
  buildFloorInlay(b, chasm.z, chasm.half, farZ, [-10.5, farZ + 15]);

  // Compound vaulted nave ceiling ribs, diagonal groin ribs, bosses, and intentional lighting rhythm.
  buildVaultedCeiling(b, bays, { rowX, height, vaultRise, avenueZ, halfLength });
  for (let i = 0; i < bays.length; i += 1) {
    const z = bays[i];
    b.light(P(0, height + vaultRise * 0.56, z), i % 2 === 0 ? '#cfc0ad' : '#b2bbca', 1.48, 26, { flat: true });
    b.light(P(0, 3.2, z), '#9ca8ba', 0.48, 22, { flat: true });
  }
  // Intentional threshold braziers at chasm approach rather than a uniform runway line on every bay.
  for (const sign of [-1, 1]) {
    brazier(b, P(sign * (rowX - 2.9), 0, bays[2] - 4), {
      tint: '#ffd098', intensity: 6.8, range: 26, size: 1.08, trimMaterial: 'carved', bronzeRim: true,
    });
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
    b.prop('glow', rod(on(a0, ringY + 0.48), on(a0, ringY + 0.58), 0.34, 0.22, 7), '#c8420e', 1.6);
    b.flame(on(a0, ringY + 0.55), { width: 0.44, height: 0.62, core: '#fff1b4', outer: '#ff5e14', speed: 1.1 });
    b.light(on(a0, ringY + 1), '#ff8f3f', 3.4, 20, { halo: 0.95 });
    if (index % 3 === 0) b.prop('iron', rod(on(a0, ringY), P(dais.x + Math.cos(a0) * 1.5, height + vaultRise - 0.4, dais.z + Math.sin(a0) * 1.5), 0.04, 0.04, 5), 0x1f1c1a);
  }

  // --- Forgeheart Interior & Ore Lift -------------------------------------
  buildHeroGateway(b, farZ, height);
  buildForgeheartInterior(b, { forge, lift, farZ, forgeTint, warmTint: WARM });

  b.spawn('entry', P(0, 0, 0), 0);
  b.exit('gate', P(0, 0, 2.2), { radius: 2.6, label: 'Leave by the mountain gate' });
}
