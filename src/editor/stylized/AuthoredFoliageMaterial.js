import * as THREE from 'three/webgpu';
import { attribute, dot, float, materialRoughness, mix, mx_noise_float, normalWorld, positionWorld, smoothstep, vec3 } from 'three/tsl';
import { surfaceWetnessUniform } from '../weather/surfaceWetness.js';
import { LOOK_SNOW_STEPS } from '../biomes/BiomeLooks.js';
import { authoredTexture } from './AuthoredTextureNode.js';
import { gradePlantPart, resolveFoliagePalette } from './forest/foliagePalette.js';
import { understoryShadeEmission } from './forest/foliageLight.js';
import { foliageMaterialClass } from './forest/FoliageNodeMaterial.js';
import { applyCloudShadow } from './CloudShadow.js';

/** Roughness of a fully rain-wet leaf. */
const WET_LEAF_ROUGHNESS = 0.34;

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
 * toward its own luminance by its saturation, then tinted by rgb. A shrub
 * shared by several biomes otherwise wore one biome's green in all of them.
 *
 * In snow country the leaves and bark facing the sky carry snow, broken in
 * clumps, as shrubs and logs do in Community Shaders' snow cover. `w` packs
 * saturation + 4 * snow steps (BiomeLooks LOOK_SNOW_STEPS).
 */
export function biomeUnderstoryColor(color) {
  const look = attribute('instanceBiomeLook', 'vec4');
  const snowSteps = look.w.div(4).floor();
  const saturation = look.w.sub(snowSteps.mul(4));
  const tinted = mix(vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), color, saturation).mul(look.xyz);
  const clumps = mx_noise_float(positionWorld.mul(2.7)).mul(0.5).add(0.5);
  // A trace of snow switches it off, as on the rocks (snowDeposition): taiga's 0.1
  // mixed 13% white into dark leaves, which in linear light doubled their value
  // and drew every shrub, plant and log there pale blue (2026-11-12 captures).
  const depth = snowSteps.div(LOOK_SNOW_STEPS);
  const cap = smoothstep(0.15, 0.55, normalWorld.y.add(clumps.sub(0.5).mul(0.5)))
    .mul(depth.mul(1.2).clamp(0, 1)).mul(depth.smoothstep(0.08, 0.3));
  return mix(tinted, vec3(0.9, 0.93, 0.97), cap.mul(0.9));
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
  if ('roughness' in material) {
    // Rain film on leaves that face the sky: the sun glints, as on the terrain.
    const wet = surfaceWetnessUniform.mul(smoothstep(0.1, 0.7, normalWorld.y));
    material.roughnessNode = mix(materialRoughness, materialRoughness.min(WET_LEAF_ROUGHNESS), wet);
  }
  return applyCloudShadow(material, config.sky);
}
