import { arch, box, extrudedProfile, hewnBeam, rod, stoneBlock, stoneBox } from '../gen/propKit.js';
import { brazier } from './kits.js';

const P = (x, y, z) => ({ x, y, z });

/**
 * Shared sculpted Dwarven architectural assets built with beveled extruded
 * profiles: horned Forgeheart anvil relief crest and angular Dwarf-chevron hood.
 */
function forgeAnvilCrest(b, at, scale = 1, yaw = 0) {
  const s = scale;
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  const offset = (right, upY, forward) => ({
    x: at.x + c * right + sn * forward,
    y: at.y + upY,
    z: at.z - sn * right + c * forward,
  });

  // Chamfered octagonal bronze backplate shield.
  const octPts = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    octPts.push([Math.cos(a) * 1.15 * s, Math.sin(a) * 1.15 * s]);
  }
  b.prop('carved', extrudedProfile(octPts, 0.22 * s, { bevel: 0.05 * s, yaw, at: offset(0, 0, 0.04 * s) }), 0x8f949e);
  const innerOct = octPts.map(([px, py]) => [px * 0.82, py * 0.82]);
  b.prop('bronze', extrudedProfile(innerOct, 0.14 * s, { bevel: 0.025 * s, yaw, at: offset(0, 0, 0.14 * s) }), 0xd9b26e);

  // Genuine 3D sculpted Dwarven anvil silhouette (horn, face table, waist, stepped foot).
  const anvilPts = [
    [-0.48 * s, -0.42 * s], [0.48 * s, -0.42 * s], [0.36 * s, -0.22 * s],
    [0.24 * s, -0.18 * s], [0.22 * s, 0.1 * s], [0.52 * s, 0.2 * s],
    [0.82 * s, 0.28 * s], [0.56 * s, 0.36 * s], [-0.52 * s, 0.36 * s],
    [-0.64 * s, 0.2 * s], [-0.24 * s, 0.1 * s], [-0.26 * s, -0.18 * s],
    [-0.38 * s, -0.22 * s],
  ];
  b.prop('iron', extrudedProfile(anvilPts, 0.2 * s, { bevel: 0.03 * s, yaw, at: offset(0, -0.02 * s, 0.22 * s) }), 0x2e2a26);
  // Twin angular mountain chevron wings framing the anvil horn & heel.
  const peakPts = [[-0.68 * s, -0.45 * s], [0, 0.12 * s], [0.68 * s, -0.45 * s], [0.46 * s, -0.45 * s], [0, -0.08 * s], [-0.46 * s, -0.45 * s]];
  b.prop('bronze', extrudedProfile(peakPts, 0.12 * s, { bevel: 0.02 * s, yaw, at: offset(0, 0.36 * s, 0.2 * s) }), 0xe3c288);
}

function chevronHood(width, height, overhang, depth, at, yaw = 0) {
  const hw = width * 0.5;
  const pts = [
    [-hw, 0],
    [0, height],
    [hw, 0],
    [hw * 0.78, -0.28],
    [0, height * 0.62],
    [-hw * 0.78, -0.28],
  ];
  return extrudedProfile(pts, depth + overhang, { bevel: 0.055, yaw, at });
}

/**
 * Zone A — Monumental entrance threshold & gate hall wall niches.
 * Transitions the player from the outer bronze fortress doors into the nave.
 */
