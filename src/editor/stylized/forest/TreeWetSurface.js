import { float, materialNormal, materialRoughness, mix, normalViewGeometry } from 'three/tsl';

/** Preserve every dry authored channel; only wet exposed areas gain a film. */
export function wetSurfaceRoughness(dry, wetness, settings) {
  return mix(dry, dry.min(settings.wetRoughness), wetness.mul(settings.wetStrength).clamp(0, 1));
}

export function applyTreeBarkWetSurface(material, settings) {
  if (!settings.enabled) return material;
  const height = material.treeBarkHeightNode ?? float(0.5);
  const wet = (material.treeWetnessNode ?? float(0)).mul(height.clamp(0, 1).oneMinus().mul(0.45).add(0.55));
  material.roughnessNode = wetSurfaceRoughness(material.roughnessNode ?? materialRoughness, wet, settings);
  // A thin film softens high-frequency normals, reducing sparkling wet fissures.
  material.normalNode = mix(material.normalNode ?? materialNormal, normalViewGeometry,
    wet.mul(settings.wetStrength * 0.12)).normalize();
  return material;
}
