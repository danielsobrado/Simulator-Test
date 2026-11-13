import { createShapeWallSurface } from './ShapeWallSurface.js';
import { shapeBounds } from './ShapePaths.js';

/** A support follows the host at every profile height, including its ground contact. */
export function resolveShapeButtress(host, intent, frame) {
  const wall = createShapeWallSurface(host), p = host.primitive;
  const width = Math.min(intent.width, 0.7), height = Math.min(intent.height, p.height * 0.86);
  const point = (x, y, z) => {
    const center = wall.point(frame.u, y, p.thickness / 2);
    return [center[0] + frame.tangent[0] * x + frame.outward[0] * z,
      center[1], center[2] + frame.tangent[2] * x + frame.outward[2] * z];
  };
  const depth = intent.depth;
  const profile = [[0, -0.05], [depth, -0.05], [depth, 0.4], [depth * 0.28, height * 0.7], [depth * 0.18, height], [0, height]];
  const sides = [-1, 1].map((sign) => profile.map(([z, y]) => point(sign * width / 2, y, z)));
  const footprint = [[-width / 2, 0], [width / 2, 0], [width / 2, depth], [-width / 2, depth]]
    .map(([x, z]) => { const v = point(x, 0, z); return [v[0], v[2]]; });
  return { frame: { ...frame, origin: point(0, 0, 0) },
    solidSupport: { width, height, sides, footprint, bounds: shapeBounds(sides.flat().map(([x, , z]) => [x, z])) } };
}

export function buildShapeButtress(feature, mesh, tint = [0.9, 0.9, 0.9]) {
  const sides = feature.solidSupport.sides, count = sides[0].length;
  for (let i = 1; i < count - 1; i++) {
    mesh.triangle(sides[0][0], sides[0][i + 1], sides[0][i], tint);
    mesh.triangle(sides[1][0], sides[1][i], sides[1][i + 1], tint);
  }
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    mesh.quad(sides[0][i], sides[0][j], sides[1][j], sides[1][i], tint);
  }
}
