import { arch, beam, block, box, coursedWall, extrudedProfile, hewnBeam, rod, stoneBlock, stoneBox } from '../gen/propKit.js';

/**
 * Built assemblies shared by the generators. Each takes the builder first and
 * writes props, lights and walkable ground together. Material keys (`timber`,
 * `iron`, `masonry`, `glow`) are resolved by the archetype's material set.
 */

const up = (p, dy) => ({ x: p.x, y: p.y + dy, z: p.z });
const lerp = (a, c, t) => ({ x: a.x + (c.x - a.x) * t, y: a.y + (c.y - a.y) * t, z: a.z + (c.z - a.z) * t });
/** Unit vector along a→c in plan, and its left-hand normal. */
const frame = (a, c) => {
  const length = Math.hypot(c.x - a.x, c.z - a.z) || 1;
  const ux = (c.x - a.x) / length, uz = (c.z - a.z) / length;
  return { length, ux, uz, nx: -uz, nz: ux, yaw: Math.atan2(-uz, ux) };
};
const side = (p, f, offset) => ({ x: p.x + f.nx * offset, y: p.y, z: p.z + f.nz * offset });

/** A caged lamp: iron frame, glowing pane, and the light it casts. `at` is the lamp body. */
export function lantern(b, at, { tint = '#ffb061', intensity = 5, range = 13, halo = 1.5, hung = 0 } = {}) {
  b.prop('iron', stoneBox(0.28, 0.06, 0.28, up(at, 0.2), { bevel: 0.02, irregular: 0.1 }), 0x2a2623);
  b.prop('iron', stoneBox(0.26, 0.06, 0.26, up(at, -0.2), { bevel: 0.02, irregular: 0.1 }), 0x2a2623);
  for (const [dx, dz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]]) {
    b.prop('iron', rod({ x: at.x + dx, y: at.y - 0.18, z: at.z + dz }, { x: at.x + dx, y: at.y + 0.18, z: at.z + dz }, 0.014, 0.014, 4), 0x2a2623);
  }
  if (hung > 0) b.prop('iron', rod(up(at, 0.22), up(at, 0.22 + hung), 0.015, 0.015, 5), 0x2a2623);
  b.prop('glow', box(0.18, 0.34, 0.18, at), tint, 4);
  b.light(at, tint, intensity, range, { radius: 1.2, halo });
}

/**
 * A hand-hewn mine timber set across a drift: tapered chamfered posts on
 * sill foot blocks, an overhanging eared cap beam, knee braces, and lagging.
 */
export function timberSet(b, at, yaw, width, height, tint = 0x7d6044) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // `yaw` 0 spans a drift that runs along Z.
  const left = { x: at.x - c * width / 2, y: at.y, z: at.z + s * width / 2 };
  const right = { x: at.x + c * width / 2, y: at.y, z: at.z - s * width / 2 };
  const leanL = b.range(-0.07, 0.07), leanR = b.range(-0.07, 0.07);
  const leftTop = { x: left.x + c * 0.08 + leanL, y: at.y + height, z: left.z - s * 0.08 };
  const rightTop = { x: right.x - c * 0.08 + leanR, y: at.y + height, z: right.z + s * 0.08 };

  // Flared sill foot blocks under each post.
  b.prop('timber', stoneBlock(0.38, 0.14, 0.38, left, { yaw, bevel: 0.03, batter: 0.16, irregular: 0.3 }), tint);
  b.prop('timber', stoneBlock(0.38, 0.14, 0.38, right, { yaw, bevel: 0.03, batter: 0.16, irregular: 0.3 }), tint);

  // Hand-hewn chamfered posts.
  b.prop('timber', hewnBeam(left, leftTop, 0.27, 0.27, { taper: 0.08, irregular: 0.32 }), tint);
  b.prop('timber', hewnBeam(right, rightTop, 0.27, 0.27, { taper: 0.08, irregular: 0.32 }), tint);

  // Overhanging eared cap beam.
  const capLeft = { x: leftTop.x - c * 0.24, y: leftTop.y + 0.13, z: leftTop.z + s * 0.24 };
  const capRight = { x: rightTop.x + c * 0.24, y: rightTop.y + 0.13, z: rightTop.z - s * 0.24 };
  b.prop('timber', hewnBeam(capLeft, capRight, 0.31, 0.27, { irregular: 0.28 }), tint);

  // Knee braces on one or both sides, with joinery peg blocks.
  for (const [post, top, otherTop, chance] of [[left, leftTop, rightTop, 0.75], [right, rightTop, leftTop, 0.55]]) {
    if (b.random() < chance) {
      const braceBot = lerp(post, top, 0.62);
      const braceTop = lerp(top, otherTop, 0.26);
      b.prop('timber', hewnBeam(braceBot, up(braceTop, 0.08), 0.15, 0.15, { irregular: 0.22 }), tint);
    }
  }
  // Overhead lagging poles on ~50% of sets to break up the flat cap silhouette.
  if (b.random() < 0.5) {
    for (const t of [0.22, 0.5, 0.78]) {
      const p = lerp(leftTop, rightTop, t);
      b.prop('timber', hewnBeam(
        { x: p.x - s * 0.6, y: p.y + 0.28, z: p.z - c * 0.6 },
        { x: p.x + s * 0.6, y: p.y + 0.28, z: p.z + c * 0.6 },
        0.11, 0.09, { irregular: 0.35 },
      ), tint);
    }
  }
}

