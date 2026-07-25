import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hash32 } from '../scatterMath.js';

/**
 * Primitives shared by the procedural tree and bush prototype builders. All
 * output is de-indexed: it lets geometries of different primitive types merge,
 * and it gives the hard-edged facets the stylized look depends on.
 */

/** Deterministic unit value from a string key and a channel. */
export function unitRandom(key, channel) {
  let value = Math.imul(channel + 1, 0x9e3779b1);
  for (let index = 0; index < key.length; index += 1) {
    value = Math.imul(value ^ key.charCodeAt(index), 0x85ebca6b);
  }
  return hash32(value) / 0xffffffff;
}

export function facet(geometry) {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  if (flat !== geometry) geometry.dispose();
  flat.computeVertexNormals();
  return flat;
}

export function mergeParts(geometries) {
  const flattened = geometries.map((geometry) => facet(geometry));
  if (flattened.length === 1) return flattened[0];
  const merged = mergeGeometries(flattened, false);
  flattened.forEach((geometry) => geometry.dispose());
  if (!merged) {
    throw new Error('Procedural geometry parts could not be merged.');
  }
  return merged;
}

export function finalizeGeometry(geometry) {
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
