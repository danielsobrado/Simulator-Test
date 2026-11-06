import * as THREE from 'three/webgpu';
import { attribute, context, mix, normalGeometry, normalViewGeometry, positionGeometry, positionView, texture, uv, vec3 } from 'three/tsl';
import { authoredTexture } from '../AuthoredTextureNode.js';
import { applyBarkWeathering } from '../barkWeathering.js';
import { gradeBark, resolveBarkGrade } from './barkGrade.js';
import { treeBarkEmission } from './foliageLight.js';
import { treeBendPosition } from './treeSway.js';
import { addTreeEmission, createTreeSurfaceMaterial } from './TreeSurfaceMaterial.js';
import { resolveTreeBarkSettings } from './treeSurfaceSettings.js';
import { foliageMaterialClass } from './FoliageNodeMaterial.js';
import { barkParallax } from './BarkParallax.js';
import { applyTreeBarkWetSurface } from './TreeWetSurface.js';

const colorNode = value => vec3(...new THREE.Color(value).toArray());

export function barkBumpNormal(height) {
  const dx = positionView.dFdx(), dy = positionView.dFdy();
  const tangentX = dy.cross(normalViewGeometry), tangentY = normalViewGeometry.cross(dx);
  const determinant = dx.dot(tangentX);
  const gradient = determinant.sign().mul(height.dFdx().mul(tangentX).add(height.dFdy().mul(tangentY)));
  return determinant.abs().mul(normalViewGeometry).sub(gradient).normalize();
}

/** Packed RG normals decoded in each projection's derivative tangent frame. */
export function barkPackedNormal(packed, coords) {
  const n = normalViewGeometry, px = positionView.dFdx(), py = positionView.dFdy();
  const dx = coords.dFdx(), dy = coords.dFdy();
  const tx = py.cross(n), ty = n.cross(px);
  const t = tx.mul(dx.x).add(ty.mul(dy.x)), b = tx.mul(dx.y).add(ty.mul(dy.y));
  const scale = t.dot(t).max(b.dot(b)).max(1e-8).inverseSqrt();
  const xy = packed.rg.mul(2).sub(1);
  const z = xy.dot(xy).oneMinus().max(0.001).sqrt();
  return t.mul(xy.x).add(b.mul(xy.y)).mul(scale).add(n.mul(z)).normalize();
}

/** Both projection and blend weights stay in the undeformed prototype frame. */
export function sampleTreeBark(map, scale) {
  const weights = normalGeometry.abs().div(normalGeometry.abs().dot(vec3(1)).max(1e-5));
  return texture(map, positionGeometry.yz.mul(scale)).mul(weights.x)
    .add(texture(map, positionGeometry.zx.mul(scale)).mul(weights.y))
    .add(texture(map, positionGeometry.xy.mul(scale)).mul(weights.z));
}

function finishBark(material, { barkWeathering, barkGrade, sway, surface }) {
  material.colorNode = gradeBark(material.colorNode, resolveBarkGrade(barkGrade));
  applyBarkWeathering(material, { settings: barkWeathering });
  applyTreeBarkWetSurface(material, surface);
  if (sway?.time) material.positionNode = treeBendPosition(sway);
  material.userData.barkLighting = true;
  material.userData.treeBarkSurface = surface;
  return addTreeEmission(material, treeBarkEmission(material.colorNode));
}

function pbrBarkMaterial(source, surface) {
  if (!surface.enabled || source?.isMeshStandardMaterial || source?.isMeshStandardNodeMaterial) return createTreeSurfaceMaterial(source);
  const material = new (foliageMaterialClass(THREE.MeshStandardNodeMaterial))({ roughness: surface.roughness });
  // Lambert/unlit sources have no PBR roughness. Retain their common authored
  // channels without copying undefined PBR fields over the Standard defaults.
  for (const key of ['map', 'normalMap', 'normalMapType', 'bumpMap', 'bumpScale', 'aoMap', 'aoMapIntensity', 'emissiveMap', 'emissiveIntensity',
    'alphaMap', 'opacity', 'alphaTest', 'side', 'flatShading', 'normalNode', 'emissiveNode']) {
    if (source?.[key] !== undefined) material[key] = source[key];
  }
  if (source?.normalScale) material.normalScale.copy(source.normalScale);
  if (source?.emissive) material.emissive.copy(source.emissive);
  return material;
}

function barkProjection(textures, scale, surface) {
  const weights = normalGeometry.abs().div(normalGeometry.abs().dot(vec3(1)).max(1e-5));
  const coordinates = [positionGeometry.yz, positionGeometry.zx, positionGeometry.xy].map(coord => coord.mul(scale));
  const relief = coordinates.map(coord => surface.enabled && surface.parallax.enabled
    ? barkParallax(textures.albedoHeight, coord, 'a', surface.parallax) : { uv: coord, shadow: null });
  const cache = new Map();
  const samples = map => {
    if (!cache.has(map)) cache.set(map, relief.map(item => texture(map, item.uv)));
    return cache.get(map);
  };
  const sample = map => {
    const taps = samples(map);
    return taps[0].mul(weights.x).add(taps[1].mul(weights.y)).add(taps[2].mul(weights.z));
  };
  const shadow = relief[0].shadow
    ? relief[0].shadow.mul(weights.x).add(relief[1].shadow.mul(weights.y)).add(relief[2].shadow.mul(weights.z)) : null;
  return { sample, samples, shadow, relief, weights };
}