/** Cart rails with irregular hand-hewn sleepers from `a` to `c`. */
export function rails(b, a, c, gauge = 0.9) {
  const f = frame(a, c);
  for (const offset of [-gauge / 2, gauge / 2]) {
    b.prop('iron', hewnBeam(up(side(a, f, offset), 0.13), up(side(c, f, offset), 0.13), 0.075, 0.1, { bevel: 0.018, irregular: 0.06 }), 0x4a4038);
  }
  for (let d = 0.4; d < f.length; d += 0.85) {
    const jitterD = d + b.range(-0.07, 0.07);
    const p = lerp(a, c, Math.max(0, Math.min(1, jitterD / f.length)));
    const halfSpan = gauge * b.range(0.74, 0.88);
    const skew = b.range(-0.04, 0.04);
    b.prop('timber', hewnBeam(
      up(side(p, f, -halfSpan), 0.04),
      { x: side(p, f, halfSpan).x + f.ux * skew, y: p.y + 0.04, z: side(p, f, halfSpan).z + f.uz * skew },
      0.21, 0.095, { bevel: 0.025, irregular: 0.35 },
    ), 0x5d4733);
  }
}

export function crate(b, at, size = 0.8, yaw = 0) {
  const h = size * 0.82;
  b.prop('timber', stoneBlock(size * 0.92, h * 0.92, size * 0.92, up(at, h * 0.04), { yaw, bevel: 0.02, irregular: 0.12 }), 0x7c6040);
  // Corner framing battens and top/bottom rails.
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const half = size * 0.46;
  for (const [lx, lz] of [[-half, -half], [half, -half], [-half, half], [half, half]]) {
    const px = at.x + c * lx + s * lz, pz = at.z - s * lx + c * lz;
    b.prop('timber', stoneBlock(0.11, h, 0.11, { x: px, y: at.y, z: pz }, { yaw, bevel: 0.02, irregular: 0.15 }), 0x947551);
  }
  b.prop('iron', stoneBlock(size + 0.03, 0.06, size + 0.03, up(at, h * 0.44), { yaw, bevel: 0.015, irregular: 0.05 }), 0x3a332e);
  b.prop('iron', stoneBlock(size + 0.03, 0.06, size + 0.03, up(at, h * 0.82), { yaw, bevel: 0.015, irregular: 0.05 }), 0x3a332e);
}

