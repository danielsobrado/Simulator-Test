import { Color } from 'three/webgpu';
import { attribute, float, materialAO, materialRoughness, mix, normalWorld, positionGeometry, positionView, uv, vec3 } from 'three/tsl';
import { surfaceWetnessUniform } from '../../weather/surfaceWetness.js';
import { resolveTreeFoliageSettings } from './treeSurfaceSettings.js';
import { setRuntimeUserData } from '../../../render/materials/runtimeUserData.js';

/** Occlusion has a floor, retaining readable crown interiors and donor AO. */
export function canopyVisibilityNode(visibility, settings) {
  return mix(float(1), visibility.clamp(settings.minimumVisibility, 1), settings.occlusionStrength);
}

/** Thickness is an optical estimate when the asset has no thickness texture. */
export function leafThicknessNode(settings, visibility, alpha = float(1), luminance = float(0.5)) {
  return float(settings.thickness).mul(mix(0.7, 1.2, visibility.oneMinus()))
    .mul(mix(0.7, 1, alpha.clamp(0, 1)))
    .mul(mix(1.15, 0.85, luminance.clamp(0, 1))).clamp(0.02, 1);
}

export function configureTreeFoliageSurface(material, {
  settings = resolveTreeFoliageSettings(), visibility = float(1), alpha = float(1),
  color = vec3(0.5), bounds = null,
} = {}) {
  if (!settings.enabled) return { visibility: float(1) };
  const sky = canopyVisibilityNode(visibility, settings);
  material.foliageTransmissionNode = float(settings.transmission);
  material.foliageThicknessNode = leafThicknessNode(settings, visibility, alpha, color.dot(vec3(0.2126, 0.7152, 0.0722)));
  material.foliageTransmissionColorNode = vec3(...new Color(settings.transmissionColor).toArray());
  material.foliageAbsorptionNode = float(settings.absorption);
  material.foliageVisibilityNode = sky;
  material.foliageWetnessNode = surfaceWetnessUniform.mul(settings.wetStrength).mul(sky)
    .mul(normalWorld.y.abs().mul(0.35).add(0.65).clamp(0, 1));
  material.foliageNeedleSpecularNode = float(settings.needleSpecular);
  material.foliageWetRoughnessNode = float(settings.wetRoughness);
  if (material.isMeshStandardNodeMaterial) {
    const dry = material.roughnessNode ?? materialRoughness;
    material.foliageDryRoughnessNode = dry;
    material.roughnessNode = mix(dry, dry.min(settings.wetRoughness), material.foliageWetnessNode);
  }
  if (settings.needleSpecular > 0 && bounds) {
    const coords = uv(material.map?.channel ?? 0);
    material.foliageNeedleDirectionNode = positionView.dFdy().mul(coords.dFdx().x)
      .sub(positionView.dFdx().mul(coords.dFdy().x)).add(vec3(0, 0.00001, 0)).normalize();
  }
  material.aoNode = (material.aoNode ?? materialAO).mul(sky);
  if (bounds && settings.normalBlend > 0) {
    const center = vec3(...bounds.min.map((value, i) => (value + bounds.max[i]) / 2));
    const half = vec3(...bounds.min.map((value, i) => Math.max(0.05, (bounds.max[i] - value) / 2)));
    // Normal adjustment happens before instancing; authored geometry stays intact.
    const shape = positionGeometry.sub(center).div(half);
    material.foliageShapeNormalNode = shape.div(shape.length().max(0.00001));
    material.foliageNormalBlendNode = float(settings.normalBlend);
  }
  material.userData.treeFoliageSurface = settings;
  setRuntimeUserData(material, 'canopyVisibilityNode', visibility);
  return { visibility: sky };
}

/** LOD snow must mask both the film lobe and the PBR roughness adjustment. */
export function applyTreeFoliageSnowSurface(material, cap) {
  if (material.foliageThicknessNode) material.foliageSnowNode = cap;
  if (material.foliageWetnessNode) material.foliageWetnessNode = material.foliageWetnessNode.mul(cap.oneMinus());
  if (material.foliageNeedleSpecularNode) material.foliageNeedleSpecularNode = material.foliageNeedleSpecularNode.mul(cap.oneMinus());
  if (material.foliageDryRoughnessNode) {
    const dry = material.foliageDryRoughnessNode;
    const wet = mix(dry, dry.min(material.foliageWetRoughnessNode), material.foliageWetnessNode);
    material.roughnessNode = mix(wet, float(0.95), cap);
  }
}

export function treeGeometryVisibility(hasCanopyVisibility) {
  return hasCanopyVisibility ? attribute('canopyVisibility', 'float') : float(1);
}
