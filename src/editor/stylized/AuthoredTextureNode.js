import { texture } from 'three/tsl';

/**
 * Samples an authored glTF texture with its loader-provided texture matrix.
 * Optimized assets may move UV scale/offset into KHR_texture_transform, so an
 * explicit raw UV node is incorrect for these maps.
 */
export function authoredTexture(textureValue) {
  return texture(textureValue);
}