export function barrel(b, at, radius = 0.36, height = 0.95) {
  const mid = up(at, height / 2);
  b.prop('timber', rod(at, mid, radius * 0.84, radius, 12), 0x86633f);
  b.prop('timber', rod(mid, up(at, height), radius, radius * 0.84, 12), 0x86633f);
  for (const frac of [0.16, 0.34, 0.66, 0.84]) {
    const r = radius * (frac < 0.25 || frac > 0.75 ? 0.93 : 1.0);
    b.prop('iron', rod(up(at, height * frac), up(at, height * (frac + 0.055)), r, r, 12), 0x35302b);
  }
}

/** A flight of individual beveled stone steps from floor point `a` up or down to `c`, walkable. */
export function stairs(b, a, c, width, material = 'masonry', tint = 0xffffff) {
  const f = frame(a, c);
  const count = Math.max(2, Math.round(Math.abs(c.y - a.y) / 0.24));
  const run = f.length / count;
  const blocksPerStep = Math.max(2, Math.round(width / 0.85));
  const blockW = width / blocksPerStep;
  for (let index = 0; index < count; index += 1) {
    const p = lerp(a, c, (index + 0.5) / count);
    const top = a.y + (c.y - a.y) * ((index + (c.y > a.y ? 1 : 0)) / count);
    for (let seg = 0; seg < blocksPerStep; seg += 1) {
      const offset = (seg + 0.5) * blockW - width / 2;
      const sp = side(p, f, offset);
      b.prop(material, stoneBox(run + 0.06, 0.52, blockW * 0.96, { x: sp.x, y: top - 0.26, z: sp.z }, {
        yaw: f.yaw, bevel: 0.035, irregular: 0.28, seed: 700 + index * 31 + seg * 13,
      }), tint);
    }
  }
  b.nav.addSegment(a, c, width - 0.5);
}

/**
 * A masonry bridge from `a` to `c`: coursed stone deck slabs, pilastered
 * parapets with capstones, and voussoir arches springing from stepped piers.
 * Walkable along its deck.
 */
export function bridge(b, a, c, width, { footY, material = 'masonry', tint = 0xffffff, spans = 3, parapet = 1 } = {}) {
  const f = frame(a, c);
  const slices = Math.max(2, Math.round(f.length / 2.1));
  for (let index = 0; index < slices; index += 1) {
    const p0 = lerp(a, c, index / slices), p1 = lerp(a, c, (index + 1) / slices);
    b.prop(material, hewnBeam(up(p0, -0.35), up(p1, -0.35), width, 0.72, { bevel: 0.045, irregular: 0.14 }), tint);
    if (parapet > 0) {
      for (const offset of [-width / 2 + 0.2, width / 2 - 0.2]) {
        const s0 = side(p0, f, offset), s1 = side(p1, f, offset);
        b.prop(material, coursedWall(s0, s1, parapet * 0.86, 0.38, {
          courseHeight: 0.34, stoneWidth: 0.68, irregular: 0.35, bevel: 0.035,
        }), tint);
        // Beveled coping capstones along the parapet top.
        b.prop(material, hewnBeam(up(s0, parapet * 0.93), up(s1, parapet * 0.93), 0.48, 0.16, { bevel: 0.035, irregular: 0.18 }), tint);
        // Pilaster buttress post at slice joints.
        b.prop(material, stoneBlock(0.56, parapet + 0.14, 0.56, s0, { yaw: f.yaw, bevel: 0.045, batter: 0.08, irregular: 0.22 }), tint);
      }
    }
  }
  if (footY === undefined) { b.nav.addSegment(a, c, width - 1.1); return; }
  for (let span = 0; span < spans; span += 1) {
    const s0 = up(lerp(a, c, span / spans), -0.7), s1 = up(lerp(a, c, (span + 1) / spans), -0.7);
    const rise = Math.min(f.length / spans * 0.42, 6);
    const spring0 = up(s0, -rise), spring1 = up(s1, -rise);
    for (const offset of [-width / 2 + 0.35, width / 2 - 0.35]) {
      b.prop(material, arch(side(spring0, f, offset), side(spring1, f, offset), rise, 0.85, 0.75, 11), tint);
    }
    if (span > 0) {
      const top = spring0.y + rise * 0.4;
      b.prop(material, stoneBlock(1.75, top - footY, width - 0.1, { x: s0.x, y: footY, z: s0.z }, {
        yaw: f.yaw, bevel: 0.08, batter: 0.14, irregular: 0.25,
      }), tint);
    }
  }
  b.nav.addSegment(a, c, width - 1.1);
}

