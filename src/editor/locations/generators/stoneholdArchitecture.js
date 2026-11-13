import { emitRadialArch, coursedMasonryWall } from '../gen/dwarvenMasonry.js';
import { box, extrudedProfile, hewnBeam, rod, stoneBlock, stoneBox } from '../gen/propKit.js';
import { brazier } from './kits.js';

const P = (x, y, z) => ({ x, y, z });
const WALL_COURSE_HEIGHT = 0.82;

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
  b.prop('carved', extrudedProfile(octPts, 0.22 * s, { bevel: 0.05 * s, yaw, at: offset(0, 0, 0.04 * s) }), 0x8a8f9a);
  const innerOct = octPts.map(([px, py]) => [px * 0.82, py * 0.82]);
  b.prop('bronze', extrudedProfile(innerOct, 0.14 * s, { bevel: 0.025 * s, yaw, at: offset(0, 0, 0.14 * s) }), 0xd6af6c);

  // Genuine 3D sculpted Dwarven anvil silhouette (horn, face table, waist, stepped foot).
  const anvilPts = [
    [-0.48 * s, -0.42 * s], [0.48 * s, -0.42 * s], [0.36 * s, -0.22 * s],
    [0.24 * s, -0.18 * s], [0.22 * s, 0.1 * s], [0.52 * s, 0.2 * s],
    [0.82 * s, 0.28 * s], [0.56 * s, 0.36 * s], [-0.52 * s, 0.36 * s],
    [-0.64 * s, 0.2 * s], [-0.24 * s, 0.1 * s], [-0.26 * s, -0.18 * s],
    [-0.38 * s, -0.22 * s],
  ];
  b.prop('iron', extrudedProfile(anvilPts, 0.2 * s, { bevel: 0.03 * s, yaw, at: offset(0, -0.02 * s, 0.22 * s) }), 0x2c2824);
  const peakPts = [[-0.68 * s, -0.45 * s], [0, 0.12 * s], [0.68 * s, -0.45 * s], [0.46 * s, -0.45 * s], [0, -0.08 * s], [-0.46 * s, -0.45 * s]];
  b.prop('bronze', extrudedProfile(peakPts, 0.12 * s, { bevel: 0.02 * s, yaw, at: offset(0, 0.36 * s, 0.2 * s) }), 0xe0bf84);
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

function lanternCage(b, at, lightColor = '#ffd29e', intensity = 3.4, range = 14) {
  b.prop('iron', stoneBox(0.46, 0.08, 0.56, P(at.x, at.y + 0.22, at.z), { bevel: 0.02 }), 0x2c2824);
  for (const [lx, lz] of [[-0.14, -0.14], [0.14, -0.14], [-0.14, 0.14], [0.14, 0.14]]) {
    b.prop('iron', rod(P(at.x + lx, at.y - 0.2, at.z + lz), P(at.x + lx, at.y + 0.2, at.z + lz), 0.018, 0.018, 4), 0x2a2623);
  }
  b.prop('glow', box(0.2, 0.28, 0.2, at), '#ff9e38', 2.2);
  b.light(at, lightColor, intensity, range, { radius: 1.5, halo: 1.2 });
}

/**
 * Zone A — Monumental entrance threshold & coursed masonry gate hall with
 * arched blind shrine niches and true radial voussoir threshold arch.
 */
