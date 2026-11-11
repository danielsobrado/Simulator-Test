import * as THREE from 'three/webgpu';

let loader = null;

/**
 * Loads a PNG whose alpha is data, not coverage (the scanned bark pair keeps
 * height there). An <img> decode goes through premultiplied alpha, so texels
 * with a low alpha come back with their RGB quantised or zeroed: the bark's
 * normal and roughness were lost in every crevice, which drew near trunks as
 * black-and-white speckle (2026-11-11 captures).
 */
export async function loadStraightAlphaTexture(url) {
  loader ??= new THREE.ImageBitmapLoader().setOptions({
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none',
    imageOrientation: 'flipY',
  });
  const texture = new THREE.Texture(await loader.loadAsync(url));
  texture.flipY = false; // the bitmap is already flipped
  texture.needsUpdate = true;
  return texture;
}