/**
 * A monumental Dwarven column in three intentional variants (`structural`,
 * `ceremonial`, `reinforced`): broad layered plinth and octagonal base,
 * continuous octagonal shaft with slim flush pilasters, geometric collar bands,
 * bronze necking trim, and a load-bearing stepped capital. Blocks the walker.
 */
export function pillar(b, at, height, radius, {
  material = 'masonry',
  trimMaterial = material,
  tint = 0xffffff,
  sides = 8,
  variant = 'structural',
} = {}) {
  const reinforced = variant === 'reinforced';
  const ceremonial = variant === 'ceremonial';
  const plinthScale = reinforced ? 3.05 : 2.85;

  // 1. Layered foundation base.
  b.prop(trimMaterial, stoneBlock(radius * plinthScale, 0.68, radius * plinthScale, at, { bevel: 0.08, batter: 0.14, irregular: 0.05 }), 0xf4f2ef);
  b.prop(trimMaterial, rod(up(at, 0.68), up(at, 1.24), radius * (reinforced ? 1.38 : 1.3), radius * 1.14, sides), 0xeae8e4);
  if (ceremonial || reinforced) {
    b.prop('bronze', rod(up(at, 1.24), up(at, 1.36), radius * 1.15, radius * 1.15, sides), 0xdcb97f);
    b.prop(material, rod(up(at, 1.36), up(at, 1.68), radius * 1.04, radius * 0.96, sides), 0xdedcdd);
  } else {
    b.prop(material, rod(up(at, 1.24), up(at, 1.64), radius * 1.06, radius * 0.96, sides), 0xdedcdd);
  }

  // 2. Coherent continuous octagonal shaft with deeply seated cardinal pilasters rooted into the base collar.
  const shaftStart = ceremonial || reinforced ? 1.68 : 1.64;
  const shaftEnd = height - 1.95;
  const shaftH = Math.max(0.8, shaftEnd - shaftStart);
  b.prop(material, rod(up(at, shaftStart), up(at, shaftEnd), radius * 0.96, radius * 0.9, sides), tint);
  const ribW = radius * (ceremonial ? 0.38 : 0.34);
  const ribDepth = radius * 0.14;
  const ribOverlap = 0.28;
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    b.prop(material, stoneBlock(
      dx !== 0 ? ribDepth : ribW,
      shaftH + ribOverlap,
      dz !== 0 ? ribDepth : ribW,
      { x: at.x + dx * radius * 0.84, y: at.y + shaftStart - ribOverlap * 0.72, z: at.z + dz * radius * 0.84 },
      { bevel: 0.035, batter: 0.04, irregular: 0.03 },
    ), 0xf0eeeb);
  }
  if (reinforced) {
    // Grounded corner haunch buttresses seated completely inside the bronze collar ledge (y = 1.36).
    const spurH = Math.min(1.9, shaftH * 0.34);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.prop(trimMaterial, stoneBlock(radius * 0.38, spurH, radius * 0.38, {
        x: at.x + sx * radius * 0.6, y: at.y + 1.36, z: at.z + sz * radius * 0.6,
      }, { yaw: Math.PI / 4, bevel: 0.045, batter: 0.24, irregular: 0.04 }), 0xe8e5e0);
    }
  }
  const bandFrac = ceremonial ? 0.52 : 0.5;
  const bandY = shaftStart + shaftH * bandFrac;
  b.prop(trimMaterial, rod(up(at, bandY - 0.14), up(at, bandY + 0.14), radius * 1.0, radius * 1.0, sides), 0xe6e4e0);
  if (ceremonial) {
    b.prop('bronze', rod(up(at, bandY - 0.04), up(at, bandY + 0.04), radius * 1.02, radius * 1.02, sides), 0xd8b478);
  }

  // 3. Sculpted load-bearing Dwarven capital: astragal, dentil collar lugs, flared bell, flying knee corbels, bronze-bound impost.
  b.prop(trimMaterial, rod(up(at, shaftEnd), up(at, shaftEnd + 0.24), radius * 0.94, radius * 1.1, sides), 0xe4e2de);
  b.prop('bronze', rod(up(at, shaftEnd + 0.05), up(at, shaftEnd + 0.17), radius * 1.04, radius * 1.04, sides), 0xc29858);
  // Radial dentil lugs around the necking astragal catching firelight.
  for (let i = 0; i < sides; i += 1) {
    const a = (i / sides) * Math.PI * 2 + Math.PI / sides;
    const lugR = radius * 1.07;
    b.prop(trimMaterial, stoneBox(radius * 0.24, 0.2, radius * 0.24, {
      x: at.x + Math.cos(a) * lugR, y: at.y + shaftEnd + 0.34, z: at.z + Math.sin(a) * lugR,
    }, { yaw: -a, bevel: 0.03, irregular: 0.03 }), 0xedeae6);
  }
  b.prop(trimMaterial, rod(up(at, shaftEnd + 0.24), up(at, height - 0.92), radius * 1.08, radius * 1.44, sides), 0xebe9e6);

  // Diagonal flying structural knee-corbel brackets springing outward to brace the cantilevered impost.
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    b.prop(trimMaterial, hewnBeam(
      { x: at.x + dx * radius * 0.96, y: at.y + shaftEnd + 0.18, z: at.z + dz * radius * 0.96 },
      { x: at.x + dx * radius * 1.46, y: at.y + height - 0.56, z: at.z + dz * radius * 1.46 },
      radius * 0.34, radius * 0.3, { bevel: 0.04, irregular: 0.03 },
    ), 0xe8e5e0);
    if (ceremonial || reinforced) {
      // Faceted hexagonal Dwarf shield medallion + bronze central stud on the cardinal capital faces.
      const shieldPts = [
        [-0.24 * radius, -0.14 * radius], [0, -0.3 * radius], [0.24 * radius, -0.14 * radius],
        [0.24 * radius, 0.14 * radius], [0, 0.3 * radius], [-0.24 * radius, 0.14 * radius],
      ];
      b.prop(trimMaterial, extrudedProfile(shieldPts, radius * 0.16, {
        bevel: 0.025,
        yaw: dx !== 0 ? Math.PI * 0.5 : 0,
        at: { x: at.x + dx * radius * 1.24, y: at.y + height - 1.18, z: at.z + dz * radius * 1.24 },
      }), 0xdedbd6);
      b.prop('bronze', stoneBox(radius * 0.16, radius * 0.16, radius * 0.16, {
        x: at.x + dx * radius * 1.31, y: at.y + height - 1.18, z: at.z + dz * radius * 1.31,
      }, { yaw: Math.PI / 4, bevel: 0.02, irregular: 0.02 }), 0xe2c086);
    }
  }
  if (ceremonial || reinforced) {
    // Diagonal corner knee spurs for full 8-way monumental crown massing.
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      b.prop(trimMaterial, hewnBeam(
        { x: at.x + sx * radius * 0.72, y: at.y + shaftEnd + 0.28, z: at.z + sz * radius * 0.72 },
        { x: at.x + sx * radius * 1.14, y: at.y + height - 0.56, z: at.z + sz * radius * 1.14 },
        radius * 0.28, radius * 0.24, { bevel: 0.035, irregular: 0.03 },
      ), 0xe2dfda);
    }
  }
  b.prop(trimMaterial, stoneBlock(radius * 2.74, 0.44, radius * 2.74, up(at, height - 0.92), { bevel: 0.08, batter: -0.08, irregular: 0.04 }), 0xf2f0ed);
  b.prop(material, stoneBlock(radius * 3.06, 0.48, radius * 3.06, up(at, height - 0.48), { bevel: 0.07, irregular: 0.04 }), tint);
  b.prop('bronze', stoneBlock(radius * 3.1, 0.1, radius * 3.1, up(at, height - 0.34), { bevel: 0.015, irregular: 0.02 }), 0xcfa96c);
  b.nav.block(at, radius * 1.45, height);
}