export function buildEntranceHall(b, { height = 8 } = {}) {
  for (const sign of [-1, 1]) {
    const x = sign * 6.8;
    b.prop('carved', stoneBlock(2.6, 1.0, 2.2, P(x, 0, -20), { bevel: 0.08, batter: 0.14, irregular: 0.06 }));
    b.prop('masonry', stoneBlock(2.2, 8.2, 1.9, P(x, 1.0, -20), { bevel: 0.07, irregular: 0.06 }));
    b.prop('carved', stoneBlock(2.5, 0.75, 2.1, P(x, 9.2, -20), { bevel: 0.07, batter: -0.08, irregular: 0.05 }));
    b.prop('bronze', stoneBlock(0.28, 7.4, 0.22, P(x - sign * 1.05, 1.2, -19.05), { bevel: 0.02, irregular: 0.04 }), 0xd8b478);

    // Side wall framed blind niche + caged iron wall sconce lantern in the gate hall.
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
 * Compound transverse arches, quadripartite diagonal groin ribs,
 * heavy spinal ridge beam, and carved intersection bosses across the nave ceiling.
 */
export function buildVaultedCeiling(b, bays, { rowX, height, vaultRise, avenueZ, halfLength }) {
  const crownY = height + vaultRise - 0.55;
  for (let i = 0; i < bays.length; i += 1) {
    const z = bays[i];
    b.prop('carved', arch(P(-rowX, height - 0.1, z), P(rowX, height - 0.1, z), vaultRise - 0.7, 1.45, 2.15, 19, {
      pointed: 0.22, extrados: 1.1, irregular: 0.05,
    }));
    b.prop('masonry', arch(P(-rowX, height - 0.35, z), P(rowX, height - 0.35, z), vaultRise - 0.85, 0.74, 1.05, 19, {
      pointed: 0.22, extrados: 1.1, irregular: 0.05,
    }), 0xdedcdd);

    b.prop('carved', stoneBox(2.2, 1.35, 2.4, P(0, crownY, z), { bevel: 0.12, irregular: 0.04 }), 0xebe9e6);
    b.prop('bronze', stoneBox(1.4, 0.28, 1.5, P(0, crownY - 0.58, z), { bevel: 0.03, irregular: 0.04 }), 0xd8b478);

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

  b.prop('carved', stoneBox(1.75, 1.15, halfLength * 2 - 2, P(0, crownY + 0.15, avenueZ), { bevel: 0.1, irregular: 0.04 }), 0xdedcdd);
  b.prop('bronze', stoneBox(0.32, 0.18, halfLength * 2 - 2, P(0, crownY - 0.42, avenueZ), { bevel: 0.02, irregular: 0.03 }), 0xcba66d);
  for (const sign of [-1, 1]) {
    b.prop('carved', stoneBox(0.86, 0.72, halfLength * 2 - 2, P(sign * rowX * 0.54, height + vaultRise * 0.6, avenueZ), { bevel: 0.06, irregular: 0.05 }));
  }
}

/**
 * Distinctive sculpted wall-bay variants (`structural`, `heritage`,
 * `chasm-heritage`, `alcove`) with cantilevered hoods, 3D reliefs, and armory props.
 */
export function buildWallBay(b, sign, halfWidth, z0, z1, variant, index) {
  const midZ = (z0 + z1) * 0.5;
  const xWall = sign * (halfWidth - 0.18);
  const inDir = -sign;
  const faceYaw = sign < 0 ? Math.PI * 0.5 : -Math.PI * 0.5;

  // Deep coffered cornice & molded stone belt across every bay.
  b.prop('carved', stoneBox(0.62, 0.48, 9.6, P(xWall + inDir * 0.14, 6.3, midZ), { bevel: 0.05, irregular: 0.04 }));

  if (variant === 'structural') {
    b.prop('carved', stoneBlock(0.48, 1.35, 9.4, P(xWall + inDir * 0.1, 0, midZ), { bevel: 0.05, batter: 0.1, irregular: 0.05 }));
    for (const dz of [-3.3, 3.3]) {
      b.prop('carved', stoneBlock(0.54, 4.95, 0.76, P(xWall + inDir * 0.18, 1.35, midZ + dz), { bevel: 0.045, irregular: 0.04 }));
      b.prop('bronze', stoneBox(0.6, 0.14, 0.82, P(xWall + inDir * 0.2, 4.2, midZ + dz), { bevel: 0.02 }), 0xcba66d);
    }
    b.prop('carved', arch(P(xWall + inDir * 0.22, 4.0, midZ - 3.3), P(xWall + inDir * 0.22, 4.0, midZ + 3.3), 1.9, 0.68, 0.72, 11, {
      pointed: 0.18, irregular: 0.04,
    }));
    b.prop('masonry', stoneBlock(0.32, 3.6, 5.6, P(xWall + inDir * 0.05, 1.45, midZ), { bevel: 0.05, irregular: 0.05 }), 0xc8cace);
    return;
  }

  if (variant === 'heritage' || variant === 'chasm-heritage') {
    const isChasm = variant === 'chasm-heritage';
    const baseY = isChasm ? 2.1 : 0.75;
    const shrineZ = midZ;

    // Fluted half-columns projecting cleanly from the wall framing the tabernacle.
    for (const dz of [-3.3, 3.3]) {
      b.prop('carved', stoneBlock(0.95, 0.65, 0.95, P(xWall + inDir * 0.36, baseY, shrineZ + dz), { bevel: 0.05, batter: 0.12, irregular: 0.04 }));
      b.prop('masonry', rod(
        P(xWall + inDir * 0.38, baseY + 0.65, shrineZ + dz),
        P(xWall + inDir * 0.38, baseY + 3.95, shrineZ + dz),
        0.34, 0.31, 8,
      ), 0xdadce0);
      b.prop('carved', stoneBox(0.86, 0.45, 0.86, P(xWall + inDir * 0.4, baseY + 4.18, shrineZ + dz), { bevel: 0.045, batter: -0.1, irregular: 0.04 }));
    }

    // Overhanging extruded Dwarf-Chevron Gable Hood casting dramatic shadow across the shrine recess.
    b.prop('carved', chevronHood(7.8, 1.35, 0.55, 0.55, P(xWall + inDir * 0.45, baseY + 4.35, shrineZ), faceYaw), 0xdedbd6);
    b.prop('bronze', stoneBox(0.24, 0.16, 7.2, P(xWall + inDir * 0.76, baseY + 4.35, shrineZ), { bevel: 0.02 }), 0xd4ae72);

    // Recessed dark backing stele + 3D extruded Forgeheart Anvil & Mountain Crest.
    b.prop('carved', stoneBlock(0.32, 3.8, 5.4, P(xWall + inDir * 0.12, baseY + 0.45, shrineZ), { bevel: 0.05, irregular: 0.04 }), 0x8f949e);
    forgeAnvilCrest(b, P(xWall + inDir * 0.28, baseY + 2.45, shrineZ), isChasm ? 1.1 : 1.2, faceYaw);

    if (isChasm) {
      // Cantilevered stepped stone brackets supporting twin beacon obelisk lanterns over the chasm.
      for (const dz of [-2.35, 2.35]) {
        b.prop('carved', hewnBeam(
          P(xWall + inDir * 0.1, baseY - 0.55, shrineZ + dz),
          P(xWall + inDir * 0.82, baseY + 0.15, shrineZ + dz),
          0.56, 0.42, { bevel: 0.04, irregular: 0.04 },
        ));
        b.prop('iron', stoneBlock(0.68, 0.34, 0.68, P(xWall + inDir * 0.66, baseY + 0.2, shrineZ + dz), { bevel: 0.025 }), 0x2c2824);
        b.prop('iron', stoneBox(0.48, 0.08, 0.48, P(xWall + inDir * 0.66, baseY + 0.96, shrineZ + dz), { bevel: 0.02 }), 0x2c2824);
        for (const [lx, lz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) {
          b.prop('iron', rod(P(xWall + inDir * 0.66 + lx, baseY + 0.52, shrineZ + dz + lz), P(xWall + inDir * 0.66 + lx, baseY + 0.94, shrineZ + dz + lz), 0.018, 0.018, 4), 0x2a2623);
        }
        b.prop('glow', box(0.2, 0.28, 0.2, P(xWall + inDir * 0.66, baseY + 0.72, shrineZ + dz)), '#ff9e38', 2.4);
        b.light(P(xWall + inDir * 1.15, baseY + 0.85, shrineZ + dz), '#ffd29e', 4.6, 17, { radius: 1.8, halo: 1.3 });
      }
    } else {
      // Hooded downward-grazing amber sconce directly lighting the 3D carved crest + flanking stone benches.
      b.prop('iron', stoneBox(0.32, 0.24, 0.55, P(xWall + inDir * 0.62, baseY + 4.05, shrineZ), { bevel: 0.02 }), 0x2c2824);
      b.prop('glow', box(0.22, 0.14, 0.34, P(xWall + inDir * 0.64, baseY + 3.92, shrineZ)), '#ffaa44', 2.2);
      b.light(P(xWall + inDir * 1.1, baseY + 3.4, shrineZ), '#ffd29a', 4.2, 14, { radius: 1.4, halo: 0.9 });
      for (const dz of [-2.2, 2.2]) {
        b.prop('carved', stoneBlock(0.75, 0.48, 1.75, P(xWall + inDir * 0.65, 0, shrineZ + dz), { bevel: 0.04, irregular: 0.04 }));
        b.prop('masonry', stoneBox(0.9, 0.16, 1.95, P(xWall + inDir * 0.65, 0.52, shrineZ + dz), { bevel: 0.03, irregular: 0.04 }), 0xd8d6d2);
      }
    }
    return;
  }

  // 'alcove': Vaulted hearth cove with corbelled stone chimney cowl, stepped hearth curb, caged brazier & tool rack.
  for (const dz of [-2.8, 2.8]) {
    b.prop('carved', stoneBlock(1.0, 5.2, 0.98, P(xWall + inDir * 0.45, 0, midZ + dz), { bevel: 0.06, irregular: 0.05 }));
    b.prop('bronze', stoneBox(1.06, 0.14, 1.04, P(xWall + inDir * 0.45, 3.5, midZ + dz), { bevel: 0.02 }), 0xcba66d);
  }
  b.prop('carved', arch(P(xWall + inDir * 0.45, 3.6, midZ - 2.8), P(xWall + inDir * 0.45, 3.6, midZ + 2.8), 2.1, 0.84, 0.98, 11, {
    pointed: 0.2, irregular: 0.04,
  }));
  // Corbelled stone chimney flue cowl tapering cleanly up from hearth above brazier to upper cornice.
  b.prop('carved', stoneBlock(0.85, 1.9, 2.4, P(xWall + inDir * 0.5, 3.1, midZ), { bevel: 0.06, batter: 0.34, irregular: 0.05 }), 0x8f949e);
  b.prop('carved', stoneBlock(0.65, 1.4, 1.5, P(xWall + inDir * 0.4, 5.0, midZ), { bevel: 0.05, batter: 0.18, irregular: 0.04 }), 0x8f949e);
  b.prop('carved', stoneBlock(0.28, 5.4, 4.8, P(xWall + inDir * 0.06, 0, midZ), { bevel: 0.04, irregular: 0.05 }), 0x828792);
  // Stepped low stone hearth apron framing the alcove brazier.
  b.prop('carved', stoneBlock(1.75, 0.16, 3.0, P(xWall + inDir * 0.88, 0, midZ), { bevel: 0.03, irregular: 0.04 }));
  brazier(b, P(xWall + inDir * 0.98, 0.16, midZ), {
    tint: '#ffd096', intensity: 6.4, range: 20, size: 0.9, trimMaterial: 'carved', bronzeRim: true,
  });

  if (index === 5) {
    // Forgemaster ingot workbench + standing forged great-hammer beside the near-forge alcove.
    const bz = midZ + 4.35;
    b.prop('timber', stoneBlock(0.78, 0.68, 1.65, P(xWall + inDir * 0.85, 0, bz), { bevel: 0.03, irregular: 0.08 }), 0x6a5038);
    for (const [dy, dz] of [[0.72, -0.35], [0.72, 0.35], [0.84, 0]]) {
      b.prop('bronze', stoneBox(0.44, 0.12, 0.22, P(xWall + inDir * 0.85, dy, bz + dz), { bevel: 0.02, irregular: 0.04 }), 0xd9b06e);
    }
    // Leaning forged hammer beside the rack.
    b.prop('timber', hewnBeam(P(xWall + inDir * 0.65, 0.05, bz + 0.95), P(xWall + inDir * 0.35, 1.45, bz + 0.95), 0.08, 0.08), 0x5c422c);
    b.prop('iron', stoneBox(0.32, 0.24, 0.44, P(xWall + inDir * 0.36, 1.42, bz + 0.95), { bevel: 0.03 }), 0x35312c);
  }
}

/**
 * Zone C Hero Forgeheart Gateway at `farZ`:
 * Trapezoidal battered bastion flanks bridging solidly to hall walls, twin
 * guardian beacon pylons, Dwarf-chevron gable canopy with high-relief 3D
 * Forgeheart Anvil Crest, riveted X-braced fortress doors, and censer lamp.
 */
export function buildHeroGateway(b, farZ, height) {
  const archSpanX = 5.4;
  // Battered trapezoidal bastion flank profile spanning from pylon edge outward into the hall walls.
  const wingPts = [[-3.7, 0], [3.7, 0], [2.4, 9.2], [-3.7, 9.2]];

  for (const sign of [-1, 1]) {
    const px = sign * 6.5;
    b.prop('carved', stoneBlock(3.6, 1.25, 3.2, P(px, 0, farZ - 0.6), { bevel: 0.1, batter: 0.14, irregular: 0.05 }));
    b.prop('masonry', stoneBlock(3.1, 8.8, 2.7, P(px, 1.25, farZ - 0.6), { bevel: 0.08, irregular: 0.05 }));
    b.prop('carved', stoneBlock(3.35, 3.2, 2.9, P(px, 10.05, farZ - 0.6), { bevel: 0.09, batter: 0.08, irregular: 0.05 }));
    b.prop('carved', stoneBlock(3.6, 0.85, 3.1, P(px, 13.25, farZ - 0.6), { bevel: 0.08, batter: -0.06, irregular: 0.05 }));

    // Sculpted battered bastion wing flanks closing cleanly into side walls at x = ±15.1.
    b.prop('carved', extrudedProfile(
      wingPts.map(([u, v]) => [sign * u, v]),
      2.3,
      { bevel: 0.08, at: P(sign * 11.4, 0, farZ - 0.35) },
    ));
    b.prop('masonry', stoneBlock(6.6, 5.4, 2.45, P(sign * 11.4, 1.2, farZ - 0.15), { bevel: 0.06, irregular: 0.05 }), 0xbec0c4);

    // Guardian shoulder obelisk beacon crowning the inner wing bastion at y = 7.4.
    b.prop('carved', stoneBlock(1.4, 3.0, 1.4, P(sign * 9.2, 7.4, farZ + 0.15), { bevel: 0.07, batter: 0.24, irregular: 0.04 }));
    b.prop('bronze', stoneBox(1.1, 0.16, 1.1, P(sign * 9.2, 10.45, farZ + 0.15), { bevel: 0.025 }), 0xd8b478);
    b.prop('iron', rod(P(sign * 9.2, 10.55, farZ + 0.15), P(sign * 9.2, 10.95, farZ + 0.15), 0.36, 0.5, 8), 0x2c2824);
    b.prop('glow', rod(P(sign * 9.2, 10.9, farZ + 0.15), P(sign * 9.2, 11.25, farZ + 0.15), 0.34, 0.12, 8), '#ff8c2c', 2.4);
    b.light(P(sign * 9.2, 11.4, farZ + 0.35), '#ffc682', 4.0, 18, { radius: 1.6, halo: 1.4 });

    // Inner stepped portal jambs & recessed bronze-banded pilasters with clamp collars.
    b.prop('carved', stoneBlock(1.4, 8.4, 2.4, P(sign * 4.85, 0, farZ - 0.5), { bevel: 0.07, irregular: 0.05 }));
    b.prop('bronze', stoneBlock(0.34, 8.1, 0.24, P(sign * 4.32, 0.5, farZ + 0.72), { bevel: 0.025, irregular: 0.03 }), 0xdcb97f);
    b.prop('carved', stoneBox(0.75, 10.8, 0.45, P(px - sign * 1.1, 6.2, farZ + 0.72), { bevel: 0.05, irregular: 0.04 }), 0x8f949e);
    for (const cy of [2.4, 5.2, 8.0, 10.6]) {
      b.prop('bronze', stoneBox(0.92, 0.24, 0.54, P(px - sign * 1.1, cy, farZ + 0.76), { bevel: 0.025 }), 0xd8b478);
    }

    // Artisan riveted iron & bronze fortress gate leaves with diagonal X-truss bracing and central roundel.
    b.prop('iron', stoneBlock(0.36, 8.6, 3.4, P(sign * 4.15, 0, farZ - 2.3), { bevel: 0.03, irregular: 0.04 }), 0x2c2824);
    b.prop('bronze', stoneBlock(0.42, 8.6, 0.26, P(sign * 4.14, 0, farZ - 0.72), { bevel: 0.02 }), 0xcba66d);
    b.prop('bronze', stoneBlock(0.42, 8.6, 0.26, P(sign * 4.14, 0, farZ - 3.88), { bevel: 0.02 }), 0xcba66d);
    for (const y of [1.4, 4.2, 7.0]) {
      b.prop('bronze', stoneBox(0.44, 0.28, 3.3, P(sign * 4.12, y, farZ - 2.3), { bevel: 0.02, irregular: 0.03 }), 0xcba66d);
    }
    b.prop('bronze', hewnBeam(P(sign * 4.1, 1.5, farZ - 3.8), P(sign * 4.1, 6.9, farZ - 0.8), 0.2, 0.2), 0xd4ae72);
    b.prop('bronze', hewnBeam(P(sign * 4.1, 6.9, farZ - 3.8), P(sign * 4.1, 1.5, farZ - 0.8), 0.2, 0.2), 0xd4ae72);
    b.prop('bronze', rod(P(sign * 3.92, 4.2, farZ - 2.3), P(sign * 4.32, 4.2, farZ - 2.3), 0.48, 0.48, 8), 0xe2c086);

    brazier(b, P(sign * 5.0, 0, farZ + 4.4), {
      tint: '#ffcb88', intensity: 6.4, range: 24, size: 1.25, trimMaterial: 'carved', bronzeRim: true,
    });
  }

  // Compound monumental Forgeheart portal arch & stepped keystone voussoir crown.
  b.prop('carved', arch(P(-archSpanX, 8.2, farZ - 0.4), P(archSpanX, 8.2, farZ - 0.4), 4.4, 1.55, 2.6, 15, {
    pointed: 0.24, extrados: 1.1, irregular: 0.05,
  }));
  b.prop('masonry', arch(P(-4.8, 7.8, farZ + 0.15), P(4.8, 7.8, farZ + 0.15), 3.9, 0.85, 1.2, 15, {
    pointed: 0.24, extrados: 1.1, irregular: 0.05,
  }), 0xdedcdd);

  // Crowned Dwarf-Chevron Pediment Architrave + high-relief 3D Forgeheart Anvil Crest (well inside sightline y = 12..14.4).
  b.prop('masonry', stoneBox(11.6, 2.3, 1.9, P(0, 12.9, farZ - 0.5), { bevel: 0.08, irregular: 0.05 }), 0xbabcc0);
  b.prop('carved', chevronHood(12.8, 2.0, 0.7, 2.4, P(0, 13.7, farZ - 0.2)), 0x9da3ad);
  b.prop('bronze', stoneBox(9.2, 0.32, 0.35, P(0, 13.75, farZ + 0.72), { bevel: 0.025 }), 0xcba66d);
  forgeAnvilCrest(b, P(0, 12.6, farZ + 0.65), 1.45, 0);

  // Hanging forged gatehouse censer lantern centered in upper portal throat.
  b.prop('iron', rod(P(0, 11.7, farZ - 1.1), P(0, 9.6, farZ - 1.1), 0.04, 0.04, 6), 0x2a2521);
  b.prop('iron', rod(P(0, 9.2, farZ - 1.1), P(0, 9.65, farZ - 1.1), 0.55, 0.35, 8), 0x2c2824);
  b.prop('bronze', rod(P(0, 9.3, farZ - 1.1), P(0, 9.48, farZ - 1.1), 0.58, 0.58, 8), 0xd8b478);
  b.prop('glow', rod(P(0, 9.1, farZ - 1.1), P(0, 9.32, farZ - 1.1), 0.36, 0.16, 8), '#ff9c34', 2.4);
  b.light(P(0, 9.0, farZ - 1.1), '#ffc884', 4.2, 18, { radius: 1.5, halo: 1.3 });

  // Stepped bronze-trimmed threshold sill across the portal floor (flush/walkable).
  b.prop('carved', stoneBox(10.6, 0.05, 2.4, P(0, 0.015, farZ + 0.6), { bevel: 0.02, irregular: 0.03 }));
  b.prop('bronze', stoneBox(8.8, 0.06, 0.26, P(0, 0.018, farZ + 1.65), { bevel: 0.015, irregular: 0.02 }), 0xd8b478);

  // Hero warm forge radiance from beyond the opening + front facade rim lighting.
  b.light(P(0, 4.8, farZ - 3.6), '#ffa952', 13.5, 36, { radius: 3.2, halo: 2.0 });
  b.light(P(0, 10.8, farZ + 3.2), '#ffd69e', 4.8, 26, { flat: true });
  b.light(P(0, 5.2, farZ + 6.5), '#d4c8b8', 3.6, 24, { flat: true });
}

/**
 * Processional floor runner borders, threshold sills, and flush
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
