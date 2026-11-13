/**
 * Openings and solids for `DensityGrid`. Points are `{x, y, z}` in metres; a
 * floor point's `y` is the walking surface. Every opening has a flat floor, so
 * navigation can describe the same surface with a plane.
 */

const box = (minX, minY, minZ, maxX, maxY, maxZ) => ({
  min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ },
});

/**
 * A passage from floor point `a` to floor point `b` with rounded ends.
 * `arch` (0..1) is how much of the height the roof loses toward the walls:
 * 0 is a squared, tool-cut drift, 1 a pointed natural tube.
 */
export function tunnel(a, b, { halfWidth, height, arch = 0.5 }) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const length = Math.hypot(dx, dz) || 1e-6;
  const ux = dx / length, uz = dz / length;
  const pad = halfWidth + 1;
  return {
    box: box(Math.min(a.x, b.x) - pad, Math.min(a.y, b.y) - 1, Math.min(a.z, b.z) - pad,
      Math.max(a.x, b.x) + pad, Math.max(a.y, b.y) + height + 1, Math.max(a.z, b.z) + pad),
    air(x, y, z) {
      const along = (x - a.x) * ux + (z - a.z) * uz;
      const clamped = Math.min(length, Math.max(0, along));
      const side = Math.hypot((z - a.z) * ux - (x - a.x) * uz, along - clamped);
      const above = y - (a.y + (b.y - a.y) * (clamped / length));
      const ratio = side / halfWidth;
      const roof = height * (1 - arch * ratio * ratio);
      return Math.min(halfWidth - side, above, roof - above);
    },
  };
}

/** A domed chamber: an ellipsoid about `center` cut by a flat floor at `floorY`. */
export function chamber(center, { rx, ry, rz, floorY = center.y - ry }) {
  const scale = Math.min(rx, ry, rz);
  return {
    box: box(center.x - rx - 1, floorY - 1, center.z - rz - 1, center.x + rx + 1, center.y + ry + 1, center.z + rz + 1),
    air(x, y, z) {
      const k = Math.hypot((x - center.x) / rx, (y - center.y) / ry, (z - center.z) / rz);
      return Math.min((1 - k) * scale, y - floorY);
    },
  };
}

/**
 * A cut hall: a box on the floor at `center.y`, `yaw` about Y, with an optional
 * barrel vault of `vaultRise` metres springing from `height` along its length (local X).
 */
export function hall(center, { halfLength, halfWidth, height, vaultRise = 0, yaw = 0 }) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const reach = Math.hypot(halfLength, halfWidth) + 1;
  return {
    box: box(center.x - reach, center.y - 1, center.z - reach,
      center.x + reach, center.y + height + vaultRise + 1, center.z + reach),
    air(x, y, z) {
      const dx = x - center.x, dz = z - center.z;
      const along = dx * c + dz * s, across = dz * c - dx * s;
      const ratio = Math.min(1, Math.abs(across) / halfWidth);
      const roof = height + vaultRise * Math.sqrt(1 - ratio * ratio);
      return Math.min(halfLength - Math.abs(along), halfWidth - Math.abs(across), y - center.y, center.y + roof - y);
    },
  };
}

/** A vertical shaft of `radius` from `bottomY` to `topY`. */
export function shaft(center, { radius, bottomY, topY }) {
  return {
    box: box(center.x - radius - 1, bottomY - 1, center.z - radius - 1, center.x + radius + 1, topY + 1, center.z + radius + 1),
    air(x, y, z) {
      return Math.min(radius - Math.hypot(x - center.x, z - center.z), y - bottomY, topY - y);
    },
  };
}

/** A tapered solid column from `a` (radius `ra`) to `b` (radius `rb`): pillars, stalagmites, icicles. */
export function column(a, b, ra, rb) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const lengthSq = dx * dx + dy * dy + dz * dz || 1e-6;
  const pad = Math.max(ra, rb) + 1;
  return {
    box: box(Math.min(a.x, b.x) - pad, Math.min(a.y, b.y) - pad, Math.min(a.z, b.z) - pad,
      Math.max(a.x, b.x) + pad, Math.max(a.y, b.y) + pad, Math.max(a.z, b.z) + pad),
    solid(x, y, z) {
      const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy + (z - a.z) * dz) / lengthSq));
      return Math.hypot(x - a.x - dx * t, y - a.y - dy * t, z - a.z - dz * t) - (ra + (rb - ra) * t);
    },
  };
}

/** A solid slab: a `yaw`-turned box whose top is at `center.y`, `thickness` deep. Terraces, ledges, benches. */
export function slab(center, { halfLength, halfWidth, thickness, yaw = 0 }) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const reach = Math.hypot(halfLength, halfWidth) + 1;
  return {
    box: box(center.x - reach, center.y - thickness - 1, center.z - reach, center.x + reach, center.y + 1, center.z + reach),
    solid(x, y, z) {
      const dx = x - center.x, dz = z - center.z;
      return Math.max(Math.abs(dx * c + dz * s) - halfLength, Math.abs(dz * c - dx * s) - halfWidth,
        y - center.y, center.y - thickness - y);
    },
  };
}

/** A solid ellipsoid: boulders, snow banks, rubble heaps. */
export function mound(center, rx, ry, rz) {
  const scale = Math.min(rx, ry, rz);
  return {
    box: box(center.x - rx - 1, center.y - ry - 1, center.z - rz - 1, center.x + rx + 1, center.y + ry + 1, center.z + rz + 1),
    solid(x, y, z) {
      return (Math.hypot((x - center.x) / rx, (y - center.y) / ry, (z - center.z) / rz) - 1) * scale;
    },
  };
}

/** A solid round plateau whose flat top is at `center.y`, `depth` metres deep: islands, ledges, daises. */
export function plateau(center, radius, depth) {
  return {
    box: box(center.x - radius - 1, center.y - depth - 1, center.z - radius - 1, center.x + radius + 1, center.y + 1, center.z + radius + 1),
    solid(x, y, z) {
      return Math.max(Math.hypot(x - center.x, z - center.z) - radius, y - center.y, center.y - depth - y);
    },
  };
}