/** A heavy forged brazier on a chamfered pedestal, with a real charcoal ember bed and animated flame tongues. */
export function brazier(b, at, {
  tint = '#ffd29e',
  intensity = 6.5,
  range = 24,
  size = 1,
  trimMaterial = 'masonry',
  bronzeRim = false,
} = {}) {
  b.prop(trimMaterial, stoneBlock(1.12 * size, 0.34 * size, 1.12 * size, at, { bevel: 0.05, batter: 0.14, irregular: 0.08 }));
  b.prop(trimMaterial, stoneBlock(0.84 * size, 0.58 * size, 0.84 * size, up(at, 0.34 * size), { bevel: 0.045, batter: 0.08, irregular: 0.08 }));
  // Riveted wrought-iron fire basin + wide flared lip + optional aged bronze collar rim.
  b.prop('iron', rod(up(at, 0.9 * size), up(at, 1.24 * size), 0.34 * size, 0.68 * size, 8), 0x6a6e78);
  b.prop('iron', rod(up(at, 1.24 * size), up(at, 1.38 * size), 0.72 * size, 0.78 * size, 8), 0x7a7f8a);
  if (bronzeRim) {
    b.prop('bronze', rod(up(at, 1.26 * size), up(at, 1.36 * size), 0.75 * size, 0.75 * size, 8), 0xd8b478);
  }
  b.prop('iron', rod(up(at, 1.54 * size), up(at, 1.6 * size), 0.66 * size, 0.66 * size, 8), 0x707580);
  for (let i = 0; i < 6; i += 1) {
    const a = (i / 6) * Math.PI * 2;
    const bx = at.x + Math.cos(a) * 0.62 * size;
    const bz = at.z + Math.sin(a) * 0.62 * size;
    b.prop('iron', rod({ x: bx, y: at.y + 1.3 * size, z: bz }, { x: bx, y: at.y + 1.58 * size, z: bz }, 0.032 * size, 0.028 * size, 5), 0x6c717a);
  }
  // Sculpted dark charcoal bed with glowing ember fissures underneath animated flame tongues.
  b.prop('glow', rod(up(at, 1.22 * size), up(at, 1.36 * size), 0.58 * size, 0.42 * size, 8), '#c83e0e', 1.65);
  const clinkers = [
    [0.24, 0.14, 0.17, 0.35], [-0.22, 0.18, 0.15, 0.9], [0.16, -0.22, 0.16, 1.7],
    [-0.18, -0.18, 0.15, 2.2], [0.02, 0.04, 0.18, 0.6],
  ];
  for (const [ox, oz, s, ang] of clinkers) {
    b.prop('iron', stoneBox(s * 1.15 * size, s * 0.75 * size, s * size, {
      x: at.x + ox * size, y: at.y + 1.36 * size, z: at.z + oz * size,
    }, { yaw: ang, bevel: 0.025 * size, irregular: 0.45 }), 0x221c18);
  }
  b.flame(up(at, 1.36 * size), { width: 0.74 * size, height: 1.05 * size, core: '#fff2bc', outer: '#ff520e', speed: 1.08 });
  b.light(up(at, 1.9 * size), tint, intensity, range, { radius: 2.3, halo: 0.48 * size });
  b.nav.block(at, 0.82 * size, 2);
}

