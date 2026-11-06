import * as THREE from 'three/webgpu';
import { attribute, mix, normalGeometry, normalView, positionGeometry, positionView, texture, triplanarTexture, uv, vec3 } from 'three/tsl';
import { authoredTexture } from '../AuthoredTextureNode.js';
import { applyBarkWeathering } from '../barkWeathering.js';
import { gradeBark, resolveBarkGrade } from './barkGrade.js';
import { treeBarkEmission } from './foliageLight.js';
import { treeBendPosition } from './treeSway.js';
import { addTreeEmission, createTreeSurfaceMaterial } from './TreeSurfaceMaterial.js';

const colorNode = value => vec3(...new THREE.Color(value).toArray());

export function barkBumpNormal(height) {
  const dx = positionView.dFdx(), dy = positionView.dFdy();
  const tangentX = dy.cross(normalView), tangentY = normalView.cross(dx);
  const determinant = dx.dot(tangentX);
  const gradient = determinant.sign().mul(height.dFdx().mul(tangentX).add(height.dFdy().mul(tangentY)));
  return determinant.abs().mul(normalView).sub(gradient).normalize();
}

/** Both projection and blend weights stay in the undeformed prototype frame. */
export function sampleTreeBark(map, scale) {
  return triplanarTexture(texture(map), null, null, scale, positionGeometry, normalGeometry);
}

function finishBark(material, { barkWeathering, barkGrade, sway }) {
  material.colorNode = gradeBark(material.colorNode, resolveBarkGrade(barkGrade));
  applyBarkWeathering(material, { settings: barkWeathering });
  if (sway?.time) material.positionNode = treeBendPosition(sway);
  material.userData.barkLighting = true;
  return addTreeEmission(material, treeBarkEmission(material.colorNode));
}

export function createAuthoredTrunkMaterial({
  source, sourceMap = null, barkTextures = null, barkScale = 0.8,
  barkWeathering = null, barkGrade = null, sway = null, vertexColor = false,
}) {
  let material;
  if (!barkTextures) {
    material = createTreeSurfaceMaterial(source);
    material.map = sourceMap ?? source?.map ?? null;
    const base = colorNode(source?.color ?? '#ffffff');
    material.colorNode = material.map ? authoredTexture(material.map).rgb.mul(base) : base;
  } else {
    const albedoHeight = sampleTreeBark(barkTextures.albedoHeight, barkScale);
    const normalRoughness = sampleTreeBark(barkTextures.normalRoughness, barkScale);
    const decodedAlbedo = albedoHeight.rgb.mul(albedoHeight.rgb);
    material = new THREE.MeshStandardNodeMaterial({ side: source?.side ?? THREE.FrontSide });
    material.colorNode = mix(colorNode(source?.color ?? '#6b4a30'), decodedAlbedo.mul(1.35), 0.72)
      .mul(albedoHeight.a.mul(0.45).add(0.68));
    material.normalNode = barkBumpNormal(albedoHeight.a.mul(0.045));
    material.roughnessNode = normalRoughness.b;
    material.metalness = 0;
  }
  if (vertexColor) material.colorNode = material.colorNode.mul(attribute('color', 'vec3'));
  return finishBark(material, { barkWeathering, barkGrade, sway });
}

export function createStylizedTrunkMaterial({ textures, config, palette = null, sway = null, barkWeathering = null }) {
  const value = key => palette?.[key] ?? config.trees[key];
  const coords = uv().mul(config.trees.barkScale);
  const bark = texture(textures.color, coords).rgb;
  const ao = texture(textures.ao, coords).r;
  const relief = texture(textures.height, coords).r;
  const material = new THREE.MeshLambertNodeMaterial();
  material.colorNode = mix(bark, colorNode(value('barkTint')), value('barkTintStrength'))
    .mul(mix(1, ao, config.trees.barkAoStrength))
    .mul(mix(0.82, 1.18, relief.mul(config.trees.barkRelief)))
    .mul(value('barkBrightness'));
  material.normalNode = barkBumpNormal(relief.mul(0.045 * config.trees.barkRelief));
  return finishBark(material, { barkWeathering, barkGrade: config.trees.barkGrade, sway });
}
