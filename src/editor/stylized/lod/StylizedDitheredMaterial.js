import {
  attribute,
  float,
  positionLocal,
  step,
  texture,
  uv,
  vec3,
} from 'three/tsl';
import { orientedScreenDitherThreshold } from './screenDither.js';

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
  const horizontalScale = kind === 'leaf' ? morphology.x : morphology.z;
  const verticalScale = kind === 'leaf' ? morphology.y : float(1);
  material.positionNode = vec3(
    sourcePosition.x.mul(horizontalScale),
    sourcePosition.y.mul(verticalScale),
    sourcePosition.z.mul(horizontalScale),
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
  // Packed per-instance scalars; see createGeometry in StylizedLodRuntime for why these
  // share one attribute rather than taking a vertex buffer each.
  const dither = attribute('instanceDither', 'vec3');
  const signedFade = dither.x;
  const seed = dither.y;
  const colorVariation = dither.z;
  const sourceOpacity = createSourceOpacityNode(material);
  const coverage = sourceOpacity
    ? sourceOpacity.mul(signedFade.abs())
    : signedFade.abs();
  material.opacityNode = step(
    orientedScreenDitherThreshold(seed, signedFade),
    coverage,
  );
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