export function buildEntranceHall(b, { height = 8 } = {}) {
  for (const sign of [-1, 1]) {
    const x = sign * 6.8;
    b.prop('carved', stoneBlock(2.6, 1.0, 2.2, P(x, 0, -20), { bevel: 0.08, batter: 0.14, irregular: 0.05 }));
    b.prop('masonry', stoneBlock(2.2, 8.2, 1.9, P(x, 1.0, -20), { bevel: 0.07, irregular: 0.05 }));
    b.prop('carved', stoneBlock(2.5, 0.75, 2.1, P(x, 9.2, -20), { bevel: 0.07, batter: -0.08, irregular: 0.04 }));
    b.prop('bronze', stoneBlock(0.28, 7.4, 0.22, P(x - sign * 1.05, 1.2, -19.05), { bevel: 0.02, irregular: 0.03 }), 0xd8b478);

    // Side wall coursed ashlar lining (`z = -4.2 .. -18.8`) split around the arched shrine opening.
    const wx = sign * 7.62;
    const inDir = -sign;
    coursedMasonryWall(b, P(wx, 0, -4.2), P(wx, 0, -18.8), 7.8, 0.64, {
      courseHeight: WALL_COURSE_HEIGHT,
      openings: [{ s: 6.3, sill: 0.85, width: 4.0, height: 4.55, profile: 'round', dressed: true }],
      baseTint: 0xe6e4e0,
      trimTint: 0xf0ede7,
    });
    // Recessed dark stone blind-niche backplate inside the dressed arch opening.
    b.prop('carved', stoneBlock(0.28, 4.6, 3.8, P(sign * 7.9, 0.85, -10.5), { bevel: 0.04, irregular: 0.04 }), 0x858a94);
    b.prop('bronze', stoneBox(0.24, 1.8, 1.2, P(wx + inDir * 0.28, 3.3, -10.5), { bevel: 0.03, irregular: 0.03 }), 0xc9a56b);
    b.prop('iron', stoneBox(0.5, 0.26, 0.65, P(wx + inDir * 0.42, 4.4, -10.5), { bevel: 0.02, irregular: 0.03 }), 0x2c2824);
    lanternCage(b, P(wx + inDir * 0.42, 4.7, -10.5), '#ffd29e', 3.2, 14);
  }

  emitRadialArch(b, 'carved', P(-6.8, height + 1.2, -20), P(6.8, height + 1.2, -20), 4.2, 1.32, 2.05, 15, {
    pointed: 0.22, tint: 0xe8e5e0, keystoneTint: 0xf4f1eb, irregular: 0.04,
  });
}

/**
 * Cleanly stratified vaulted ceiling: heavy Tier-1 radial voussoir transverse
 * ribs with proud keystones, slender Tier-2 diagonal groin ribs meeting at
 * octagonal bosses, and a restrained spinal ridge rib.
 */
export function buildVaultedCeiling(b, bays, { rowX, height, vaultRise, avenueZ, halfLength }) {
  const crownY = height + vaultRise - 0.55;
  for (let i = 0; i < bays.length; i += 1) {
    const z = bays[i];
    // Tier 1 — Monumental primary transverse arch ring + inner soffit order.
    emitRadialArch(b, 'carved', P(-rowX, height - 0.15, z), P(rowX, height - 0.15, z), vaultRise - 0.65, 1.55, 2.25, 19, {
      pointed: 0.22, tint: 0xe6e3de, keystoneTint: 0xf4f0ea, irregular: 0.04,
    });
    emitRadialArch(b, 'masonry', P(-rowX, height - 0.35, z), P(rowX, height - 0.35, z), vaultRise - 0.85, 0.78, 1.15, 19, {
      pointed: 0.22, tint: 0xdad8d4, keystoneTint: 0xebe8e2, irregular: 0.04,
    });

    b.prop('carved', stoneBox(2.3, 1.4, 2.45, P(0, crownY, z), { bevel: 0.12, irregular: 0.04 }), 0xe8e5e0);
    b.prop('bronze', stoneBox(1.38, 0.26, 1.48, P(0, crownY - 0.6, z), { bevel: 0.03, irregular: 0.03 }), 0xd8b478);

    if (i < bays.length - 1) {
      const midZ = (z + bays[i + 1]) * 0.5;
      b.prop('carved', stoneBox(1.75, 1.08, 1.75, P(0, crownY - 0.15, midZ), { yaw: Math.PI / 4, bevel: 0.1, irregular: 0.04 }), 0xe2dfd9);
      b.prop('bronze', stoneBox(0.86, 0.22, 0.86, P(0, crownY - 0.68, midZ), { yaw: Math.PI / 4, bevel: 0.025, irregular: 0.03 }), 0xd8b478);
      // Tier 2 — Clean quadripartite diagonal groin ribs seating cleanly from pier imposts into the bay boss.
      for (const sign of [-1, 1]) {
        for (const endZ of [z, bays[i + 1]]) {
          b.prop('carved', hewnBeam(
            P(sign * (rowX - 0.35), height + 0.15, endZ),
            P(0, crownY - 0.15, midZ),
            0.54, 0.62, { bevel: 0.05, irregular: 0.04 },
          ), 0xcfd2d8);
        }
      }
    }
  }

  // Central longitudinal ridge rib linking the transverse and groin bosses cleanly along the nave apex.
  b.prop('carved', stoneBox(1.48, 1.0, halfLength * 2 - 2, P(0, crownY + 0.18, avenueZ), { bevel: 0.09, irregular: 0.04 }), 0xd6d8dc);
  b.prop('bronze', stoneBox(0.28, 0.16, halfLength * 2 - 2, P(0, crownY - 0.34, avenueZ), { bevel: 0.02, irregular: 0.03 }), 0xcba66d);
}

