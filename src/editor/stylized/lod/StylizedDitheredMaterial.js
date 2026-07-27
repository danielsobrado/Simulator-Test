import {
  attribute,
  dot,
  float,
  fract,
  positionLocal,
  positionWorld,
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

function applyMorphology(material, sourceMaterial, kind) {
  if (kind !== 'leaf' && kind !== 'trunk') return;
  const morphology = attribute('instanceMorphology', 'vec3');
  const sourcePosition = sourceMaterial.positionNode ?? positionLocal;
  const scaleX = kind === 'leaf' ? morphology.x : morphology.z;
  const scaleZ = kind === 'leaf' ? morphology.y : morphology.z;
  material.positionNode = vec3(
    sourcePosition.x.mul(scaleX),
    sourcePosition.y,
    sourcePosition.z.mul(scaleZ),
  );
}

/**
 * `tinted` adds a per-instance vec3 on top of the scalar brightness variation.
 * `kind` selects the per-instance tree morphology transform. Other scatter layers
 * keep the identity morphology written by the shared instance runtime.
 */
export function createDitheredMaterial(sourceMaterial, {
  tinted = false,
  kind = null,
} = {}) {
  const material = sourceMaterial.clone();
  const fade = attribute('instanceLodFade', 'float');
  const seed = attribute('instanceStableSeed', 'float');
  const colorVariation = attribute('instanceColorVariation', 'float');
  const seededPosition = positionWorld.mul(1.71).add(vec3(
    seed.mul(19.19),
    seed.mul(31.37),
    seed.mul(47.11),
  ));
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
  applyMorphology(material, sourceMaterial, kind);
  material.alphaTest = Math.max(0.5, sourceMaterial.alphaTest ?? 0);
  material.transparent = false;
  material.depthWrite = true;
  return material;
}
