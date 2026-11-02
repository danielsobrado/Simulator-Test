import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

const DETAIL = 22;
/** Each kind: flat top height, how far the crown tapers, ridge depth. */
const KINDS = Object.freeze([
  Object.freeze({ top: 0.42, taper: 0.1, ridge: 0.22, seed: 11 }), // tabular slab
  Object.freeze({ top: 0.95, taper: 0.75, ridge: 0.42, seed: 47 }), // pinnacle
  Object.freeze({ top: 0.68, taper: 0.4, ridge: 0.34, seed: 83 }), // domed block
]);
const BELOW_WATER = 0.45;

function lattice(x, y, z, seed) {
  const n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7 + seed * 53.3) * 43758.5453;
  return n - Math.floor(n);
}

function valueNoise(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  const edge = (a, b, c) => lattice(ix + a, iy + b, iz + c, seed);
  const row = (b, c) => edge(0, b, c) + (edge(1, b, c) - edge(0, b, c)) * u;
  const plane = (c) => row(0, c) + (row(1, c) - row(0, c)) * v;
  return plane(0) + (plane(1) - plane(0)) * w;
}

/** Sharp crests, for the shattered faces of calved ice. */
export function ridgedNoise3(x, y, z, seed) {
  let sum = 0, amplitude = 0.5, frequency = 1;
  for (let octave = 0; octave < 4; octave += 1) {
    const n = 1 - Math.abs(valueNoise(x * frequency, y * frequency, z * frequency, seed + octave) * 2 - 1);
    sum += n * n * amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return sum;
}

/**
 * A unit-radius berg, sea level at y = 0: cliffs from a shattered sphere, a flat
 * or peaked crown, and a stubbier keel below the water. Generated, not authored,
 * so it costs nothing in worlds without cold seas.
 *
 * @param {number} kind index into KINDS
 */
export function createIcebergGeometry(kind) {
  const { top, taper, ridge, seed } = KINDS[kind];
  const sphere = new THREE.IcosahedronGeometry(1, DETAIL);
  sphere.deleteAttribute('uv');
  sphere.deleteAttribute('normal');
  const geometry = mergeVertices(sphere, 1e-4);
  sphere.dispose();
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 1) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const crack = ridgedNoise3(x * 1.9, y * 1.9, z * 1.9, seed);
    const radius = 1 + (crack - 0.45) * ridge;
    const waist = y > 0 ? 1 - taper * y * y : 1;
    const crown = Math.min(y * radius, top + (crack - 0.45) * 0.12);
    positions.setXYZ(i, x * radius * waist, y > 0 ? crown : y * radius * BELOW_WATER, z * radius * waist);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
