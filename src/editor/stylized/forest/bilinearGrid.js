/**
 * Bilinear helpers shared by every habitat-derived grid: forest-floor density,
 * far-terrain canopy signal and the gridded patch cache. Habitat fields vary
 * over tens to hundreds of metres, so sampling them on a coarse grid and
 * interpolating is visually identical to per-position evaluation at a fraction
 * of the cost.
 */

export function bilinear(bottomLeft, bottomRight, topLeft, topRight, tx, tz) {
  const bottom = bottomLeft + (bottomRight - bottomLeft) * tx;
  const top = topLeft + (topRight - topLeft) * tx;
  return bottom + (top - bottom) * tz;
}

/** Clamped bilinear read from a flat `size × size` array at fractional coords. */
export function bilinearSample(values, size, gridX, gridZ) {
  const x0 = Math.min(size - 1, Math.max(0, Math.floor(gridX)));
  const z0 = Math.min(size - 1, Math.max(0, Math.floor(gridZ)));
  const x1 = Math.min(size - 1, x0 + 1);
  const z1 = Math.min(size - 1, z0 + 1);
  return bilinear(
    values[z0 * size + x0],
    values[z0 * size + x1],
    values[z1 * size + x0],
    values[z1 * size + x1],
    gridX - x0,
    gridZ - z0,
  );
}
