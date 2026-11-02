import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { ridgedNoise3 } from '../ice/icebergGeometry.js';

const DETAIL = 10;
/** Each kind's proportions and how shattered it is. */
const KINDS = Object.freeze([
  Object.freeze({ size: [1, 0.8, 0.7], shatter: 0.55, seed: 19 }), // blocky outcrop
  Object.freeze({ size: [0.6, 1.3, 0.55], shatter: 0.7, seed: 61 }), // standing fin
  Object.freeze({ size: [1.2, 0.55, 0.8], shatter: 0.45, seed: 101 }), // tilted slab
  Object.freeze({ size: [0.85, 1, 0.9], shatter: 0.8, seed: 149 }), // broken knuckle
]);

/** A unit rock on y = 0 with flat fractured planes, buried a little by its placement. */
export function createAlpineRockGeometry(kind) {
  const { size, shatter, seed } = KINDS[kind];
  const sphere = new THREE.IcosahedronGeometry(1, DETAIL);
  sphere.deleteAttribute('uv');
  sphere.deleteAttribute('normal');
  const geometry = mergeVertices(sphere, 1e-4);
  sphere.dispose();
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const crack = ridgedNoise3(x * 1.6, y * 1.6, z * 1.6, seed);
    const radius = 1 + (crack - 0.42) * shatter;
    positions.setXYZ(i, x * radius * size[0], y * radius * size[1], z * radius * size[2]);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
