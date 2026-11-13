import { arch, beam, box, coursedWall, hewnBeam, rod, stoneBlock, stoneBox } from '../gen/propKit.js';
import { brazier } from './kits.js';

const P = (x, y, z) => ({ x, y, z });

/**
 * Zone A — Monumental entrance threshold & gate hall wall niches.
 * Transitions the player from the outer bronze fortress doors into the nave.
 */
export function buildEntranceHall(b, { height = 8 } = {}) {
  // Inner threshold bastion piers & pointed transition arch at z = -20.
  for (const sign of [-1, 1]) {
    const x = sign * 6.8;
    b.prop('carved', stoneBlock(2.6, 1.0, 2.2, P(x, 0, -20), { bevel: 0.08, batter: 0.14, irregular: 0.06 }));
    b.prop('masonry', stoneBlock(2.2, 8.2, 1.9, P(x, 1.0, -20), { bevel: 0.07, irregular: 0.06 }));
    b.prop('carved', stoneBlock(2.5, 0.75, 2.1, P(x, 9.2, -20), { bevel: 0.07, batter: -0.08, irregular: 0.05 }));
    b.prop('bronze', stoneBlock(0.28, 7.4, 0.22, P(x - sign * 1.05, 1.2, -19.05), { bevel: 0.02, irregular: 0.04 }), 0xd8b478);

    // Side wall framed blind niche + forged wall sconce in the gate hall.
    const wx = sign * 7.65;
    b.prop('carved', stoneBlock(0.45, 5.2, 4.4, P(wx, 0.8, -10.5), { bevel: 0.06, irregular: 0.06 }), 0xdedcdd);
    b.prop('masonry', stoneBlock(0.58, 4.4, 3.6, P(wx - sign * 0.08, 1.2, -10.5), { bevel: 0.05, irregular: 0.06 }), 0xc8c6c2);
    b.prop('bronze', stoneBox(0.24, 1.8, 1.2, P(wx - sign * 0.34, 3.3, -10.5), { bevel: 0.03, irregular: 0.04 }), 0xc9a56b);
    b.prop('iron', stoneBox(0.5, 0.26, 0.65, P(wx - sign * 0.45, 4.4, -10.5), { bevel: 0.02, irregular: 0.04 }), 0x2c2824);
    b.prop('iron', stoneBox(0.46, 0.08, 0.56, P(wx - sign * 0.45, 4.92, -10.5), { bevel: 0.02 }), 0x2c2824);
    for (const [lx, lz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) {
      b.prop('iron', rod(P(wx - sign * 0.45 + lx, 4.5, -10.5 + lz), P(wx - sign * 0.45 + lx, 4.9, -10.5 + lz), 0.018, 0.018, 4), 0x2a2623);
    }
    b.prop('glow', box(0.2, 0.28, 0.2, P(wx - sign * 0.45, 4.7, -10.5)), '#ff9e38', 2.4);
    b.light(P(wx - sign * 0.9, 4.7, -10.5), '#ffd29e', 3.4, 14, { radius: 1.6, halo: 1.3 });
  }
  b.prop('carved', arch(P(-6.8, height + 1.2, -20), P(6.8, height + 1.2, -20), 4.2, 1.25, 2.0, 15, {
    pointed: 0.22, irregular: 0.06,
  }));
}

/**
 * Priority 2 — Compound transverse arches, quadripartite diagonal vault ribs,
 * heavy spinal ridge beam, and carved intersection bosses across the nave ceiling.
 */
export function buildVaultedCeiling(b, bays, { rowX, height, vaultRise, avenueZ, halfLength }) {
  const crownY = height + vaultRise - 0.55;
  for (let i = 0; i < bays.length; i += 1) {
    const z = bays[i];
    // Two-tier compound transverse arch: broad structural outer arch + proud inner soffit rib.
    b.prop('carved', arch(P(-rowX, height - 0.1, z), P(rowX, height - 0.1, z), vaultRise - 0.7, 1.45, 2.15, 19, {
      pointed: 0.22, extrados: 1.1, irregular: 0.05,
    }));
    b.prop('masonry', arch(P(-rowX, height - 0.35, z), P(rowX, height - 0.35, z), vaultRise - 0.85, 0.74, 1.05, 19, {
      pointed: 0.22, extrados: 1.1, irregular: 0.05,
    }), 0xdedcdd);

    // Carved stone keystone boss & bronze strap at transverse-ridge intersection.
    b.prop('carved', stoneBox(2.2, 1.35, 2.4, P(0, crownY, z), { bevel: 0.12, irregular: 0.04 }), 0xebe9e6);
    b.prop('bronze', stoneBox(1.4, 0.28, 1.5, P(0, crownY - 0.58, z), { bevel: 0.03, irregular: 0.04 }), 0xd8b478);

    // Quadripartite diagonal groin ribs spanning from pier capitals to mid-bay boss.
    if (i < bays.length - 1) {
      const midZ = (z + bays[i + 1]) * 0.5;
      b.prop('carved', stoneBox(1.8, 1.1, 1.8, P(0, crownY - 0.15, midZ), { yaw: Math.PI / 4, bevel: 0.1, irregular: 0.04 }));
      b.prop('bronze', stoneBox(0.9, 0.22, 0.9, P(0, crownY - 0.68, midZ), { yaw: Math.PI / 4, bevel: 0.025, irregular: 0.04 }), 0xd8b478);
      for (const sign of [-1, 1]) {
        for (const endZ of [z, bays[i + 1]]) {
          b.prop('carved', hewnBeam(
            P(sign * (rowX - 0.3), height + 0.15, endZ),
            P(0, crownY - 0.15, midZ),
            0.64, 0.72, { bevel: 0.06, irregular: 0.05 },
          ));
        }
      }
    }
  }

  // Heavy spinal ridge beam & paired longitudinal haunch ribs tying every transverse boss together.
  b.prop('carved', stoneBox(1.75, 1.15, halfLength * 2 - 2, P(0, crownY + 0.15, avenueZ), { bevel: 0.1, irregular: 0.04 }), 0xdedcdd);
  b.prop('bronze', stoneBox(0.32, 0.18, halfLength * 2 - 2, P(0, crownY - 0.42, avenueZ), { bevel: 0.02, irregular: 0.03 }), 0xcba66d);
  for (const sign of [-1, 1]) {
    b.prop('carved', stoneBox(0.86, 0.72, halfLength * 2 - 2, P(sign * rowX * 0.54, height + vaultRise * 0.6, avenueZ), { bevel: 0.06, irregular: 0.05 }));
  }
}

/**
 * Priority 3 & 6 — Intentional wall-bay variants (`structural`, `heritage`,
 * `chasm-heritage`, `alcove`) breaking up bare aisle walls between buttresses.
 */
export function buildWallBay(b, sign, halfWidth, z0, z1, variant, index) {
  const midZ = (z0 + z1) * 0.5;
  const xWall = sign * (halfWidth - 0.18);
  const inDir = -sign;

  // Coffered upper cornice & plinth reveal shared by every bay.
  b.prop('carved', stoneBox(0.55, 0.45, 9.6, P(xWall + inDir * 0.1, 6.2, midZ), { bevel: 0.05, irregular: 0.05 }));

  if (variant === 'structural') {
    b.prop('carved', stoneBlock(0.45, 1.3, 9.4, P(xWall + inDir * 0.08, 0, midZ), { bevel: 0.05, batter: 0.08, irregular: 0.05 }));
    for (const dz of [-3.4, 3.4]) {
      b.prop('carved', stoneBlock(0.42, 4.9, 0.62, P(xWall + inDir * 0.12, 1.3, midZ + dz), { bevel: 0.04, irregular: 0.05 }));
    }
    b.prop('masonry', stoneBlock(0.32, 3.8, 5.8, P(xWall + inDir * 0.04, 1.5, midZ), { bevel: 0.05, irregular: 0.06 }), 0xd2d0cc);
    return;
  }

  if (variant === 'heritage' || variant === 'chasm-heritage') {
    const baseY = variant === 'chasm-heritage' ? 1.8 : 0.85;
    // Stepped basalt/bronze relief frame + geometric Vondari Forgeheart diamond crest.
    b.prop('carved', stoneBlock(0.48, 4.9, 6.8, P(xWall + inDir * 0.08, baseY, midZ), { bevel: 0.06, irregular: 0.05 }), 0xdcdad6);
    b.prop('masonry', stoneBlock(0.36, 4.1, 5.8, P(xWall + inDir * 0.18, baseY + 0.4, midZ), { bevel: 0.05, irregular: 0.05 }), 0xbec0c4);
    b.prop('carved', stoneBox(0.42, 2.2, 2.2, P(xWall + inDir * 0.28, baseY + 2.45, midZ), {
      yaw: 0, bevel: 0.08, irregular: 0.04,
    }), 0x9b9fa8);
    // Ceremonial stepped anvil/shield bronze plaque inside relief.
    b.prop('bronze', stoneBox(0.24, 1.35, 1.35, P(xWall + inDir * 0.42, baseY + 2.45, midZ), {
      bevel: 0.03, irregular: 0.03,
    }), 0xd8b478);
    b.prop('iron', stoneBox(0.22, 0.72, 0.72, P(xWall + inDir * 0.48, baseY + 2.45, midZ), {
      bevel: 0.025, irregular: 0.03,
    }), 0x2c2824);
    b.prop('bronze', stoneBox(0.18, 0.14, 5.4, P(xWall + inDir * 0.34, baseY + 0.55, midZ), { bevel: 0.015, irregular: 0.03 }), 0xcba66d);
    b.prop('bronze', stoneBox(0.18, 0.14, 5.4, P(xWall + inDir * 0.34, baseY + 4.3, midZ), { bevel: 0.015, irregular: 0.03 }), 0xcba66d);

    if (variant === 'chasm-heritage') {
      // Hooded iron-and-bronze sconce illuminating the relief above the chasm.
      b.prop('iron', stoneBox(0.75, 0.28, 0.75, P(xWall + inDir * 0.48, baseY + 2.1, midZ - 2.3), { bevel: 0.025 }), 0x2c2824);
      b.prop('iron', stoneBox(0.75, 0.28, 0.75, P(xWall + inDir * 0.48, baseY + 2.1, midZ + 2.3), { bevel: 0.025 }), 0x2c2824);
      for (const dz of [-2.3, 2.3]) {
        b.prop('iron', stoneBox(0.52, 0.08, 0.52, P(xWall + inDir * 0.48, baseY + 2.68, midZ + dz), { bevel: 0.02 }), 0x2c2824);
        for (const [lx, lz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) {
          b.prop('iron', rod(P(xWall + inDir * 0.48 + lx, baseY + 2.22, midZ + dz + lz), P(xWall + inDir * 0.48 + lx, baseY + 2.66, midZ + dz + lz), 0.018, 0.018, 4), 0x2a2623);
        }
        b.prop('glow', box(0.2, 0.28, 0.2, P(xWall + inDir * 0.48, baseY + 2.44, midZ + dz)), '#ff9e38', 2.4);
        b.light(P(xWall + inDir * 1.1, baseY + 2.45, midZ + dz), '#ffd29e', 4.6, 17, { radius: 1.8, halo: 1.3 });
      }
    } else {
      // Restrained carved stone benches flanking the relief bay on solid aisle floors.
      for (const dz of [-2.4, 2.4]) {
        b.prop('carved', stoneBlock(0.75, 0.48, 1.75, P(xWall + inDir * 0.65, 0, midZ + dz), { bevel: 0.04, irregular: 0.05 }));
        b.prop('masonry', stoneBox(0.9, 0.16, 1.95, P(xWall + inDir * 0.65, 0.52, midZ + dz), { bevel: 0.03, irregular: 0.05 }), 0xd8d6d2);
      }
    }
    return;
  }

  // 'alcove': Deep corbelled functional niche with recessed hearth brazier & work/ingot rack.
  for (const dz of [-2.8, 2.8]) {
    b.prop('carved', stoneBlock(0.95, 5.2, 0.95, P(xWall + inDir * 0.45, 0, midZ + dz), { bevel: 0.06, irregular: 0.05 }));
  }
  b.prop('carved', arch(P(xWall + inDir * 0.45, 3.6, midZ - 2.8), P(xWall + inDir * 0.45, 3.6, midZ + 2.8), 2.1, 0.82, 0.95, 11, {
    pointed: 0.2, irregular: 0.05,
  }));
  // Dark recessed backing wall + functional alcove brazier casting warm firelight outward.
  b.prop('carved', stoneBlock(0.28, 5.4, 4.8, P(xWall + inDir * 0.06, 0, midZ), { bevel: 0.04, irregular: 0.05 }), 0x767a84);
  brazier(b, P(xWall + inDir * 0.95, 0, midZ), {
    tint: '#ffd096', intensity: 6.2, range: 19, size: 0.92, trimMaterial: 'carved', bronzeRim: true,
  });
  if (index === 5) {
    // Near-forge functional bay: chamfered timber-and-iron ingot supply bench beside the niche.
    b.prop('timber', stoneBlock(0.78, 0.68, 1.65, P(xWall + inDir * 0.85, 0, midZ + 4.3), { bevel: 0.03, irregular: 0.08 }), 0x6a5038);
    for (const [dy, dz] of [[0.72, -0.35], [0.72, 0.35], [0.84, 0]]) {
      b.prop('bronze', stoneBox(0.44, 0.12, 0.22, P(xWall + inDir * 0.85, dy, midZ + 4.3 + dz), { bevel: 0.02, irregular: 0.04 }), 0xd9b06e);
    }
  }
}

/**
 * Priority 1 — Zone C Hero Forgeheart Gateway at `farZ`:
 * Towering 14.5m stepped basalt-and-ashlar pylons, 15-segment compound portal
 * arch, bronze & iron Forgeheart anvil crest, pinned open fortress doors, and
 * warm recessed forge-hearth silhouette.
 */
export function buildHeroGateway(b, farZ, height) {
  const archSpanX = 5.4;
  // Twin monolithic stepped pylons + outer wing buttresses tying portal to hall walls.
  for (const sign of [-1, 1]) {
    const px = sign * 6.5;
    b.prop('carved', stoneBlock(3.6, 1.25, 3.2, P(px, 0, farZ - 0.6), { bevel: 0.1, batter: 0.14, irregular: 0.05 }));
    b.prop('masonry', stoneBlock(3.1, 8.8, 2.7, P(px, 1.25, farZ - 0.6), { bevel: 0.08, irregular: 0.05 }));
    b.prop('carved', stoneBlock(3.35, 3.8, 2.9, P(px, 10.05, farZ - 0.6), { bevel: 0.09, batter: 0.08, irregular: 0.05 }));
    b.prop('carved', stoneBlock(3.6, 0.85, 3.1, P(px, 13.85, farZ - 0.6), { bevel: 0.08, batter: -0.06, irregular: 0.05 }));
    // Outer wing buttresses grounding the gateway solidly into the nave walls with zero corner gaps.
    b.prop('carved', stoneBlock(7.4, 9.2, 2.2, P(sign * 11.4, 0, farZ - 0.35), { bevel: 0.08, batter: 0.08, irregular: 0.05 }));
    b.prop('masonry', stoneBlock(6.6, 5.4, 2.4, P(sign * 11.4, 1.2, farZ - 0.15), { bevel: 0.06, irregular: 0.05 }), 0xbec0c4);
    // Inner stepped portal jambs & vertical bronze reinforcement straps.
    b.prop('carved', stoneBlock(1.4, 8.4, 2.4, P(sign * 4.85, 0, farZ - 0.5), { bevel: 0.07, irregular: 0.05 }));
    b.prop('bronze', stoneBlock(0.36, 8.1, 0.28, P(sign * 4.35, 0.5, farZ + 0.72), { bevel: 0.025, irregular: 0.03 }), 0xdcb97f);
    b.prop('bronze', stoneBox(0.3, 10.8, 0.3, P(px - sign * 1.1, 6.2, farZ + 0.85), { bevel: 0.025, irregular: 0.03 }), 0xcba66d);

    // Massive open-back ceremonial iron-and-bronze fortress gate leaves inside the portal throat.
    b.prop('iron', stoneBlock(0.34, 8.6, 3.4, P(sign * 4.15, 0, farZ - 2.3), { bevel: 0.03, irregular: 0.04 }), 0x2c2824);
    for (const y of [1.4, 3.8, 6.4]) {
      b.prop('bronze', stoneBox(0.42, 0.28, 3.3, P(sign * 4.12, y, farZ - 2.3), { bevel: 0.02, irregular: 0.03 }), 0xcba66d);
    }

    // Ceremonial flanking floor braziers lighting the gateway threshold.
    brazier(b, P(sign * 5.0, 0, farZ + 4.4), {
      tint: '#ffcb88', intensity: 6.4, range: 24, size: 1.25, trimMaterial: 'carved', bronzeRim: true,
    });
  }

  // Compound monumental Forgeheart portal arch & stepped crown gable relief.
  b.prop('carved', arch(P(-archSpanX, 8.4, farZ - 0.4), P(archSpanX, 8.4, farZ - 0.4), 4.6, 1.55, 2.6, 15, {
    pointed: 0.24, extrados: 1.1, irregular: 0.05,
  }));
  b.prop('masonry', arch(P(-4.8, 8.0, farZ + 0.15), P(4.8, 8.0, farZ + 0.15), 4.1, 0.85, 1.2, 15, {
    pointed: 0.24, extrados: 1.1, irregular: 0.05,
  }), 0xdedcdd);

  // Over-arch stepped pediment wall + Vondari Forgeheart emblem (anvil-and-diamond bronze/iron relief).
  b.prop('masonry', stoneBox(11.6, 2.8, 1.9, P(0, 13.6, farZ - 0.5), { bevel: 0.08, irregular: 0.05 }), 0xbabcc0);
  b.prop('carved', stoneBox(12.6, 0.75, 2.3, P(0, 15.1, farZ - 0.5), { bevel: 0.08, irregular: 0.05 }));
  b.prop('carved', stoneBox(3.4, 3.4, 0.7, P(0, 13.1, farZ + 0.55), { bevel: 0.1, irregular: 0.04 }), 0x8a8f99);
  b.prop('bronze', stoneBox(2.2, 2.2, 0.4, P(0, 13.1, farZ + 0.85), { bevel: 0.04, irregular: 0.03 }), 0xe2c086);
  b.prop('iron', stoneBox(1.5, 0.52, 0.55, P(0, 13.3, farZ + 0.98), { bevel: 0.03, batter: -0.1, irregular: 0.03 }), 0x2f2b27);
  b.prop('bronze', stoneBox(7.8, 0.36, 0.35, P(0, 14.5, farZ + 0.65), { bevel: 0.025, irregular: 0.03 }), 0xcba66d);

  // Stepped bronze-trimmed threshold sill across the portal floor (flush/walkable).
  b.prop('carved', stoneBox(10.6, 0.05, 2.4, P(0, 0.01, farZ + 0.6), { bevel: 0.02, irregular: 0.04 }));
  b.prop('bronze', stoneBox(8.8, 0.06, 0.26, P(0, 0.012, farZ + 1.65), { bevel: 0.015, irregular: 0.02 }), 0xd8b478);

  // Hero warm forge radiance from beyond the opening + front facade rim lighting.
  b.light(P(0, 4.8, farZ - 3.6), '#ffa952', 13.5, 36, { radius: 3.2, halo: 2.0 });
  b.light(P(0, 10.8, farZ + 3.2), '#ffd69e', 4.6, 26, { flat: true });
  b.light(P(0, 5.2, farZ + 6.5), '#d4c8b8', 3.6, 24, { flat: true });
}

/**
 * Priority 6 — Processional floor runner borders, threshold sills, and flush
 * octagonal Forgeheart floor medallions along the hall axis.
 */
export function buildFloorInlay(b, chasmZ, chasmHalf, farZ, medallions = []) {
  for (const sign of [-1, 1]) {
    for (const [z0, z1] of [[-18.5, chasmZ + chasmHalf + 1.2], [chasmZ - chasmHalf - 1.2, farZ + 2.2]]) {
      const len = Math.abs(z0 - z1);
      const midZ = (z0 + z1) * 0.5;
      b.prop('carved', stoneBox(0.68, 0.04, len, P(sign * 3.18, 0.015, midZ), { bevel: 0.015, irregular: 0.02 }));
      b.prop('bronze', stoneBox(0.14, 0.046, len, P(sign * 2.8, 0.016, midZ), { bevel: 0.01, irregular: 0.02 }), 0xd4ae72);
    }
  }
  for (const z of [-19.5, chasmZ + chasmHalf + 2.4, chasmZ - chasmHalf - 2.4, farZ + 9.5]) {
    b.prop('carved', stoneBox(6.8, 0.04, 0.9, P(0, 0.015, z), { bevel: 0.015, irregular: 0.02 }));
    b.prop('bronze', stoneBox(5.6, 0.046, 0.16, P(0, 0.017, z), { bevel: 0.01, irregular: 0.02 }), 0xd4ae72);
  }
  for (const mz of medallions) {
    b.prop('carved', rod(P(0, -0.02, mz), P(0, 0.032, mz), 2.35, 2.35, 8));
    b.prop('bronze', rod(P(0, -0.02, mz), P(0, 0.036, mz), 1.75, 1.75, 8), 0xd4ae72);
    b.prop('masonry', rod(P(0, -0.02, mz), P(0, 0.039, mz), 1.45, 1.45, 8), 0xa8acb4);
    b.prop('bronze', stoneBox(0.9, 0.055, 0.9, P(0, 0.018, mz), { yaw: Math.PI / 4, bevel: 0.015, irregular: 0.02 }), 0xe2c086);
  }
}
