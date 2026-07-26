import {
  attribute,
  dot,
  float,
  fract,
  positionLocal,
  sin,
  step,
  texture,
  uv,
  vec3,
} from 'three/tsl';

const HASH_VECTOR = vec3(12.9898, 78.233, 37.719);
const HASH_SCALE = 43758.5453;

export function createSourceOpacityNode(material) {
  if (material.opacityNode) return material.opacityNode;
  let opacity = material.map ? texture(material.map, uv()).a : null;
  if (material.alphaMap) {
    const alphaMapOpacity = texture(material.alphaMap, uv()).g;
    opacity = opacity ? opacity.mul(alphaMapOpacity) : alphaMapOpacity;
  }
  const scalarOpacity = Number.isFinite(material.opacity) ? material.opacity : 1;
  if (scalarOpacity < 1) {
    opacity = opacity ? opacity.mul(scalarOpacity) : float(scalarOpacity);
  }
  return opacity;
}

/**
 * `tinted` adds a per-instance vec3 on top of the scalar brightness variation.
 * The scalar cannot carry hue, and hue is what separates an autumn grove from a
 * green one — but only leaf parts opt in, so a tinted crown does not drag its
 * trunk with it, and untinted callers (bushes, rocks) declare no extra attribute.
 */
export function createDitheredMaterial(sourceMaterial, { tinted = false } = {}) {
  const material = sourceMaterial.clone();
  const fade = attribute('instanceLodFade', 'float');
  const seed = attribute('instanceStableSeed', 'float');
  const colorVariation = attribute('instanceColorVariation', 'float');
  const seededPosition = positionLocal.add(vec3(seed, seed.mul(1.37), seed.mul(2.11)));
  const threshold = fract(sin(dot(seededPosition, HASH_VECTOR)).mul(HASH_SCALE));
  const sourceOpacity = createSourceOpacityNode(material);
  const coverage = sourceOpacity ? sourceOpacity.mul(fade) : fade;
  material.opacityNode = step(threshold, coverage);
  if (material.colorNode) {
    const variation = tinted
      ? attribute('instanceLeafTint', 'vec3').mul(colorVariation)
      : colorVariation;
    material.colorNode = material.colorNode.mul(variation);
  }
  material.alphaTest = Math.max(0.5, sourceMaterial.alphaTest ?? 0);
  material.transparent = false;
  material.depthWrite = true;
  return material;
}