/**
 * Context-aware coursed ashlar wall bays (`structural`, `heritage`,
 * `chasm-heritage`, `alcove`) terminating cleanly against bay buttresses,
 * opening flush around recessed alcoves, and clearing the chasm edge cleanly.
 */
export function buildWallBay(b, sign, halfWidth, height, galleryY, z0, z1, variant, index, chasm) {
  const zHigh = Math.max(z0, z1) - 0.58;
  const zLow = Math.min(z0, z1) + 0.58;
  const baySpan = zHigh - zLow;
  const midZ = (z0 + z1) * 0.5;
  const xWall = sign * (halfWidth - 0.44);
  const inDir = -sign;
  const faceYaw = sign < 0 ? Math.PI * 0.5 : -Math.PI * 0.5;

  // Bay-scoped coursed ashlar masonry wall (courses end flush at buttresses & split around openings).
  if (variant === 'chasm-heritage' && chasm) {
    const gapHigh = chasm.z + chasm.half + 0.45;
    const gapLow = chasm.z - chasm.half - 0.45;
    if (zHigh - gapHigh > 0.6) {
      coursedMasonryWall(b, P(xWall, 0, zHigh), P(xWall, 0, gapHigh), galleryY - 0.1, 0.68, {
        courseHeight: WALL_COURSE_HEIGHT,
        baseTint: 0xe6e4e0,
        trimTint: 0xefede8,
      });
    }
    if (gapLow - zLow > 0.6) {
      coursedMasonryWall(b, P(xWall, 0, gapLow), P(xWall, 0, zLow), galleryY - 0.1, 0.68, {
        courseHeight: WALL_COURSE_HEIGHT,
        baseTint: 0xe6e4e0,
        trimTint: 0xefede8,
      });
    }
    // Upper arched spandrel course block cleanly bridging above the open chasm edge below the gallery sill.
    coursedMasonryWall(b, P(xWall, 2.0, gapHigh + 0.1), P(xWall, 2.0, gapLow - 0.1), galleryY - 2.1, 0.68, {
      courseHeight: WALL_COURSE_HEIGHT,
      baseTint: 0xe6e4e0,
      trimTint: 0xefede8,
    });
  } else {
    const openings = [];
    if (variant === 'alcove') {
      openings.push({ s: baySpan * 0.5, sill: 0, width: 4.8, height: 5.45, profile: 'pointed', dressed: true });
    } else if (variant === 'heritage') {
      openings.push({ s: baySpan * 0.5, sill: 0.78, width: 5.2, height: 4.15, profile: 'segmental', dressed: true });
    }
    coursedMasonryWall(b, P(xWall, 0, zHigh), P(xWall, 0, zLow), galleryY - 0.1, 0.68, {
      courseHeight: WALL_COURSE_HEIGHT,
      openings,
      baseTint: 0xe6e4e0,
      trimTint: 0xefede8,
    });
  }

  // Deep molded cornice belt capping each bay cleanly under the gallery sill.
  b.prop('carved', stoneBox(0.76, 0.44, baySpan + 0.15, P(xWall + inDir * 0.18, 6.42, midZ), { bevel: 0.05, irregular: 0.04 }), 0xe8e5e0);

  if (variant === 'structural') {
    for (const dz of [-3.3, 3.3]) {
      b.prop('carved', stoneBlock(0.46, 3.9, 0.72, P(xWall + inDir * 0.34, 0.15, midZ + dz), { bevel: 0.045, irregular: 0.04 }));
      b.prop('bronze', stoneBox(0.52, 0.14, 0.78, P(xWall + inDir * 0.36, 4.05, midZ + dz), { bevel: 0.02 }), 0xcba66d);
    }
    emitRadialArch(b, 'carved', P(xWall + inDir * 0.36, 4.0, midZ - 3.3), P(xWall + inDir * 0.36, 4.0, midZ + 3.3), 1.9, 0.68, 0.62, 11, {
      pointed: 0.18, tint: 0xe2dfd9, keystoneTint: 0xf0ede7, irregular: 0.04,
    });
    return;
  }

  if (variant === 'heritage' || variant === 'chasm-heritage') {
    const isChasm = variant === 'chasm-heritage';
    const baseY = isChasm ? 2.1 : 0.78;
    const shrineZ = midZ;

    // Fluted half-columns projecting cleanly in front of the dressed wall jambs.
    for (const dz of [-3.2, 3.2]) {
      b.prop('carved', stoneBlock(0.86, 0.62, 0.86, P(xWall + inDir * 0.44, baseY, shrineZ + dz), { bevel: 0.05, batter: 0.12, irregular: 0.04 }));
      b.prop('masonry', rod(
        P(xWall + inDir * 0.46, baseY + 0.62, shrineZ + dz),
        P(xWall + inDir * 0.46, baseY + 3.85, shrineZ + dz),
        0.32, 0.29, 8,
      ), 0xdadce0);
      b.prop('carved', stoneBox(0.8, 0.42, 0.8, P(xWall + inDir * 0.48, baseY + 4.06, shrineZ + dz), { bevel: 0.045, batter: -0.1, irregular: 0.04 }));
    }

    // Overhanging extruded Dwarf-Chevron Gable Hood casting dramatic shadow across the shrine recess.
    b.prop('carved', chevronHood(7.6, 1.3, 0.55, 0.58, P(xWall + inDir * 0.52, baseY + 4.24, shrineZ), faceYaw), 0xdedbd6);
    b.prop('bronze', stoneBox(0.24, 0.15, 7.0, P(xWall + inDir * 0.82, baseY + 4.24, shrineZ), { bevel: 0.02 }), 0xd4ae72);

    // Recessed dark backing stele behind the arched opening + 3D extruded Forgeheart Anvil Crest.
    b.prop('carved', stoneBlock(0.28, 3.9, 5.1, P(sign * (halfWidth - 0.08), baseY + 0.25, shrineZ), { bevel: 0.04, irregular: 0.04 }), 0x7c818c);
    forgeAnvilCrest(b, P(xWall + inDir * 0.18, baseY + 2.35, shrineZ), isChasm ? 1.05 : 1.18, faceYaw);

    if (isChasm) {
      for (const dz of [-2.35, 2.35]) {
        b.prop('carved', hewnBeam(
          P(xWall + inDir * 0.12, baseY - 0.55, shrineZ + dz),
          P(xWall + inDir * 0.84, baseY + 0.15, shrineZ + dz),
          0.54, 0.4, { bevel: 0.04, irregular: 0.04 },
        ));
        b.prop('iron', stoneBlock(0.64, 0.34, 0.64, P(xWall + inDir * 0.68, baseY + 0.2, shrineZ + dz), { bevel: 0.025 }), 0x2c2824);
        lanternCage(b, P(xWall + inDir * 0.68, baseY + 0.72, shrineZ + dz), '#ffd29e', 4.2, 16);
      }
    } else {
      b.prop('iron', stoneBox(0.32, 0.24, 0.55, P(xWall + inDir * 0.68, baseY + 3.96, shrineZ), { bevel: 0.02 }), 0x2c2824);
      b.prop('glow', box(0.22, 0.14, 0.34, P(xWall + inDir * 0.7, baseY + 3.84, shrineZ)), '#ffaa44', 2.0);
      b.light(P(xWall + inDir * 1.15, baseY + 3.3, shrineZ), '#ffd29a', 3.6, 14, { radius: 1.4, halo: 0.9 });
      for (const dz of [-2.2, 2.2]) {
        b.prop('carved', stoneBlock(0.75, 0.48, 1.75, P(xWall + inDir * 0.75, 0, shrineZ + dz), { bevel: 0.04, irregular: 0.04 }));
        b.prop('masonry', stoneBox(0.9, 0.16, 1.95, P(xWall + inDir * 0.75, 0.52, shrineZ + dz), { bevel: 0.03, irregular: 0.04 }), 0xd8d6d2);
      }
    }
    return;
  }

  // 'alcove': Real split-course pointed arch recess revealing dark inner back wall, hearth apron & flue cowl.
  b.prop('carved', stoneBlock(0.28, 5.4, 5.0, P(sign * (halfWidth + 0.52), 0, midZ), { bevel: 0.04, irregular: 0.04 }), 0x6f7480);
  // Inner flanking return jamb blocks tying the carved pocket cleanly into the outer rock wall.
  for (const dz of [-2.42, 2.42]) {
    b.prop('carved', stoneBlock(0.95, 3.6, 0.38, P(sign * (halfWidth + 0.02), 0, midZ + dz), { bevel: 0.03, irregular: 0.04 }), 0x808590);
  }
  b.prop('carved', stoneBlock(0.68, 1.5, 2.0, P(xWall + inDir * 0.08, 3.15, midZ), { bevel: 0.06, batter: 0.3, irregular: 0.04 }), 0xa4a9b2);
  b.prop('carved', stoneBlock(0.52, 1.15, 1.35, P(xWall + inDir * 0.02, 4.65, midZ), { bevel: 0.05, batter: 0.16, irregular: 0.04 }), 0xa4a9b2);
  // Stepped low stone hearth apron framing the alcove brazier.
  b.prop('carved', stoneBlock(1.75, 0.16, 3.0, P(xWall + inDir * 0.88, 0, midZ), { bevel: 0.03, irregular: 0.04 }));
  brazier(b, P(xWall + inDir * 0.98, 0.16, midZ), {
    tint: '#ffd096', intensity: 5.2, range: 19, size: 0.88, trimMaterial: 'carved', bronzeRim: true,
  });

  if (index === 5) {
    const bz = midZ + 4.35;
    b.prop('timber', stoneBlock(0.78, 0.68, 1.65, P(xWall + inDir * 0.9, 0, bz), { bevel: 0.03, irregular: 0.08 }), 0x6a5038);
    for (const [dy, dz] of [[0.72, -0.35], [0.72, 0.35], [0.84, 0]]) {
      b.prop('bronze', stoneBox(0.44, 0.12, 0.22, P(xWall + inDir * 0.9, dy, bz + dz), { bevel: 0.02, irregular: 0.04 }), 0xd9b06e);
    }
    b.prop('timber', hewnBeam(P(xWall + inDir * 0.72, 0.05, bz + 0.95), P(xWall + inDir * 0.42, 1.45, bz + 0.95), 0.08, 0.08), 0x5c422c);
    b.prop('iron', stoneBox(0.32, 0.24, 0.44, P(xWall + inDir * 0.43, 1.42, bz + 0.95), { bevel: 0.03 }), 0x35312c);
  }
}