/** A cluster of pale crystal shards that light the way. */
export function crystal(b, at, size, { tint = '#bfe6ff', intensity = 2.2, range = 11, gain = 2.2 } = {}) {
  for (let index = 0; index < 4; index += 1) {
    const lean = { x: at.x + b.range(-0.5, 0.5) * size, y: at.y + b.range(0.7, 1.5) * size, z: at.z + b.range(-0.5, 0.5) * size };
    const foot = { x: at.x + b.range(-0.25, 0.25) * size, y: at.y - 0.1, z: at.z + b.range(-0.25, 0.25) * size };
    b.prop('glow', rod(foot, lean, 0.16 * size, 0.02, 5), tint, gain);
  }
  b.light(up(at, size), tint, intensity, range, { radius: 1, halo: 1.6 * size });
}

/**
 * A building of coursed irregular stone: battered plinth, corner boulder quoins,
 * stepped parapet cornice, timber-framed door and stone-dressed mullioned windows.
 * `front` faces along `yaw` (local +Z of the box before rotation).
 */
export function house(b, at, yaw, width, height, depth, {
  material = 'masonry', tint = 0xffffff, windowTint = '#ffb46a', windows = 2, floors = 1, light = 1.3,
} = {}) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const face = (offset, y, out) => ({ x: at.x + c * offset + s * (depth / 2 + out), y: at.y + y, z: at.z - s * offset + c * (depth / 2 + out) });
  // Core mass + battered stone plinth + corbelled parapet.
  b.prop(material, stoneBlock(width, height, depth, at, { yaw, bevel: 0.05, irregular: 0.18 }), tint);
  b.prop(material, stoneBlock(width + 0.22, 0.55, depth + 0.22, at, { yaw, bevel: 0.05, batter: 0.14, irregular: 0.24 }), tint);
  b.prop(material, coursedWall(face(-width / 2, 0, -0.08), face(width / 2, 0, -0.08), height, 0.28, {
    courseHeight: 0.44, stoneWidth: 0.72, irregular: 0.42, quoins: true,
  }), tint);
  b.prop(material, stoneBlock(width + 0.52, 0.45, depth + 0.52, up(at, height), { yaw, bevel: 0.05, irregular: 0.2 }), tint);
  b.prop(material, stoneBlock(width * 0.72, 0.5, depth * 0.72, up(at, height + 0.45), { yaw, bevel: 0.05, irregular: 0.2 }), tint);

  // Timber door with flanking jamb columns & eared lintel.
  b.prop('timber', stoneBox(1.06, 2.08, 0.14, face(0, 1.04, 0.04), { yaw, bevel: 0.025, irregular: 0.12 }), 0x3b2d22);
  for (const dx of [-0.6, 0.6]) {
    b.prop('timber', stoneBlock(0.18, 2.2, 0.22, face(dx, 0, 0.06), { yaw, bevel: 0.025, batter: 0.08, irregular: 0.2 }), 0x4d3a2b);
  }
  b.prop('timber', stoneBox(1.52, 0.2, 0.24, face(0, 2.2, 0.07), { yaw, bevel: 0.03, irregular: 0.15 }), 0x4d3a2b);

  for (let floor = 0; floor < floors; floor += 1) {
    const y = 1.9 + floor * 3;
    if (y > height - 0.8) break;
    for (let index = 0; index < windows; index += 1) {
      const offset = (index + 0.5) / windows * width - width / 2;
      if (floor === 0 && Math.abs(offset) < 1.1) continue;
      if (b.random() < 0.25) continue;
      b.prop('glow', box(0.5, 0.9, 0.08, face(offset, y, 0.04), yaw), windowTint, 2.4);
      // Stone window sill, lintel, and cross mullion.
      b.prop(material, stoneBox(0.76, 0.14, 0.22, face(offset, y - 0.5, 0.07), { yaw, bevel: 0.025, irregular: 0.15 }), tint);
      b.prop(material, stoneBox(0.84, 0.18, 0.2, face(offset, y + 0.52, 0.06), { yaw, bevel: 0.025, irregular: 0.15 }), tint);
      b.prop('iron', box(0.05, 0.9, 0.06, face(offset, y, 0.08), yaw), 0x2b2724);
      b.prop('iron', box(0.52, 0.05, 0.06, face(offset, y + 0.08, 0.08), yaw), 0x2b2724);
      b.light(face(offset, y, 0.7), windowTint, light, 7, { radius: 0.8, halo: 0.9 });
    }
  }
  b.nav.block(at, Math.max(width, depth) * 0.5, height);
}
