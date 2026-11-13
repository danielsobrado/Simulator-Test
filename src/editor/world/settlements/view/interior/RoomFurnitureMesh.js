/**
 * Draws the pieces of a room plan (RoomPlan) with an InteriorBuilder.
 *
 * Wood, stone and plaster are tints over the town's own surface sets; cloth,
 * iron and wares are plain colour. Flames and embers go to the `glow` material,
 * which is drawn at its own brightness whatever the room's light.
 */

const OAK = [0.56, 0.38, 0.24];
const DARK_OAK = [0.36, 0.23, 0.14];
const HEARTH_STONE = [0.38, 0.36, 0.33];
const SOOT = [0.12, 0.11, 0.1];
const IRON = [0.1, 0.1, 0.11];
const LINEN = [0.62, 0.58, 0.5];
const FUR = [0.42, 0.33, 0.24];
const TALLOW = [0.85, 0.8, 0.62];
/** No brighter than white: a flame keeps its colour rather than burning out. */
const FLAME = [1.0, 0.4, 0.07];
const FLAME_HEART = [1.15, 0.72, 0.22];
const EMBER = [0.8, 0.2, 0.04];
const BONE = [0.66, 0.6, 0.48];
const BANNERS = [[0.5, 0.09, 0.07], [0.1, 0.17, 0.4], [0.12, 0.3, 0.14]];
const TRIM = [0.72, 0.58, 0.22];
const WARES = [[0.5, 0.32, 0.16], [0.56, 0.5, 0.36], [0.3, 0.36, 0.22], [0.45, 0.2, 0.14], [0.2, 0.24, 0.34]];

const shade = (color, factor) => color.map((channel) => channel * factor);

function legs(b, x, z, width, depth, floor, height, thickness = 0.09) {
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const lx = x + sx * (width / 2 - thickness);
    const lz = z + sz * (depth / 2 - thickness);
    b.box(lx - thickness / 2, lx + thickness / 2, lz - thickness / 2, lz + thickness / 2, floor, floor + height, DARK_OAK);
  }
}

