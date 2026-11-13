import { createShapeRoofSurface } from './ShapeRoofSurface.js';
import { createShapeRoofOcclusion, clipShapeRoofMesh } from './ShapeRoofOcclusion.js';
import { buildShapeRoofTiles } from './ShapeRoofTiles.js';
import { buildShapeRoofCraft } from './ShapeRoofCraft.js';
import { buildShapeRoofJunctions } from './ShapeRoofJunctionBuilder.js';
import { WORKSHOP_GEOMETRY_TOLERANCE as tolerance } from '../curves/GeometryTolerancePolicy.js';
import { shapeWallCoreMesh, SHAPE_MASONRY_CORE_TONE } from './ShapeMasonryCourses.js';
import { buildShapeProfileRail } from './ShapeProfileRail.js';
import { shapeStoneTint } from './ShapeMasonryCourses.js';

// Overhangs show boarded sarking from below; bare slate there reads as a hole in the roof.
const SOFFIT_TONE = Object.freeze([0.78, 0.74, 0.7]);

export function buildShapeRoof(plan, sourceMeshes, recipe) {
  if (plan.roofReplaced) return;
  const p = plan.primitive,
    surface = createShapeRoofSurface(plan),
    length = plan.curve.length;
  const mask = createShapeRoofOcclusion(plan), hidden = mask.hidden;
  const meshes = Object.fromEntries(Object.entries(sourceMeshes).map(([slot, mesh]) => [slot, clipShapeRoofMesh(mesh, mask)]));
  meshes.trim = clipShapeRoofMesh(sourceMeshes.trim, createShapeRoofOcclusion(plan, { roofMargin: 0.12 }));
  const rings = p.roof.family === 'flat' ? 1 : recipe.detail >= 2 ? 20 : 10;
  const samples = plan.curve.samples.length;
  const paved = p.roof.family === 'flat' && plan.crown && meshes.deck;
  const deckTone = shapeStoneTint(recipe, plan).map((v) => v * 0.78);
  const roofQuad = (quad, color, solid = false) => {
    const area = quad.reduce((sum, a, i) => {
      const b = quad[(i + 1) % quad.length];
      return sum + a[0] * b[2] - b[0] * a[2];
    }, 0);
    if (Math.abs(area) < tolerance.length * tolerance.length) return false;
    const top = surface.wall.clockwise ? quad : quad.toReversed();
    (paved || meshes.roof).quad(...top, paved ? deckTone : color, top.map((v) => surface.uvAt(v[0], v[2])), top.map((v) => surface.normalAt(v[0], v[2])));
    if (solid) {
      const underside = quad.map(([x, y, z]) => [x, y - 0.06, z]);
      if (surface.wall.clockwise) meshes.inserts.quad(...underside.toReversed(), SOFFIT_TONE);
      else meshes.inserts.quad(...underside, SOFFIT_TONE);
    }
    return true;
  };
  for (let row = 0; row < rings; row++) {
    const t0 = row / rings,
      t1 = (row + 1) / rings;
    for (let i = 0; i < samples; i++) {
      const u0 = plan.curve.samples[i].distance,
        u1 = i + 1 < samples ? plan.curve.samples[i + 1].distance : length;
      const quad = [
        surface.point(u0, t0),
        surface.point(u0, t1),
        surface.point(u1, t1),
        surface.point(u1, t0),
      ];
      roofQuad(quad, [0.94, 0.97, 1], true);
    }
  }
  // Close the wall up to the roof surface; especially visible on rounded gable ends.
  const core = shapeWallCoreMesh(plan, meshes, recipe);
  const coreTone = core === meshes.walls ? [1, 1, 1] : SHAPE_MASONRY_CORE_TONE;
  for (let i = 0; i < samples; i++) {
    const u0 = plan.curve.samples[i].distance,
      u1 = i + 1 < samples ? plan.curve.samples[i + 1].distance : length;
    const a = surface.wall.point(u0, p.height, p.thickness / 2),
      b = surface.wall.point(u1, p.height, p.thickness / 2);
    const c = [b[0], Math.max(b[1], surface.heightAt(b[0], b[2])), b[2]];
    const d = [a[0], Math.max(a[1], surface.heightAt(a[0], a[2])), a[2]];
    if (c[1] > b[1] + tolerance.length || d[1] > a[1] + tolerance.length) {
      if (surface.wall.clockwise) core.quad(a, b, c, d, coreTone);
      else core.quad(d, c, b, a, coreTone);
    }
  }
  buildShapeProfileRail(meshes.trim, t => surface.point(t * length, 1), length, 0.1, 0.12,
    recipe.detail, shapeStoneTint(recipe, plan).map((v) => v * 0.8), { closed: true, step: recipe.detail >= 2 ? 0.32 : 0.55 });
  buildShapeRoofCraft(plan, meshes, recipe, surface, hidden);
  if (recipe.detail >= 2 && p.roof.family !== 'flat') buildShapeRoofTiles(plan, meshes.roof, surface, recipe, () => false);
  buildShapeRoofJunctions(plan, meshes.flashing, surface);
}
