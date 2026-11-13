import { arch, beam, block, box, coursedWall, hewnBeam, rod, stoneBlock, stoneBox } from '../gen/propKit.js';

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
 * A monumental Dwarven column: stepped chamfered plinth and octagonal base,
 * continuous octagonal shaft with engaged vertical ribs and horizontal bands,
 * and a corbelled capital with a bronze necking band. Blocks the walker.
 */
export function pillar(b, at, height, radius, { material = 'masonry', tint = 0xffffff, sides = 8 } = {}) {
  // Broad square plinth + stepped octagonal base + recessed transition collar.
  b.prop(material, stoneBlock(radius * 2.85, 0.72, radius * 2.85, at, { bevel: 0.08, batter: 0.14, irregular: 0.1 }), tint);
  b.prop(material, rod(up(at, 0.72), up(at, 1.32), radius * 1.32, radius * 1.16, sides), 0xe8e4dc);
  b.prop(material, rod(up(at, 1.32), up(at, 1.62), radius * 1.06, radius * 0.96, sides), 0xdad5cd);

  // Continuous octagonal shaft with engaged cardinal ribs (recessed panels) and horizontal bands.
  const shaftStart = 1.62;
  const shaftEnd = height - 1.95;
  const shaftH = Math.max(0.8, shaftEnd - shaftStart);
  b.prop(material, rod(up(at, shaftStart), up(at, shaftEnd), radius * 0.96, radius * 0.9, sides), tint);
  const ribW = radius * 0.42;
  const ribSpan = radius * 2.04;
  b.prop(material, stoneBlock(ribW, shaftH, ribSpan, up(at, shaftStart), { bevel: 0.05, batter: 0.04, irregular: 0.06 }), 0xf2efe9);
  b.prop(material, stoneBlock(ribSpan, shaftH, ribW, up(at, shaftStart), { bevel: 0.05, batter: 0.04, irregular: 0.06 }), 0xf2efe9);
  for (const frac of [0.34, 0.68]) {
    const bandY = shaftStart + shaftH * frac;
    const bandR = radius * (1.03 - frac * 0.05);
    b.prop(material, rod(up(at, bandY - 0.12), up(at, bandY + 0.12), bandR, bandR, sides), 0xd8d3cb);
  }

  // Capital: necking ring, bronze geometric band, flared bell, stepped abacus, corbel brackets, impost.
  b.prop(material, rod(up(at, shaftEnd), up(at, shaftEnd + 0.28), radius * 0.94, radius * 1.08, sides), 0xdad5cd);
  b.prop('bronze', rod(up(at, shaftEnd + 0.06), up(at, shaftEnd + 0.2), radius * 1.05, radius * 1.05, sides), 0xe6c896);
  b.prop(material, rod(up(at, shaftEnd + 0.28), up(at, height - 0.95), radius * 1.08, radius * 1.38, sides), 0xeae6de);
  b.prop(material, stoneBlock(radius * 2.75, 0.52, radius * 2.75, up(at, height - 0.95), { bevel: 0.08, batter: -0.06, irregular: 0.08 }), tint);
  b.prop(material, stoneBlock(radius * 3.05, 0.43, radius * 3.05, up(at, height - 0.43), { bevel: 0.07, irregular: 0.08 }), 0xf2efe9);
  // Four cardinal corbel brackets supporting the abacus.
  for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    b.prop(material, stoneBox(
      dx !== 0 ? radius * 0.65 : radius * 0.55,
      0.58,
      dz !== 0 ? radius * 0.65 : radius * 0.55,
      { x: at.x + dx * radius * 1.15, y: height - 1.18, z: at.z + dz * radius * 1.15 },
      { bevel: 0.05, batter: -0.14, irregular: 0.08 },
    ), 0xdcd7cf);
  }
  b.nav.block(at, radius * 1.45, height);
}

/** A fire bowl on a stepped, chamfered plinth. */
export function brazier(b, at, { tint = '#ffb668', intensity = 10, range = 22, size = 1 } = {}) {
  b.prop('masonry', stoneBlock(1.05 * size, 0.35 * size, 1.05 * size, at, { bevel: 0.04, batter: 0.15, irregular: 0.25 }));
  b.prop('masonry', stoneBlock(0.84 * size, 0.6 * size, 0.84 * size, up(at, 0.35 * size), { bevel: 0.04, batter: 0.08, irregular: 0.25 }));
  b.prop('iron', rod(up(at, 0.92 * size), up(at, 1.32 * size), 0.35 * size, 0.76 * size, 10), 0x2c2824);
  b.prop('glow', rod(up(at, 1.28 * size), up(at, 1.62 * size), 0.62 * size, 0.1 * size, 8), tint, 5);
  b.light(up(at, 1.9 * size), tint, intensity, range, { radius: 1.6, halo: 3.2 * size });
  b.nav.block(at, 0.8 * size, 2);
}

/** A cluster of pale crystal shards that light the way. */
export function crystal(b, at, size, { tint = '#bfe6ff', intensity = 2.2, range = 11 } = {}) {
  for (let index = 0; index < 4; index += 1) {
    const lean = { x: at.x + b.range(-0.5, 0.5) * size, y: at.y + b.range(0.7, 1.5) * size, z: at.z + b.range(-0.5, 0.5) * size };
    const foot = { x: at.x + b.range(-0.25, 0.25) * size, y: at.y - 0.1, z: at.z + b.range(-0.25, 0.25) * size };
    b.prop('glow', rod(foot, lean, 0.16 * size, 0.02, 5), tint, 2.2);
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
