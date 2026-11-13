import { createShapeWallSurface, addWallPatch, wallSolidBands } from './ShapeWallSurface.js';
import { buildShapeOpenings } from './ShapeOpeningBuilder.js';
import { buildShapeWeathering, shapeAgingSurface } from './ShapeWeathering.js';
import { buildShapePavilionInterior } from './ShapePavilionInterior.js';
import { buildShapeMasonryCourses, shapeWallCoreMesh, SHAPE_MASONRY_CORE_TONE, SHAPE_ASHLAR_JOINT_TONE } from './ShapeMasonryCourses.js';
import { shapeProfileBreaks } from './ShapeProfile.js';

export function buildShapeWalls(plan, meshes, recipe) {
  const surface = shapeAgingSurface(createShapeWallSurface(plan), plan, recipe.seed, plan.primitive.surface === 'planks'),
    p = plan.primitive;
  const boundaries = plan.curve.samples.map((s) => s.distance);
  const openingEdges = new Set();
  if (plan.curve.closed) boundaries.push(surface.length);
  for (const o of plan.openings ?? p.openings ?? []) {
    // Narrow loops need only a few cuts; 24 across an arrow slit would shred its stones into slivers.
    const steps = Math.max(2, Math.min(24, Math.ceil(o.width / 0.03)));
    for (let i = 0; i <= steps; i++) {
      const d = o.at * surface.length - o.width / 2 + (o.width * i) / steps;
      const distance = plan.curve.closed
        ? ((d % surface.length) + surface.length) % surface.length
        : Math.max(0, Math.min(surface.length, d));
      boundaries.push(distance);
      if (i === 0 || i === steps) openingEdges.add(distance);
    }
  }
  const distances = [...new Set(boundaries)].sort((a, b) => a - b);
  const core = shapeWallCoreMesh(plan, meshes, recipe);
  const sections = [0, ...shapeProfileBreaks(p), p.height];
  const coreTone = core !== meshes.walls ? SHAPE_MASONRY_CORE_TONE
    : p.surface === 'masonry' && p.stonework === 'ashlar' ? SHAPE_ASHLAR_JOINT_TONE : [1, 1, 1];
  for (let i = 0; i < distances.length - 1; i++) {
    const u0 = distances[i],
      u1 = distances[i + 1];
    for (let s = 0; s < sections.length - 1; s++)
    for (const band of wallSolidBands(surface, u0, u1, sections[s] + (s ? 1e-4 : 0), sections[s + 1] - (s < sections.length - 2 ? 1e-4 : 0), false)) {
      addWallPatch(
        core,
        surface,
        u0,
        u1,
        band.bottom,
        band.top,
        p.thickness / 2,
        p.thickness,
        coreTone,
        {
          ...(p.surface === 'masonry' ? { sideMesh: meshes.trim, sideColor: SHAPE_MASONRY_CORE_TONE } : {}),
          start: openingEdges.has(u0) || (!plan.curve.closed && i === 0),
          end: openingEdges.has(u1) || (!plan.curve.closed && i === distances.length - 2),
        },
      );
    }
  }
  buildShapeMasonryCourses(plan, meshes, recipe, surface, distances, openingEdges);
  // Continuous coping/eave band follows the same surface as the wall.
  for (
    let i = 0;
    i < distances.length - 1 && !plan.crown && (p.kind === 'curved-wall' || p.roof.family === 'flat');
    i++
  ) {
    const u0 = distances[i],
      u1 = distances[i + 1];
    if (!surface.excluded((u0 + u1) / 2, p.height - 0.05))
      addWallPatch(
        meshes.trim,
        surface,
        u0,
        u1,
        p.height - 0.13,
        p.height + 0.06,
        p.thickness / 2 + 0.065,
        p.thickness + 0.13,
        [0.96, 0.96, 0.96],
      );
  }
  buildShapeOpenings(plan, meshes, recipe, surface);
  buildShapePavilionInterior(plan, meshes, recipe, surface, distances);
  buildShapeWeathering(plan, meshes, recipe, surface);
  return surface;
}
