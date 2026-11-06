import * as THREE from 'three/webgpu';
import { materialEmissive } from 'three/tsl';
import { cloneAuthoredNodeMaterial } from '../AuthoredFoliageMaterial.js';
import { foliageMaterialClass } from './FoliageNodeMaterial.js';

/** Preserve authored surface channels; the tree supplies its graded colour separately. */
export function createTreeSurfaceMaterial(source, { foliage = false } = {}) {
  const material = source?.isMaterial
    ? cloneAuthoredNodeMaterial(source, { lit: true })
    : new (foliage ? foliageMaterialClass(THREE.MeshLambertNodeMaterial) : THREE.MeshLambertNodeMaterial)();
  // Colour is explicitly included in the tree's colour AND sky-fill nodes. Letting
  // NodeMaterial multiply COLOR_0 again would square it in direct lighting only.
  material.vertexColors = false;
  if (foliage) material.side = THREE.DoubleSide;
  else material.side = source?.side ?? THREE.FrontSide;
  return material;
}

/** Add the outdoor fill without discarding an authored emissive channel. */
export function addTreeEmission(material, fill) {
  const authored = material.emissiveNode
    ?? (material.emissiveMap || material.emissive?.getHex() ? materialEmissive : null);
  material.emissiveNode = authored ? authored.add(fill) : fill;
  return material;
}