/**
 * Zone C Hero Forgeheart Gateway at `farZ`:
 * Unified full-width coursed ashlar facade wall split cleanly around the
 * pointed Forgeheart portal, battered bastion pylons, radial double-order
 * voussoir arch, extruded Dwarf-chevron crest, riveted gates, and balanced light.
 */
export function buildHeroGateway(b, farZ, height) {
  const archSpanX = 5.4;
  const wingPts = [[-3.7, 0], [3.7, 0], [2.4, 9.2], [-3.7, 9.2]];

  // Unified full-width coursed ashlar end-wall (`x = -15.1 .. +15.1`) seamlessly tying hall side walls into the portal.
  coursedMasonryWall(b, P(-15.1, 0, farZ - 0.5), P(15.1, 0, farZ - 0.5), height + 2.2, 1.75, {
    courseHeight: WALL_COURSE_HEIGHT,
    openings: [{ s: 15.1, sill: 0, width: 9.5, height: 12.3, profile: 'pointed', dressed: true }],
    baseTint: 0xdedbd6,
    trimTint: 0xece9e3,
  });

  for (const sign of [-1, 1]) {
    const px = sign * 6.5;
    b.prop('carved', stoneBlock(3.6, 1.25, 3.1, P(px, 0, farZ - 0.5), { bevel: 0.1, batter: 0.14, irregular: 0.05 }));
    b.prop('masonry', stoneBlock(3.1, 8.8, 2.6, P(px, 1.25, farZ - 0.5), { bevel: 0.08, irregular: 0.05 }), 0xdad7d1);
    b.prop('carved', stoneBlock(3.35, 3.2, 2.8, P(px, 10.05, farZ - 0.5), { bevel: 0.09, batter: 0.08, irregular: 0.05 }));
    b.prop('carved', stoneBlock(3.6, 0.85, 3.0, P(px, 13.25, farZ - 0.5), { bevel: 0.08, batter: -0.06, irregular: 0.05 }));

    // Sculpted battered bastion buttress wings stepping cleanly out from the coursed wing wall + upper cornice spandrel.
    b.prop('carved', extrudedProfile(
      wingPts.map(([u, v]) => [sign * u, v]),
      2.15,
      { bevel: 0.08, at: P(sign * 11.4, 0, farZ - 0.25) },
    ), 0xdad7d1);
    b.prop('masonry', stoneBlock(5.4, 3.6, 1.8, P(sign * 12.6, 9.2, farZ - 0.3), { bevel: 0.06, irregular: 0.04 }), 0xdedbd6);

    // Guardian shoulder obelisk beacon crowning the inner wing bastion at y = 7.4.
    b.prop('carved', stoneBlock(1.4, 3.0, 1.4, P(sign * 9.2, 7.4, farZ + 0.18), { bevel: 0.07, batter: 0.24, irregular: 0.04 }));
    b.prop('bronze', stoneBox(1.1, 0.16, 1.1, P(sign * 9.2, 10.45, farZ + 0.18), { bevel: 0.025 }), 0xd8b478);
    b.prop('iron', rod(P(sign * 9.2, 10.55, farZ + 0.18), P(sign * 9.2, 10.95, farZ + 0.18), 0.36, 0.5, 8), 0x2c2824);
    b.prop('glow', rod(P(sign * 9.2, 10.9, farZ + 0.18), P(sign * 9.2, 11.25, farZ + 0.18), 0.34, 0.12, 8), '#ff8c2c', 2.2);
    b.light(P(sign * 9.2, 11.4, farZ + 0.38), '#ffc682', 3.0, 17, { radius: 1.5, halo: 1.2 });

    // Inner stepped portal jambs & bronze-clamped flanking pilasters.
    b.prop('carved', stoneBlock(1.4, 8.4, 2.35, P(sign * 4.85, 0, farZ - 0.45), { bevel: 0.07, irregular: 0.05 }));
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
      tint: '#ffd098', intensity: 4.5, range: 21, size: 1.2, trimMaterial: 'carved', bronzeRim: true,
    });
  }

  // Compound double-order radial voussoir Forgeheart portal arch with proud promoted central keystone.
  emitRadialArch(b, 'carved', P(-archSpanX, 8.2, farZ - 0.35), P(archSpanX, 8.2, farZ - 0.35), 4.4, 1.55, 2.55, 15, {
    pointed: 0.24, tint: 0xe6e3de, keystoneTint: 0xf4f0ea, irregular: 0.04,
  });
  emitRadialArch(b, 'masonry', P(-4.8, 7.8, farZ + 0.15), P(4.8, 7.8, farZ + 0.15), 3.9, 0.85, 1.2, 15, {
    pointed: 0.24, tint: 0xdad7d1, keystoneTint: 0xece9e3, irregular: 0.04,
  });

  // Crowned Dwarf-Chevron Pediment Architrave + high-relief 3D Forgeheart Anvil Crest seated cleanly above keystone extrados.
  b.prop('masonry', stoneBox(11.6, 1.45, 1.8, P(0, 13.5, farZ - 0.45), { bevel: 0.08, irregular: 0.05 }), 0xbec1c7);
  b.prop('carved', chevronHood(12.8, 2.0, 0.7, 2.4, P(0, 13.85, farZ - 0.2)), 0x9aa0aa);
  b.prop('bronze', stoneBox(9.2, 0.32, 0.35, P(0, 13.9, farZ + 0.72), { bevel: 0.025 }), 0xcba66d);
  forgeAnvilCrest(b, P(0, 12.95, farZ + 0.68), 1.4, 0);

  // Hanging forged gatehouse censer lantern centered in upper portal throat.
  b.prop('iron', rod(P(0, 11.7, farZ - 1.1), P(0, 9.6, farZ - 1.1), 0.04, 0.04, 6), 0x2a2521);
  b.prop('iron', rod(P(0, 9.2, farZ - 1.1), P(0, 9.65, farZ - 1.1), 0.55, 0.35, 8), 0x2c2824);
  b.prop('bronze', rod(P(0, 9.3, farZ - 1.1), P(0, 9.48, farZ - 1.1), 0.58, 0.58, 8), 0xd8b478);
  b.prop('glow', rod(P(0, 9.1, farZ - 1.1), P(0, 9.32, farZ - 1.1), 0.36, 0.16, 8), '#ff9c34', 2.2);
  b.light(P(0, 9.0, farZ - 1.1), '#ffc884', 3.6, 17, { radius: 1.5, halo: 1.2 });

  // Stepped bronze-trimmed threshold sill across the portal floor (flush/walkable).
  b.prop('carved', stoneBox(10.6, 0.05, 2.4, P(0, 0.015, farZ + 0.6), { bevel: 0.02, irregular: 0.03 }));
  b.prop('bronze', stoneBox(8.8, 0.06, 0.26, P(0, 0.018, farZ + 1.65), { bevel: 0.015, irregular: 0.02 }), 0xd8b478);

  // Hero warm forge radiance from beyond the opening + restrained facade modeling fill preserving ashlar texture contrast.
  b.light(P(0, 4.8, farZ - 3.6), '#ff9f46', 12.2, 34, { radius: 3.0, halo: 1.8 });
  b.light(P(0, 10.8, farZ + 3.6), '#f0cfa4', 2.1, 24, { flat: true });
  b.light(P(0, 5.2, farZ + 7.2), '#b8b6c2', 1.4, 22, { flat: true });
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