const DRAW = {
  hearth(b, p, floor, ceiling) {
    const { x, z } = p;
    b.use('stone');
    // Multi-course irregular stone jambs, arched/stepped lintel, and coursed chimney breast up to the ceiling.
    const jambCourses = [
      [0.0, 0.34, 0.42, 0.64, 0.94],
      [0.34, 0.66, 0.36, 0.58, 1.04],
      [0.66, 0.96, 0.40, 0.62, 0.96],
      [0.96, 1.25, 0.37, 0.60, 1.02],
    ];
    for (const [y0, y1, w, d, tint] of jambCourses) {
      b.box(x - 0.48 - w, x - 0.48, z, z + d, floor + y0, floor + y1 - 0.015, shade(HEARTH_STONE, tint));
      b.box(x + 0.48, x + 0.48 + w, z, z + d - 0.02, floor + y0, floor + y1 - 0.015, shade(HEARTH_STONE, 2 - tint));
    }
    // Heavy multi-block stone mantel/lintel course.
    b.box(x - 0.96, x - 0.28, z, z + 0.68, floor + 1.25, floor + 1.58, shade(HEARTH_STONE, 1.08), { underside: true });
    b.box(x - 0.26, x + 0.26, z, z + 0.72, floor + 1.23, floor + 1.62, shade(HEARTH_STONE, 1.14), { underside: true });
    b.box(x + 0.28, x + 0.96, z, z + 0.67, floor + 1.25, floor + 1.58, shade(HEARTH_STONE, 1.04), { underside: true });
    // Stepped irregular stone courses up the chimney breast to the ceiling.
    let breastY = 1.6;
    let row = 0;
    while (breastY < ceiling - 0.05) {
      const courseH = Math.min(ceiling - breastY, 0.32 + (row % 3) * 0.06);
      const halfW = Math.max(0.54, 0.76 - row * 0.035);
      const depth = Math.max(0.38, 0.52 - row * 0.02);
      const splitX = x + ((row % 2 === 0 ? -1 : 1) * 0.14);
      b.box(x - halfW, splitX - 0.012, z, z + depth, floor + breastY, floor + breastY + courseH - 0.015, shade(HEARTH_STONE, 0.92 + (row % 2) * 0.08));
      b.box(splitX + 0.012, x + halfW, z, z + depth - 0.02, floor + breastY, floor + breastY + courseH - 0.015, shade(HEARTH_STONE, 1.0 - (row % 2) * 0.07));
      breastY += courseH;
      row += 1;
    }
    b.box(x - 0.95, x + 0.95, z + 0.6, z + 0.95, floor, floor + 0.08, shade(HEARTH_STONE, 0.8));
    b.wall(x - 0.5, z + 0.03, x + 0.5, z + 0.03, floor, floor + 1.25, [0, 1], SOOT);
    b.use('wood');
    for (const [dx, turn] of [[-0.2, 0.25], [0.12, -0.3], [0, 0.05]]) {
      b.box(x + dx - 0.3, x + dx + 0.3, z + 0.2 + turn * 0.3, z + 0.32 + turn * 0.3, floor + 0.08, floor + 0.2, shade(DARK_OAK, 0.5));
    }
    b.use('glow');
    b.box(x - 0.32, x + 0.32, z + 0.14, z + 0.42, floor + 0.16, floor + 0.24, EMBER);
    for (const [dx, height] of [[-0.16, 0.34], [0.03, 0.52], [0.2, 0.28], [-0.05, 0.22]]) {
      b.prism(x + dx, z + 0.28, 0.1, floor + 0.22, floor + 0.22 + height, FLAME, { sides: 5, taper: 0.92, cap: false });
      b.prism(x + dx, z + 0.3, 0.05, floor + 0.22, floor + 0.22 + height * 0.55, FLAME_HEART, { sides: 4, taper: 0.9, cap: false });
    }
  },
  pot(b, p, floor) {
    b.use('plain');
    b.prism(p.x, p.z, 0.2, floor + 0.62, floor + 0.92, IRON, { sides: 10, belly: 0.25 });
    // Hung from a chain over the fire.
    b.box(p.x - 0.012, p.x + 0.012, p.z - 0.012, p.z + 0.012, floor + 0.92, floor + 1.25, IRON);
  },
  firewood(b, p, floor) {
    b.use('wood');
    for (let row = 0; row < 3; row += 1) {
      for (let log = 0; log < 3 - row; log += 1) {
        const x = p.x - 0.2 + log * 0.2 + row * 0.1;
        b.box(x - 0.09, x + 0.09, p.z - 0.25, p.z + 0.2, floor + row * 0.16, floor + row * 0.16 + 0.16, shade(OAK, 0.8 + ((row + log) % 2) * 0.2));
      }
    }
  },
  shield(b, p, floor) {
    b.use('wood').disc(p.x, floor + p.y, p.z, 0.36, p.facing, shade(OAK, 0.9));
    b.use('plain').disc(p.x, floor + p.y, p.z + p.facing[1] * 0.02 + p.facing[0] * 0.02, 0.1, p.facing, IRON, 8);
    // Crossed over it, two hafts.
    for (const lean of [-1, 1]) {
      b.use('wood').quad([p.x - 0.5 * lean, floor + p.y - 0.42, p.z + 0.015], [p.x - 0.44 * lean, floor + p.y - 0.46, p.z + 0.015],
        [p.x + 0.5 * lean, floor + p.y + 0.42, p.z + 0.015], [p.x + 0.44 * lean, floor + p.y + 0.46, p.z + 0.015], [p.facing[0], 0, p.facing[1]], DARK_OAK);
    }
  },
  table(b, p, floor) {
    b.use('wood');
    b.box(p.x - p.width / 2, p.x + p.width / 2, p.z - p.depth / 2, p.z + p.depth / 2, floor + 0.7, floor + 0.78, OAK, { underside: true });
    legs(b, p.x, p.z, p.width, p.depth, floor, 0.7);
    b.box(p.x - p.width / 2 + 0.12, p.x + p.width / 2 - 0.12, p.z - 0.03, p.z + 0.03, floor + 0.22, floor + 0.3, DARK_OAK);
  },
  stool(b, p, floor) {
    b.use('wood');
    b.prism(p.x, p.z, 0.19, floor + 0.4, floor + 0.46, OAK, { sides: 8 });
    legs(b, p.x, p.z, 0.3, 0.3, floor, 0.4, 0.05);
  },
  bench(b, p, floor) {
    const half = p.length / 2;
    b.use('wood');
    b.box(p.x - half, p.x + half, p.z - 0.16, p.z + 0.16, floor + 0.4, floor + 0.46, OAK, { underside: true });
    for (const end of [-1, 1]) b.box(p.x + end * (half - 0.14) - 0.04, p.x + end * (half - 0.14) + 0.04, p.z - 0.14, p.z + 0.14, floor, floor + 0.4, DARK_OAK);
    if (p.back) b.box(p.x - half, p.x + half, p.z + 0.13, p.z + 0.17, floor + 0.46, floor + 0.9, DARK_OAK);
  },
  bed(b, p, floor) {
    const { x, z } = p;
    b.use('wood');
    b.box(x, x + 1, z, z + 2, floor + 0.18, floor + 0.36, DARK_OAK);
    b.box(x, x + 1, z - 0.07, z + 0.02, floor, floor + 0.95, DARK_OAK);
    b.box(x, x + 1, z + 1.98, z + 2.06, floor, floor + 0.55, DARK_OAK);
    b.use('plain');
    b.box(x + 0.05, x + 0.95, z + 0.04, z + 1.96, floor + 0.36, floor + 0.5, LINEN);
    b.box(x + 0.14, x + 0.86, z + 0.1, z + 0.44, floor + 0.5, floor + 0.6, shade(LINEN, 1.08));
    // A fur thrown over the foot of it.
    b.box(x + 0.02, x + 0.98, z + 0.62, z + 1.97, floor + 0.5, floor + 0.56, FUR);
    b.box(x - 0.03, x + 1.03, z + 1.15, z + 1.9, floor + 0.3, floor + 0.57, shade(FUR, 0.85));
  },
  chest(b, p, floor) {
    b.use('wood');
    b.box(p.x - 0.42, p.x + 0.42, p.z - 0.26, p.z + 0.26, floor, floor + 0.4, OAK);
    b.box(p.x - 0.44, p.x + 0.44, p.z - 0.28, p.z + 0.28, floor + 0.4, floor + 0.5, DARK_OAK);
    b.use('plain');
    for (const dx of [-0.28, 0.28]) b.box(p.x + dx - 0.03, p.x + dx + 0.03, p.z - 0.285, p.z + 0.285, floor, floor + 0.51, IRON);
    b.box(p.x - 0.05, p.x + 0.05, p.z + 0.28, p.z + 0.31, floor + 0.28, floor + 0.42, TRIM);
  },
  rug(b, p, floor) {
    const [w, d] = [p.width / 2, p.depth / 2];
    const y = floor + 0.012;
    b.use('plain');
    if (p.fur) {
      // A pelt: a broad body and the paler belly-fur at its edges.
      b.slab(p.x - w, p.x + w, p.z - d, p.z + d, y, true, shade(FUR, 0.8));
      b.slab(p.x - w * 0.82, p.x + w * 0.82, p.z - d * 0.78, p.z + d * 0.78, y + 0.004, true, FUR);
      return;
    }
    b.slab(p.x - w, p.x + w, p.z - d, p.z + d, y, true, TRIM);
    b.slab(p.x - w + 0.1, p.x + w - 0.1, p.z - d + 0.1, p.z + d - 0.1, y + 0.003, true, BANNERS[0]);
    b.slab(p.x - w * 0.5, p.x + w * 0.5, p.z - d * 0.45, p.z + d * 0.45, y + 0.006, true, shade(BANNERS[1], 0.9));
  },
  banner(b, p, floor) {
    const across = [p.facing[1], -p.facing[0]];
    const colour = BANNERS[p.hue % BANNERS.length];
    const at = (side, y, out = 0) => [p.x + across[0] * side + p.facing[0] * out, floor + y, p.z + across[1] * side + p.facing[1] * out];
    const n = [p.facing[0], 0, p.facing[1]];
    b.use('wood').quad(at(-0.42, p.y + 1.02, 0.02), at(0.42, p.y + 1.02, 0.02), at(0.42, p.y + 1.08, 0.02), at(-0.42, p.y + 1.08, 0.02), n, DARK_OAK);
    b.use('plain');
    b.quad(at(-0.36, p.y, 0.012), at(0.36, p.y, 0.012), at(0.36, p.y + 1.02, 0.012), at(-0.36, p.y + 1.02, 0.012), n, colour);
    b.quad(at(-0.36, p.y, 0.016), at(0.36, p.y, 0.016), at(0.36, p.y + 0.07, 0.016), at(-0.36, p.y + 0.07, 0.016), n, TRIM);
    // The device: a pale lozenge.
    b.quad(at(0, p.y + 0.32, 0.018), at(0.17, p.y + 0.55, 0.018), at(0, p.y + 0.78, 0.018), at(-0.17, p.y + 0.55, 0.018), n, shade(TRIM, 1.15));
    b.tri(at(-0.36, p.y, 0.012), at(0.36, p.y, 0.012), at(0, p.y - 0.2, 0.012), n, colour);
  },
  shelves(b, p, floor) {
    const depth = 0.34;
    const x0 = p.facing > 0 ? p.x : p.x - depth;
    b.use('wood');
    for (const z of [p.z0, p.z1 - 0.06]) b.box(x0, x0 + depth, z, z + 0.06, floor, floor + 1.7, DARK_OAK);
    for (const level of [0.12, 0.62, 1.12, 1.62]) b.box(x0, x0 + depth, p.z0, p.z1, floor + level - 0.04, floor + level, OAK, { underside: true });
    b.use('plain');
    let index = Math.abs(Math.round(p.z0 * 10));
    for (const level of [0.12, 0.62, 1.12]) {
      for (let z = p.z0 + 0.22; z < p.z1 - 0.2; z += 0.34, index += 1) {
        const pick = (index * 7 + 3) % 11;
        if (pick === 0) continue;
        const colour = WARES[pick % WARES.length];
        const x = x0 + depth / 2;
        if (pick % 3 === 0) b.prism(x, z, 0.09, floor + level, floor + level + 0.2 + (pick % 4) * 0.04, colour, { sides: 8, belly: 0.3 });
        else b.box(x - 0.1, x + 0.1, z - 0.11, z + 0.11, floor + level, floor + level + 0.14 + (pick % 5) * 0.04, colour);
      }
    }
  },
  counter(b, p, floor) {
    const [x0, x1, z0, z1] = p.crosswise ? [p.x0, p.x1, p.z - 0.25, p.z + 0.25] : [p.x - 0.25, p.x + 0.25, p.z0, p.z1];
    b.use('wood');
    b.box(x0 + 0.04, x1 - 0.04, z0 + 0.04, z1 - 0.04, floor, floor + 0.98, shade(OAK, 0.8));
    b.box(x0, x1, z0, z1, floor + 0.98, floor + 1.05, OAK, { underside: true });
  },
  cask(b, p, floor) {
    b.use('wood').prism(p.x, p.z, 0.27, floor, floor + 0.78, OAK, { sides: 12, belly: 0.16 });
    b.use('plain');
    for (const y of [0.1, 0.62]) b.prism(p.x, p.z, 0.3, floor + y, floor + y + 0.05, IRON, { sides: 12, cap: false });
  },
  sack(b, p, floor) {
    b.use('plain');
    b.prism(p.x, p.z, 0.22, floor, floor + 0.5, LINEN, { sides: 8, belly: 0.35, cap: false });
    b.prism(p.x, p.z, 0.08, floor + 0.5, floor + 0.62, shade(LINEN, 0.85), { sides: 6 });
  },
  crate(b, p, floor) {
    b.use('wood');
    b.box(p.x - 0.3, p.x + 0.3, p.z - 0.3, p.z + 0.3, floor, floor + 0.55, shade(OAK, 0.85));
    for (const dz of [-0.305, 0.305]) b.box(p.x - 0.31, p.x + 0.31, p.z + dz - 0.01, p.z + dz + 0.01, floor + 0.22, floor + 0.32, DARK_OAK);
  },
  candle(b, p, floor) {
    const y = floor + p.y;
    b.use('plain');
    b.prism(p.x, p.z, 0.06, y, y + 0.02, IRON, { sides: 8 });
    b.prism(p.x, p.z, 0.022, y + 0.02, y + 0.2, TALLOW, { sides: 6 });
    b.use('glow').prism(p.x, p.z, 0.018, y + 0.2, y + 0.28, FLAME_HEART, { sides: 4, taper: 0.9, cap: false });
  },
  /** An iron bracket on a wall and the candle it carries. */
  sconce(b, p, floor) {
    const y = floor + p.y;
    const [fx, fz] = p.facing;
    const [cx, cz] = [p.x + fx * 0.16, p.z + fz * 0.16];
    b.use('plain');
    b.box(Math.min(p.x, cx) - 0.015, Math.max(p.x, cx) + 0.015, Math.min(p.z, cz) - 0.015, Math.max(p.z, cz) + 0.015, y - 0.03, y, IRON, { underside: true });
    b.prism(cx, cz, 0.05, y, y + 0.015, IRON, { sides: 6 });
    b.prism(cx, cz, 0.022, y + 0.015, y + 0.17, TALLOW, { sides: 6 });
    b.use('glow').prism(cx, cz, 0.018, y + 0.17, y + 0.25, FLAME_HEART, { sides: 4, taper: 0.9, cap: false });
  },
  /** Antlers on a plaque, hung on the back wall. */
  trophy(b, p, floor) {
    const y = floor + p.y;
    const z = p.z + 0.02;
    b.use('wood').disc(p.x, y, p.z, 0.2, [0, 1], DARK_OAK, 8);
    b.use('plain').box(p.x - 0.07, p.x + 0.07, p.z, p.z + 0.1, y - 0.06, y + 0.1, BONE, { underside: true });
    // Each antler a beam sweeping out and up, and the tines standing off it.
    const limb = (ax, ay, bx, by, width) => b.quad([ax, ay, z], [ax + width, ay - width * 0.4, z], [bx + width * 0.4, by, z], [bx, by, z], [0, 0, 1], BONE);
    for (const side of [-1, 1]) {
      limb(p.x + side * 0.05, y + 0.1, p.x + side * 0.5, y + 0.38, side * 0.05);
      limb(p.x + side * 0.2, y + 0.19, p.x + side * 0.16, y + 0.5, side * 0.035);
      limb(p.x + side * 0.34, y + 0.28, p.x + side * 0.36, y + 0.62, side * 0.035);
      limb(p.x + side * 0.5, y + 0.38, p.x + side * 0.6, y + 0.66, side * 0.03);
    }
  },
  tableware(b, p, floor) {
    const y = floor + p.y;
    b.use('wood').prism(p.x, p.z, 0.13, y, y + 0.02, shade(OAK, 1.1), { sides: 10 });
    b.use('plain');
    b.prism(p.x + 0.24, p.z + 0.08, 0.045, y, y + 0.13, [0.3, 0.3, 0.32], { sides: 8 });
    b.box(p.x - 0.06, p.x + 0.06, p.z - 0.04, p.z + 0.04, y + 0.02, y + 0.07, [0.62, 0.48, 0.26]);
  },
  chandelier(b, p, floor, ceiling) {
    const y = floor + ceiling - 0.95;
    b.use('plain').box(p.x - 0.012, p.x + 0.012, p.z - 0.012, p.z + 0.012, y + 0.08, floor + ceiling, IRON);
    b.use('wood');
    // A wheel of timber on its chain, a candle at each spoke.
    for (const [dx, dz] of [[0.5, 0.04], [0.04, 0.5]]) b.box(p.x - dx, p.x + dx, p.z - dz, p.z + dz, y, y + 0.07, DARK_OAK, { underside: true });
    for (let side = 0; side < 8; side += 1) {
      const [a0, a1] = [Math.PI * 2 * side / 8, Math.PI * 2 * (side + 1) / 8];
      const rim = (angle, radius, height) => [p.x + Math.cos(angle) * radius, y + height, p.z + Math.sin(angle) * radius];
      b.quad(rim(a0, 0.5, 0), rim(a1, 0.5, 0), rim(a1, 0.5, 0.07), rim(a0, 0.5, 0.07), [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)], DARK_OAK);
      b.quad(rim(a0, 0.5, 0.07), rim(a1, 0.5, 0.07), rim(a1, 0.42, 0.07), rim(a0, 0.42, 0.07), [0, 1, 0], DARK_OAK);
      b.quad(rim(a0, 0.5, 0), rim(a1, 0.5, 0), rim(a1, 0.42, 0), rim(a0, 0.42, 0), [0, -1, 0], DARK_OAK);
    }
    for (let candle = 0; candle < 4; candle += 1) {
      const angle = Math.PI / 4 + Math.PI / 2 * candle;
      const [cx, cz] = [p.x + Math.cos(angle) * 0.46, p.z + Math.sin(angle) * 0.46];
      b.use('plain').prism(cx, cz, 0.02, y + 0.07, y + 0.2, TALLOW, { sides: 6 });
      b.use('glow').prism(cx, cz, 0.018, y + 0.2, y + 0.28, FLAME_HEART, { sides: 4, taper: 0.9, cap: false });
    }
  },
  altar(b, p, floor) {
    b.use('stone');
    b.box(p.x - 0.6, p.x + 0.6, p.z - 0.25, p.z + 0.25, floor, floor + 0.92, HEARTH_STONE);
    b.box(p.x - 0.72, p.x + 0.72, p.z - 0.32, p.z + 0.32, floor + 0.92, floor + 1.05, shade(HEARTH_STONE, 1.1), { underside: true });
    b.use('plain').box(p.x - 0.5, p.x + 0.5, p.z - 0.33, p.z + 0.33, floor + 1.05, floor + 1.06, BANNERS[1]);
  },
  anvil(b, p, floor) {
    b.use('wood').prism(p.x, p.z, 0.22, floor, floor + 0.45, DARK_OAK, { sides: 10 });
    b.use('plain');
    b.box(p.x - 0.1, p.x + 0.1, p.z - 0.09, p.z + 0.09, floor + 0.45, floor + 0.6, IRON);
    b.box(p.x - 0.28, p.x + 0.22, p.z - 0.1, p.z + 0.1, floor + 0.6, floor + 0.7, shade(IRON, 1.6), { underside: true });
  },
};

/** Draw one piece of a room plan. `floor` is the room's floor height; `ceiling` its height above that. */
export function drawPiece(builder, piece, floor, ceiling) {
  const draw = DRAW[piece.type];
  if (!draw) throw new Error(`Unknown room piece: ${piece.type}.`);
  draw(builder, piece, floor, ceiling);
}

export const ROOM_PIECE_TYPES = Object.freeze(Object.keys(DRAW));
