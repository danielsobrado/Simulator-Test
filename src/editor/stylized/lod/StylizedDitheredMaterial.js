import {
  attribute,
  dot,
  fract,
  positionLocal,
  sin,
  step,
  vec3,
} from 'three/tsl';

const HASH_VECTOR = vec3(12.9898, 78.233, 37.719);
const HASH_SCALE = 43758.5453;

export function createDitheredMaterial(sourceMaterial) {
  const material = sourceMaterial.clone();
  const fade = attribute('instanceLodFade', 'float');
  const seed = attribute('instanceStableSeed', 'float');
  const colorVariation = attribute('instanceColorVariation', 'float');
  const seededPosition = positionLocal.add(vec3(seed, seed.mul(1.37), seed.mul(2.11)));
  const threshold = fract(sin(dot(seededPosition, HASH_VECTOR)).mul(HASH_SCALE));
  const coverage = material.opacityNode
    ? material.opacityNode.mul(fade)
    : fade;
  material.opacityNode = step(threshold, coverage);
  if (material.colorNode) material.colorNode = material.colorNode.mul(colorVariation);
  material.alphaTest = Math.max(0.5, sourceMaterial.alphaTest ?? 0);
  material.transparent = false;
  material.depthWrite = true;
  return material;
}