export function createAuthoredTrunkMaterial({
  source, sourceMap = null, barkTextures = null, barkScale = 0.8,
  barkWeathering = null, barkGrade = null, sway = null, vertexColor = false,
  config = null,
}) {
  const surface = resolveTreeBarkSettings(config?.trees);
  let material;
  if (!barkTextures) {
    material = pbrBarkMaterial(source, surface);
    material.map = sourceMap ?? source?.map ?? null;
    const base = colorNode(source?.color ?? '#ffffff');
    material.colorNode = material.map ? authoredTexture(material.map).rgb.mul(base) : base;
    const heightMap = source?.bumpMap;
    // Keep the loader's independent map transforms. Displace the common base UV
    // before each texture applies its own KHR_texture_transform matrix.
    const sameUv = [material.map, material.normalMap, material.roughnessMap, material.aoMap]
      .filter(Boolean).every(map => map.channel === heightMap?.channel);
    if (surface.enabled && surface.parallax.enabled && heightMap && sameUv && !material.contextNode) {
      const relief = barkParallax(heightMap, uv(heightMap.channel), 'r', surface.parallax, { authoredTransform: true });
      material.contextNode = context({ getUV: mapNode => mapNode.value.channel === heightMap.channel ? relief.uv : null });
      material.treeSurfaceShadowNode = relief.shadow;
      material.treeBarkHeightNode = authoredTexture(heightMap).r;
    }
  } else {
    const projection = barkProjection(barkTextures, barkScale, surface);
    const albedoHeight = projection.sample(barkTextures.albedoHeight);
    const normalRoughness = projection.sample(barkTextures.normalRoughness);
    const decodedAlbedo = albedoHeight.rgb.mul(albedoHeight.rgb);
    material = new (foliageMaterialClass(THREE.MeshStandardNodeMaterial))({ side: source?.side ?? THREE.FrontSide });
    material.colorNode = mix(colorNode(source?.color ?? '#6b4a30'), decodedAlbedo.mul(1.35), 0.72)
      .mul(albedoHeight.a.mul(0.45).add(0.68));
    const samples = projection.samples(barkTextures.normalRoughness).map((packed, i) => barkPackedNormal(packed, projection.relief[i].uv));
    const packedNormal = samples[0].mul(projection.weights.x).add(samples[1].mul(projection.weights.y)).add(samples[2].mul(projection.weights.z));
    material.normalNode = packedNormal.add(barkBumpNormal(albedoHeight.a.mul(0.025)).sub(normalViewGeometry)).normalize();
    material.treeSurfaceShadowNode = projection.shadow;
    material.treeBarkHeightNode = albedoHeight.a;
    material.roughnessNode = normalRoughness.b;
    material.metalness = 0;
  }
  if (vertexColor) material.colorNode = material.colorNode.mul(attribute('color', 'vec3'));
  return finishBark(material, { barkWeathering, barkGrade, sway, surface });
}

export function createStylizedTrunkMaterial({ textures, config, palette = null, sway = null, barkWeathering = null }) {
  const value = key => palette?.[key] ?? config.trees[key];
  const surface = resolveTreeBarkSettings(config.trees);
  const reliefCoords = surface.enabled && surface.parallax.enabled
    ? barkParallax(textures.height, uv().mul(config.trees.barkScale), 'r', surface.parallax) : null;
  const coords = reliefCoords?.uv ?? uv().mul(config.trees.barkScale);
  const bark = texture(textures.color, coords).rgb;
  const ao = texture(textures.ao, coords).r;
  const relief = texture(textures.height, coords).r;
  const material = surface.enabled
    ? new (foliageMaterialClass(THREE.MeshStandardNodeMaterial))({ roughness: surface.roughness })
    : new THREE.MeshLambertNodeMaterial();
  material.treeSurfaceShadowNode = reliefCoords?.shadow ?? null;
  material.treeBarkHeightNode = relief;
  material.colorNode = mix(bark, colorNode(value('barkTint')), value('barkTintStrength'))
    .mul(mix(1, ao, config.trees.barkAoStrength))
    .mul(mix(0.82, 1.18, relief.mul(config.trees.barkRelief)))
    .mul(value('barkBrightness'));
  material.normalNode = barkBumpNormal(relief.mul(0.045 * config.trees.barkRelief));
  return finishBark(material, { barkWeathering, barkGrade: config.trees.barkGrade, sway, surface });
}
