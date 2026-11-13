import * as THREE from 'three/webgpu';
import { ShapeMesh } from './ShapeMesh.js';
import { buildShapeWalls } from './ShapeWallBuilder.js';
import { buildShapeRoof } from './ShapeRoofBuilder.js';
import { buildShapeSupports, buildShapeTraversal } from './ShapeTraversalBuilder.js';
import { buildShapeIvy } from './ShapeIvyBuilder.js';
import { shapeProductDomains } from './ShapeProductDomains.js';
import { buildShapeFloors } from './ShapeFloorBuilder.js';
import { buildShapeFacade } from './ShapeFacadeBuilder.js';
import { shapeStyleSlot, shapeStyleSourceRegion, shapeStyleFallbackRegion } from './ShapeStyles.js';
import { buildShapeFeatures } from './ShapeFeatureBuilder.js';
import { buildShapeGrounding } from './ShapeGrounding.js';
import { clipShapeMeshSet } from './ShapeRoofOcclusion.js';
import { buildShapeCrown } from './ShapeCrownBuilder.js';

const builders = new Map([
  [
    'walls',
    (plan, meshes, recipe) => {
      buildShapeWalls(plan, clipShapeMeshSet(meshes, plan, { roofs: false }), recipe);
      if (plan.primitive.roof) buildShapeFloors(plan, meshes);
    },
  ],
  ['roof', buildShapeRoof],
  ['crown', buildShapeCrown],
  ['facade', (plan, meshes, recipe) => buildShapeFacade(plan, clipShapeMeshSet(meshes, plan, { roofs: false }), recipe)],
  ['ivy', buildShapeIvy],
  ['supports', (plan, meshes) => buildShapeSupports(plan, meshes.supports)],
  ['traversal', buildShapeTraversal],
  ['features', buildShapeFeatures],
  ['ground', buildShapeGrounding],
]);
const slots = Object.freeze({
  walls: 'mortar',
  roof: 'roof',
  trim: 'stone',
  inserts: 'wood',
  glazing: 'recess',
  deck: 'stone',
  foliage: 'foliage',
  metal: 'metal',
  flashing: 'metal',
  supports: 'stone',
  rails: 'stone',
});

export function buildRegisteredShape(
  plan,
  materials,
  recipe,
  domains = shapeProductDomains(plan, recipe),
) {
  const meshes = Object.fromEntries(Object.keys(slots).map((key) => [key, new ShapeMesh()]));
  for (const domain of domains) {
    const build = builders.get(domain);
    if (!build) throw new Error(`Unknown shape product domain: ${domain}.`);
    build(plan, meshes, recipe);
  }
  const parts = [];
  try {
    for (const [family, mesh] of Object.entries(meshes)) {
      const geometry = mesh.geometry();
      if (!geometry) continue;
      geometry.userData.workshopSemantic = {
        id: plan.id,
        label: plan.primitive.label,
        kind: 'structure',
        attachmentSurface: null,
      };
      const styled = ['deck', 'trim', 'supports', 'rails'].includes(family);
      const slot = styled ? shapeStyleSlot(plan, family) : slots[family];
      parts.push({
        geometry,
        material: materials[slot],
        matrix: new THREE.Matrix4(),
        materialRegion: {
          id: `${plan.id}:${family}`,
          componentId: plan.id,
          label: `${plan.primitive.label} · ${family}`,
          inheritsFrom: shapeStyleSourceRegion(plan, family),
          inheritFallback: shapeStyleFallbackRegion(plan, family),
          ...(family === 'flashing' ? { defaultPresetId: 'weathered-lead' } : {}),
          family: styled ? slot :
            family === 'flashing' ? 'metal' :
            family === 'trim'
              ? 'stone'
              : family === 'inserts'
                ? 'wood'
                : family === 'deck'
                  ? 'stone'
                  : family === 'glazing'
                    ? 'recess'
                    : family,
          connected: true,
        },
      });
    }
    return parts;
  } catch (error) {
    for (const part of parts) part.geometry.dispose();
    throw error;
  }
}
