import { offsetShapePolygon } from './ShapeEnvelope.js';
import { shapeRandom } from './ShapeMesh.js';
import { shapeStoneTint } from './ShapeMasonryCourses.js';
import { SHAPE_CASTLE_CONFIG } from './config/ShapeCastleConfig.generated.js';

const T = SHAPE_CASTLE_CONFIG.turret;

/**
 * The corbelled underside that carries a turret off its host: stacked rings, each a short
 * roll over a splayed bed, narrowing to a point on the host face.
 */
export function buildShapeTurretSupport(feature, mesh, recipe) {
  const child = feature.child, p = child.primitive, drop = feature.turret.drop;
  if (drop < 0.15) return;
  const centre = p.position, steps = recipe.detail >= 2 ? T.corbelSteps : 2;
  const outer = offsetShapePolygon(child.boundary, p.thickness / 2 + 0.06), count = outer.length;
  const ring = (scale, y) => outer.map(([x, z]) => [centre[0] + (x - centre[0]) * scale, p.elevation + y, centre[1] + (z - centre[1]) * scale]);
  const face = (a, b, c, d, color) => {
    const n = [(b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), 0, (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])];
    const mid = [(a[0] + c[0]) / 2 - centre[0], 0, (a[2] + c[2]) / 2 - centre[1]];
    if (n[0] * mid[0] + n[2] * mid[2] >= 0) mesh.quad(a, b, c, d, color); else mesh.quad(d, c, b, a, color);
  };
  const height = drop / steps, tint = shapeStoneTint(recipe, child);
  const stone = (v) => tint.map((channel) => channel * v);
  for (let k = 0; k < steps; k++) {
    const s0 = 1 - (0.94 * k) / steps, s1 = 1 - (0.94 * (k + 1)) / steps, y = -height * k;
    const v = 0.84 + shapeRandom(recipe.seed, child.id, 'turret-corbel', k) * 0.08;
    // A long splayed face catches the light; only a short undercut falls into shadow.
    const top = ring(s0, y), roll = ring(s1 + (s0 - s1) * 0.3, y - height * 0.78), bed = ring(s1, y - height);
    for (let i = 0; i < count; i++) {
      const j = (i + 1) % count;
      face(top[i], top[j], roll[j], roll[i], stone(v));
      face(roll[i], roll[j], bed[j], bed[i], stone(v * 0.96));
    }
  }
}
