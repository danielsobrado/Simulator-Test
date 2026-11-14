/** Measurements in plan (the XZ plane) that generators share. */

/** Distance in plan from `p` to the polyline through `points`. */
export function planDistance(p, points) {
  let best = Infinity;
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = points[index], c = points[index + 1];
    const dx = c.x - a.x, dz = c.z - a.z;
    const t = Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1e-6)));
    best = Math.min(best, Math.hypot(p.x - a.x - dx * t, p.z - a.z - dz * t));
  }
  return best;
}

/**
 * How firmly a point lies on a trodden line: 1 on any of `paths` (polylines),
 * falling to 0 at `halfWidth` metres from the nearest.
 */
export function onTrail(p, paths, halfWidth) {
  let nearest = Infinity;
  for (const path of paths) nearest = Math.min(nearest, planDistance(p, path));
  return Math.max(0, 1 - nearest / halfWidth);
}
