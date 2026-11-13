import { buildShapeWalls } from './ShapeWallBuilder.js';
import { buildShapeRoof } from './ShapeRoofBuilder.js';
import { buildShapeFacade } from './ShapeFacadeBuilder.js';
import { buildShapeFloors } from './ShapeFloorBuilder.js';
import { createShapeRoofOcclusion, clipShapeRoofMesh, clipShapeMeshSet } from './ShapeRoofOcclusion.js';
import { createShapeWallSurface } from './ShapeWallSurface.js';
import { buildShapeBalcony } from './ShapeBalconyBuilder.js';
import { buildShapeButtress } from './ShapeButtress.js';
import { buildShapeCrown } from './ShapeCrownBuilder.js';
import { buildShapeTurretSupport } from './ShapeTurret.js';
import { shapeStoneTint } from './ShapeMasonryCourses.js';

const tint = [0.9, 0.9, 0.9];
export function buildShapeFeatures(plan, meshes, recipe) {
  for (const feature of plan.features ?? []) {
    if (feature.balcony) { buildShapeBalcony(plan, feature, meshes, recipe); continue; }
    if (feature.solidSupport) { buildShapeButtress(feature, clipShapeMeshSet(meshes, plan).trim, shapeStoneTint(recipe, plan).map((v) => v * 0.9)); continue; }
    const child = feature.child, occlusion = createShapeRoofOcclusion(child);
    const clipped = Object.fromEntries(Object.entries(meshes).map(([key, mesh]) => [key, clipShapeRoofMesh(mesh, occlusion)]));
    if (!feature.openSides) {
      buildShapeWalls(child, clipped, recipe);
      buildShapeFacade(child, clipped, recipe);
      buildShapeFloors(child, clipped);
    } else {
      const f = child.primitive, surface = createShapeWallSurface(child);
      for (const u of [0, child.curve.length * 0.25, child.curve.length * 0.5, child.curve.length * 0.75]) {
        const a = surface.point(u, 0.1), b = surface.point(u, f.height);
        clipped.inserts.beam(a, b, 0.14, 0.14, tint);
        clipped.trim.box([a[0], a[1] - 0.04, a[2]], [0.26, 0.16, 0.26], tint);
        const brace = surface.point(u + 0.42, f.height - 0.04);
        clipped.inserts.beam(surface.point(u, f.height - 0.55), brace, 0.095, 0.095, tint);
      }
      buildShapeFloors(child, clipped);
    }
    buildShapeRoof(child, meshes, recipe);
    buildShapeCrown(child, meshes, recipe);
    if (feature.turret) buildShapeTurretSupport(feature, clipped.trim, recipe);
    if (feature.intent.kind === 'jetty') {
      const surface = createShapeWallSurface(child), count = Math.ceil(child.curve.length / 0.8);
      for (let i = 0; i < count; i++) {
        const u = child.curve.length * i / count;
        clipped.inserts.beam(surface.point(u, -0.05), surface.point(u, -0.55, -feature.intent.depth * 0.9), 0.14, 0.14, tint);
      }
    }
  }
}
