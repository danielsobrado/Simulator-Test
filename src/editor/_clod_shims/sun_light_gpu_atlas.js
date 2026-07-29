import * as THREE from 'three';

const VISIBILITY_LIT = 255;

function createFallbackTexture() {
  const texture = new THREE.DataTexture(
    new Uint8Array([VISIBILITY_LIT]),
    1,
    1,
    THREE.RedFormat,
    THREE.UnsignedByteType,
  );
  texture.name = 'simulator-sun-light-visibility-fallback';
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

const state = Object.freeze({
  texture: createFallbackTexture(),
  version: 0,
  valid: 0,
  originX: 0,
  originZ: 0,
  worldSize: 1,
});

export function getSunLightGpuAtlas() {
  return state;
}
