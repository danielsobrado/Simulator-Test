import { shapeProfileOut } from './ShapeProfile.js';

export function pointInShape(point, boundary) {
  let inside = false;
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const a = boundary[i],
      b = boundary[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

/** Move every vertex of a closed polygon along its outward normal. */
export function offsetShapePolygon(points, distance) {
  if (!distance) return points;
  const n = points.length;
  const area = points.reduce((sum, a, i) => { const b = points[(i + 1) % n]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0);
  const sign = area < 0 ? -1 : 1;
  return points.map((point, i) => {
    const a = points[(i + n - 1) % n], b = points[(i + 1) % n];
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz) || 1;
    return [point[0] + (dz / length) * distance * sign, point[1] - (dx / length) * distance * sign];
  });
}

export function shapeEnvelopeAtHeight(plan, height) {
  const p = plan.primitive, local = Math.max(0, Math.min(p.height, height - p.elevation));
  const t = local / p.height;
  return offsetShapePolygon(plan.boundary.map((point, i) => [
    point[0] + (plan.topBoundary[i][0] - point[0]) * t,
    point[1] + (plan.topBoundary[i][1] - point[1]) * t,
  ]), shapeProfileOut(p, Math.min(local, p.height - 1e-4)));
}
