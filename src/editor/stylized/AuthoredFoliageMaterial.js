import * as THREE from 'three/webgpu';
import { attribute, dot, float, mix, vec3 } from 'three/tsl';
import { authoredTexture } from './AuthoredTextureNode.js';
import { gradePlantPart, resolveFoliagePalette } from './forest/foliagePalette.js';
import { understoryShadeEmission } from './forest/foliageLight.js';
import { foliageMaterialClass } from './forest/FoliageNodeMaterial.js';
import { applyCloudShadow } from './CloudShadow.js';

/** Clone authored channels into a node material before assigning foliage nodes. */
export function cloneAuthoredNodeMaterial(source, { lit = false } = {}) {
  let material;
  const promote = lit && (source.isMeshBasicMaterial || source.isMeshBasicNodeMaterial);
  if (promote) material = new THREE.MeshLambertNodeMaterial();
  else if (source.isNodeMaterial) material = source.clone();
  else if (source.isMeshPhysicalMaterial) material = new THREE.MeshPhysicalNodeMaterial();
  else if (source.isMeshStandardMaterial) material = new THREE.MeshStandardNodeMaterial();
  else if (source.isMeshPhongMaterial) material = new THREE.MeshPhongNodeMaterial();
  else if (source.isMeshLambertMaterial) material = new THREE.MeshLambertNodeMaterial();
  else if (source.isMeshBasicMaterial) material = new THREE.MeshBasicNodeMaterial();
  else material = new THREE.MeshStandardNodeMaterial();
  if (promote || !source.isNodeMaterial) material.copy(source);
  if (lit) material = new (foliageMaterialClass(material.constructor))().copy(material);
  // Several authored plant GLBs declare KHR_materials_unlit. Their albedo and
  // cutouts belong to the asset; their lighting belongs to the outdoor scene.
  if (promote) material.lights = true;
  // NodeMaterial.copy skips inherited accessors such as Material.alphaTest.
  // Keep the authored cutoff when adding output effects or foliage nodes.
  material.alphaTest = source.alphaTest ?? 0;
  return material;
}

export function authoredFoliageColor(material) {
  const value = new THREE.Color(material.color ?? '#ffffff');
  const base = vec3(value.r, value.g, value.b);
  return material.map ? authoredTexture(material.map).rgb.mul(base) : base;
}

/**
 * The biome's understory look (biome-looks `understory`), per instance: greyed
 * toward its own luminance by `w` (saturation), then tinted by rgb. A shrub
 * shared by several biomes otherwise wore one biome's green in all of them.
 */
export function biomeUnderstoryColor(color) {
  const look = attribute('instanceBiomeLook', 'vec4');
  return mix(vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), color, look.w).mul(look.xyz);
}

/**
 * Green leaves share the meadow/canopy ramp; flowers and bark retain their paint.
 * `biomeLook` reads the instance's understory look; its mesh must carry
 * `instanceBiomeLook` (a part with `instanceBiomeLook: true`).
 */
export function applyUnderstoryPalette(material, config, tileId = null, role = 'auto', { biomeLook = false } = {}) {
  const graded = gradePlantPart(authoredFoliageColor(material), resolveFoliagePalette(config, tileId), role);
  const color = biomeLook ? biomeUnderstoryColor(graded) : graded;
  material.colorNode = color;
  const blossom = role === 'petal' || role === 'center';
  const fill = understoryShadeEmission(color, { blossom });
  material.foliageTransmissionNode = float(blossom ? .16 : .22);
  // Retain any authored emission (e.g. flower centres).
  material.emissiveNode = material.emissiveNode ? material.emissiveNode.add(fill) : fill;
  return applyCloudShadow(material, config.sky);
}
