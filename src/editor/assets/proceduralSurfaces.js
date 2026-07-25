import * as THREE from 'three';
import { SURFACE_PROPERTIES, createSurfaceTexturePixels } from './proceduralTexturePixels.js';

/**
 * Shared procedural surface textures and materials.
 *
 * Textures are synthesized once per surface kind and reused by every part that
 * asks for it, so the whole object catalog costs a single small texture set per
 * material rather than one per model. Everything handed out here is flagged
 * `userData.sharedSurface` so per-object teardown never disposes it.
 */

const TEXTURE_SIZE = 128;
const TEXTURE_ANISOTROPY = 8;

const textureCache = new Map();
const materialCache = new Map();

function createTexture(pixels, size, colorSpace) {
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = TEXTURE_ANISOTROPY;
  if (colorSpace) {
    texture.colorSpace = colorSpace;
  }
  texture.userData.sharedSurface = true;
  texture.needsUpdate = true;
  return texture;
}

export function getSurfaceTextures(kind) {
  const cached = textureCache.get(kind);
  if (cached) {
    return cached;
  }

  const pixels = createSurfaceTexturePixels(kind, { size: TEXTURE_SIZE });
  const textures = Object.freeze({
    map: createTexture(pixels.color, pixels.size, THREE.SRGBColorSpace),
    normalMap: createTexture(pixels.normal, pixels.size, null),
    roughnessMap: createTexture(pixels.roughness, pixels.size, null),
  });
  textureCache.set(kind, textures);
  return textures;
}

/**
 * Returns the shared material for a surface kind, optionally tinted. Roughness
 * is baked into the map, so the scalar stays at 1 and lets the texture drive it.
 */
export function getSurfaceMaterial(kind, tint = null) {
  const properties = SURFACE_PROPERTIES[kind];
  if (!properties) {
    throw new Error(`Unknown procedural surface kind: ${kind}.`);
  }

  const color = tint ?? properties.color;
  const cacheKey = `${kind}|${color}`;
  const cached = materialCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const textures = getSurfaceTextures(kind);
  const material = new THREE.MeshStandardMaterial({
    color,
    map: textures.map,
    normalMap: textures.normalMap,
    roughnessMap: textures.roughnessMap,
    roughness: 1,
    metalness: properties.metalness,
  });
  material.normalScale.set(properties.normalStrength, properties.normalStrength);
  if (properties.emissive) {
    material.emissive = new THREE.Color(properties.emissive);
    material.emissiveIntensity = properties.emissiveIntensity;
  }
  material.userData.sharedSurface = true;

  materialCache.set(cacheKey, material);
  return material;
}

export function surfaceDensity(kind) {
  const properties = SURFACE_PROPERTIES[kind];
  if (!properties) {
    throw new Error(`Unknown procedural surface kind: ${kind}.`);
  }
  return properties.density;
}

/**
 * Rewrites UVs by projecting positions along each vertex's dominant normal
 * axis. Axis-aligned faces stay undistorted and every part gets the same texel
 * density no matter how large it is.
 */
export function applyProjectedUv(geometry, density) {
  if (!geometry.attributes.normal) {
    geometry.computeVertexNormals();
  }
  const position = geometry.attributes.position;
  const normal = geometry.attributes.normal;
  const uv = new Float32Array(position.count * 2);

  for (let index = 0; index < position.count; index += 1) {
    const normalX = Math.abs(normal.getX(index));
    const normalY = Math.abs(normal.getY(index));
    const normalZ = Math.abs(normal.getZ(index));

    let u;
    let v;
    if (normalX >= normalY && normalX >= normalZ) {
      u = position.getZ(index);
      v = position.getY(index);
    } else if (normalY >= normalX && normalY >= normalZ) {
      u = position.getX(index);
      v = position.getZ(index);
    } else {
      u = position.getX(index);
      v = position.getY(index);
    }

    uv[index * 2] = u * density;
    uv[index * 2 + 1] = v * density;
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

/**
 * Scales the native cylindrical UVs of a lathe-style geometry. The horizontal
 * repeat is rounded to a whole number so the wrap-around seam stays continuous.
 */
export function applyCylindricalUv(geometry, density, radius, height) {
  const uv = geometry.attributes.uv;
  if (!uv) {
    return applyProjectedUv(geometry, density);
  }

  const repeatAround = Math.max(1, Math.round(2 * Math.PI * radius * density));
  const repeatUp = Math.max(0.25, height * density);
  for (let index = 0; index < uv.count; index += 1) {
    uv.setXY(index, uv.getX(index) * repeatAround, uv.getY(index) * repeatUp);
  }
  uv.needsUpdate = true;
  return geometry;
}

/** Releases every cached texture and material. Intended for teardown and tests. */
export function disposeProceduralSurfaces() {
  for (const material of materialCache.values()) {
    material.dispose();
  }
  materialCache.clear();
  for (const textures of textureCache.values()) {
    textures.map.dispose();
    textures.normalMap.dispose();
    textures.roughnessMap.dispose();
  }
  textureCache.clear();
}
