import * as THREE from 'three/webgpu';
import {
  proceduralNormalTexture,
  surfaceBumpTexture,
  surfaceRoughnessTexture,
} from '../../workshop/ProceduralWorkshopMaterials.js';
import { constructionStyle } from '../masonry/ConstructionStyleCatalog.js';

/**
 * Stone materials for live constructions.
 *
 * Mirrors the stone slot of `createWorkshopMaterials`
 * (`ProceduralWorkshopMaterials.js:510-527`) so a wall and a workshop building
 * made of nominally the same stone actually match. Tone mapping is deliberately
 * untouched — the world renderer and the workshop preview are both already
 * ACESFilmic at exposure 1.12 and must stay in agreement.
 *
 * Materials are cached and shared across modules. A 200 m wall is ~17 modules,
 * and giving each its own material would mean 17 identical pipelines.
 */

const cache = new Map();

function materialKey(record) {
  const { key, version, materials } = record.style;
  return [
    key,
    version,
    materials.stone ?? '-',
    materials.mortar ?? '-',
    materials.roof ?? '-',
    record.seed,
  ].join('|');
}

function createStoneMaterial(record, style) {
  const seed = record.seed >>> 0;
  const material = new THREE.MeshStandardNodeMaterial({
    color: '#ffffff',
    roughness: 1,
    metalness: 0,
    // Every stone carries baked crevice occlusion and a per-unit palette colour
    // in its vertex colours. Dropping this throws away every joint line, so any
    // geometry merged into this material must carry the attribute — see
    // `harmonizeVertexColors(..., { required: true })` in the masonry builder.
    vertexColors: true,
  });
  material.bumpMap = surfaceBumpTexture(seed);
  material.bumpScale = 0.055;
  material.roughnessMap = surfaceRoughnessTexture(seed + 101, { base: 226, variation: 26 });
  if (style.detail >= 2) {
    material.normalMap = proceduralNormalTexture(
      style.irregularity > 0.5 ? 'granite' : 'stoneBlock',
      seed + 503,
    );
  }
  material.userData.constructionSlot = 'stone';
  return material;
}

export function createConstructionMaterials(record) {
  const key = materialKey(record);
  const found = cache.get(key);
  if (found) {
    found.users += 1;
    return found.materials;
  }
  const style = constructionStyle(record.style.key);
  const stone = createStoneMaterial(record, style);
  // Selection tints rather than replaces. Swapping to a flat gold material
  // would drop `vertexColors` and take every baked joint line with it, so a
  // selected wall would read as a smooth blob.
  const stoneSelected = stone.clone();
  stoneSelected.emissive = new THREE.Color('#6a4f12');
  stoneSelected.emissiveIntensity = 0.55;
  stoneSelected.userData.constructionSlot = 'stone';
  const materials = Object.freeze({ stone, stoneSelected });
  cache.set(key, { materials, users: 1 });
  return materials;
}

/** Test seam and teardown hook; materials are otherwise shared for the session. */
export function disposeConstructionMaterials() {
  for (const { materials } of cache.values()) {
    for (const material of Object.values(materials)) material.dispose();
  }
  cache.clear();
}
