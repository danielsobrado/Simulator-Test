import { createRoofSurface } from '../village/HouseRoofSurface.js';
import { createShapeWallSurface } from './ShapeWallSurface.js';
import { placeShapePoint } from './ShapePaths.js';
import { pointInShape } from './ShapeEnvelope.js';
import { WORKSHOP_GEOMETRY_TOLERANCE as tolerance } from '../curves/GeometryTolerancePolicy.js';
import { shapeRoofReach } from './ShapeCrown.js';

const profiles = Object.freeze({
  cone: (t, p) => p.rise * (1 - t),
  bell: (t, p) => p.rise * (1 - ((1 - p.sweep * 0.8) * t + p.sweep * 0.8 * (2 * t - t * t))),
  spire: (t, p) => p.rise * (1 - t) ** (1.35 + p.sweep * 0.4),
  flat: () => 0,
});

export function createShapeRoofSurface(plan) {
  const p = plan.primitive,
    roof = p.roof,
    wall = createShapeWallSurface(plan);
  const halfWidth = (p.footprint.width * p.taper) / 2,
    halfDepth = (p.footprint.depth * p.taper) / 2;
  const depthAxis = roof.axis === 'depth';
  const alongHalf = depthAxis ? halfDepth : halfWidth, acrossHalf = depthAxis ? halfWidth : halfDepth;
  const patch = ['gable', 'hip'].includes(roof.family)
    ? createRoofSurface({
        x0: -alongHalf - p.thickness / 2,
        x1: alongHalf + p.thickness / 2,
        z0: -acrossHalf - p.thickness / 2,
        z1: acrossHalf + p.thickness / 2,
        wallTop: p.height,
        rise: roof.rise,
        overhang: roof.overhang,
        sweep: roof.sweep,
        sag: roof.sag,
        hip: roof.family === 'hip' ? 1 : 0,
      })
    : null;
  const angle = (p.rotation * Math.PI) / 180;
  const outline = plan.curve.samples.map((sample) =>
    wall.point(sample.distance, p.height - 1e-4, shapeRoofReach(p)),
  );
  function local(x, z) {
    const dx = x - p.position[0],
      dz = z - p.position[1];
    return [
      dx * Math.cos(angle) + dz * Math.sin(angle),
      -dx * Math.sin(angle) + dz * Math.cos(angle),
    ];
  }
  function heightAt(x, z) {
    const [lx, lz] = local(x, z);
    if (patch) {
      const along = depthAxis ? lz : lx, across = depthAxis ? lx : lz;
      return p.elevation + patch.height(patch.ridgeDistance(along, across), along);
    }
    const dx = x - p.position[0],
      dz = z - p.position[1];
    let radius = Infinity;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i],
        b = outline[(i + 1) % outline.length];
      const ax = a[0] - p.position[0],
        az = a[2] - p.position[1],
        ex = b[0] - a[0],
        ez = b[2] - a[2];
      const cross = dx * ez - dz * ex;
      if (Math.abs(cross) < tolerance.length * tolerance.length) continue;
      const r = (ax * ez - az * ex) / cross,
        edge = (ax * dz - az * dx) / cross;
      if (r > 0 && edge >= -tolerance.intersection && edge <= 1 + tolerance.intersection)
        radius = Math.min(radius, r);
    }
    const t = Number.isFinite(radius) ? Math.min(1, 1 / radius) : 0;
    return p.elevation + p.height + 0.08 + profiles[roof.family](t, roof);
  }
  function point(distance, t, lift = 0) {
    const outer = wall.point(distance, p.height - 1e-4, shapeRoofReach(p));
    let x = p.position[0] + (outer[0] - p.position[0]) * t;
    let z = p.position[1] + (outer[2] - p.position[1]) * t;
    if (roof.family === 'gable') {
      const [lx, lz] = local(outer[0], outer[2]);
      const localX = depthAxis ? lx * t : lx, localZ = depthAxis ? lz : lz * t;
      x = p.position[0] + localX * Math.cos(angle) - localZ * Math.sin(angle);
      z = p.position[1] + localX * Math.sin(angle) + localZ * Math.cos(angle);
    }
    const y = patch
      ? heightAt(x, z)
      : p.elevation + p.height + 0.08 + profiles[roof.family](t, roof);
    return [x, y + lift, z];
  }
  function normalAt(x, z) {
    const delta = 0.003;
    const dx = (heightAt(x + delta, z) - heightAt(x - delta, z)) / (2 * delta);
    const dz = (heightAt(x, z + delta) - heightAt(x, z - delta)) / (2 * delta);
    const length = Math.hypot(dx, 1, dz);
    return [-dx / length, 1 / length, -dz / length];
  }
  /**
   * Convex creases a capping row must cover: a hip roof's ridge and its four hips, clipped to
   * the real eaves outline, as world polylines sampled every `step` metres along the plan.
   */
  function ridgeLines(step = 0.2) {
    if (!patch || roof.family !== 'hip') return [];
    const eaves = outline.map((v) => [v[0], v[2]]);
    const world = (along, across) => placeShapePoint(p, depthAxis ? [across, along] : [along, across]);
    const trace = (count, at) => {
      const line = [];
      for (let i = 0; i <= count; i++) {
        const [x, z] = world(...at(i / count));
        if (!pointInShape([x, z], eaves)) break;
        line.push([x, heightAt(x, z), z]);
      }
      return line;
    };
    const lines = [];
    if (patch.ridgeHalf > step) lines.push(trace(Math.ceil((patch.ridgeHalf * 2) / step), (s) => [-patch.ridgeHalf + 2 * patch.ridgeHalf * s, 0]));
    const hipLength = Math.hypot(patch.hipRun, patch.eaves);
    for (const sa of [-1, 1]) for (const sc of [-1, 1]) {
      lines.push(trace(Math.ceil(hipLength / step), (r) => [sa * (patch.ridgeHalf + r * patch.hipRun), sc * r * patch.eaves]));
    }
    return lines.filter((line) => line.length > 1);
  }
  return { point, heightAt, normalAt, uvAt: (x, z) => local(x, z), wall, outline, ridgeLines };
}
