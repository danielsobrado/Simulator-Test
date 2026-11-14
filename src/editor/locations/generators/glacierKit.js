import { boulder, icicle } from '../gen/iceKit.js';
import { column, mound } from '../gen/shapes.js';

/**
 * Natural dressing shared by the glacier sites. Ice forms hang from, stand on
 * or fuse with the volume the generator has already cut, so they follow its
 * geology instead of being scattered over it. Material keys: `clearIce`, plus
 * whatever a caller names for blocks and boulders.
 */

const P = (x, y, z) => ({ x, y, z });

/**
 * A cluster of icicles under the roof above `at` (a point in open air): one
 * long one and its lesser neighbours, each rooted where the roof actually is.
 * `drip` sheds meltwater from the longest. Returns false where there is no roof within `reach`.
 */
export function icicleCluster(b, at, { count = 4, length = [0.5, 2.2], spread = 0.5, reach = 14, drip = false } = {}) {
  if (b.grid.sample(at.x, at.y, at.z) < 0) return false;
  const roof = b.probe(at.x, at.y, at.z, 1, reach);
  if (roof === null) return false;
  for (let index = 0; index < count; index += 1) {
    const x = at.x + b.range(-spread, spread), z = at.z + b.range(-spread, spread);
    const from = Math.max(at.y, roof - 1.2);
    if (b.grid.sample(x, from, z) < 0) continue;
    const top = b.probe(x, from, z, 1, 4);
    if (top === null) continue;
    // The first is the cluster's long one; it cannot reach lower than the roof is high.
    const long = Math.min(b.range(length[0], length[1]) * (index === 0 ? 1 : 0.6), (top - at.y) * 0.8 + 0.4);
    b.prop('clearIce', icicle(P(x, top + 0.3, z), long, 0.05 + long * 0.045,
      { lean: { x: b.range(-0.07, 0.07), z: b.range(-0.07, 0.07) }, phase: index * 2.1 }), 0xffffff);
    if (drip && index === 0) b.emit('drip', P(x, top + 0.25 - long, z));
  }
  return true;
}

/** A curtain of icicles under a lip or overhang: clusters every `spacing` metres from `a` to `c`. */
export function icicleCurtain(b, a, c, { spacing = 0.8, length = [0.6, 2.6], drip = false } = {}) {
  const span = Math.hypot(c.x - a.x, c.y - a.y, c.z - a.z);
  for (let along = 0; along <= span; along += spacing) {
    const t = along / span;
    icicleCluster(b, P(a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t, a.z + (c.z - a.z) * t),
      { count: 3, length, spread: spacing * 0.45, drip: drip && b.random() < 0.3 });
  }
}

/**
 * A frozen waterfall fused into the volume: organ-pipe columns from `top` down
 * to `foot`, fanned `width` metres along `across` (a unit vector in plan), and
 * the apron of ice built up where it landed.
 */
export function frozenFall(b, top, foot, across, { width = 7, columns = 9 } = {}) {
  for (let index = 0; index < columns; index += 1) {
    const offset = b.range(-width / 2, width / 2);
    const x = foot.x + across.x * offset, z = foot.z + across.z * offset;
    b.grid.fill(column(P(x, foot.y - 0.5, z), P(top.x + across.x * offset * 0.7, top.y + b.range(-2, 2), top.z + across.z * offset * 0.7),
      b.range(0.9, 1.5), b.range(0.4, 0.7)), 0.9);
  }
  b.grid.fill(mound(P(foot.x, foot.y, foot.z), width * 0.55, 1.5, width * 0.4), 1.2);
}

/**
 * Loose pieces on the ground within `radius` of `at`: calved ice with `blocky`
 * near 1, moraine boulders near 0. `groundAt(x, z)` gives where each one rests;
 * the big ones block the way.
 */
export function scatter(b, at, radius, count, groundAt, { material, size = [0.5, 2], blocky = 0, tint = 0xffffff } = {}) {
  for (let index = 0; index < count; index += 1) {
    const angle = b.range(0, Math.PI * 2), reach = radius * Math.sqrt(b.random());
    const x = at.x + Math.cos(angle) * reach, z = at.z + Math.sin(angle) * reach;
    const ground = groundAt(x, z);
    if (ground === null || Number.isNaN(ground)) continue;
    // Many small pieces, few large: the size is skewed toward the low end.
    const scale = size[0] + (size[1] - size[0]) * b.random() ** 2.2;
    const squash = b.range(0.55, 0.9);
    b.prop(material, boulder(P(x, ground - scale * 0.12, z), scale, scale * squash, scale * b.range(0.7, 1.15),
      { seed: Math.floor(b.range(1, 9999)), blocky, yaw: angle }), tint);
    if (scale > 0.8) b.nav.block(P(x, ground, z), scale * 0.95, scale * squash * 1.4);
  }
}
