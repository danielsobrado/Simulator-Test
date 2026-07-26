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

/**
 * Re-points foliage normals outward from the crown's centre instead of leaving
 * them perpendicular to each triangle.
 *
 * `facet` gives every triangle its own flat normal, which is right for stone and
 * wrong for leaves: it lights each face of each lobe separately, so a canopy made
 * of merged lobes reads as a pile of faceted rocks rather than one soft mass.
 * Pointing normals outward from the centre is the standard stylized-foliage trick
 * — the crown then takes a single smooth light-to-dark gradient across all its
 * lobes, and the tiers read as one volume.
 *
 * Normalising the offset by the crown's half-extents first makes this an ellipsoid
 * rather than a sphere, so a flattened tropical plate is not lit as if it were
 * round. `strength` below 1 keeps some of the facet break-up.
 *
 * Positions are untouched — this is purely a shading change.
 */
export function spherifyNormals(geometry, { strength = 1, center = null } = {}) {
  if (strength <= 0) return geometry;
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const originX = center?.x ?? (box.min.x + box.max.x) * 0.5;
  const originY = center?.y ?? (box.min.y + box.max.y) * 0.5;
  const originZ = center?.z ?? (box.min.z + box.max.z) * 0.5;
  const halfX = Math.max(1e-4, (box.max.x - box.min.x) * 0.5);
  const halfY = Math.max(1e-4, (box.max.y - box.min.y) * 0.5);
  const halfZ = Math.max(1e-4, (box.max.z - box.min.z) * 0.5);
  const positions = geometry.getAttribute('position');
  const normals = geometry.getAttribute('normal');
  const blend = Math.min(1, strength);
  for (let index = 0; index < positions.count; index += 1) {
    const offsetX = (positions.getX(index) - originX) / halfX;
    const offsetY = (positions.getY(index) - originY) / halfY;
    const offsetZ = (positions.getZ(index) - originZ) / halfZ;
    const length = Math.hypot(offsetX, offsetY, offsetZ);
    // A vertex exactly at the centre has no outward direction; keep its face normal.
    if (length < 1e-6) continue;
    const mixedX = normals.getX(index) * (1 - blend) + (offsetX / length) * blend;
    const mixedY = normals.getY(index) * (1 - blend) + (offsetY / length) * blend;
    const mixedZ = normals.getZ(index) * (1 - blend) + (offsetZ / length) * blend;
    const mixedLength = Math.hypot(mixedX, mixedY, mixedZ);
    if (mixedLength < 1e-6) continue;
    normals.setXYZ(
      index,
      mixedX / mixedLength,
      mixedY / mixedLength,
      mixedZ / mixedLength,
    );
  }
  normals.needsUpdate = true;
  return geometry;
}
