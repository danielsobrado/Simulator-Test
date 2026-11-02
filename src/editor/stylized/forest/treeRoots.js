import * as THREE from 'three';
import { unitRandom } from './proceduralGeometry.js';

/**
 * Buttress roots grown onto an authored trunk at load, so a bole spreads into the
 * ground instead of standing on it. Sized from the trunk itself: authored stems run
 * from a few centimetres to over a metre, so no one radius suits a whole pool.
 * Each root is 40 triangles. Built once per prototype, never during a chunk build.
 */
const ROOT_RINGS = 5;
const ROOT_SIDES = 5;
const MIN_STEM_RADIUS = 0.06;

/** Axis and radius of the stem through a band above the base, or null if it has none. */
export function measureStem(geometry) {
  const position = geometry.getAttribute('position');
  if (!position) return null;
  geometry.computeBoundingBox();
  const minY = geometry.boundingBox.min.y;
  const height = geometry.boundingBox.max.y - minY;
  const low = minY + Math.min(0.9, height * 0.06);
  const high = low + Math.min(0.9, height * 0.08);
  const band = [];
  for (let index = 0; index < position.count; index += 1) {
    const y = position.getY(index);
    if (y >= low && y <= high) band.push([position.getX(index), position.getZ(index)]);
  }
  if (band.length < 3) return null;
  const centreX = band.reduce((sum, [x]) => sum + x, 0) / band.length;
  const centreZ = band.reduce((sum, [, z]) => sum + z, 0) / band.length;
  const radii = band.map(([x, z]) => Math.hypot(x - centreX, z - centreZ)).sort((a, b) => a - b);
  // The median, so a low limb caught in the band does not inflate the stem.
  const radius = radii[Math.floor(radii.length / 2)];
  return radius >= MIN_STEM_RADIUS ? { x: centreX, z: centreZ, radius, minY } : null;
}

function uvRange(geometry) {
  const uv = geometry.getAttribute('uv');
  if (!uv) return null;
  let minU = Infinity;
  let maxU = -Infinity;
  let minV = Infinity;
  let maxV = -Infinity;
  for (let index = 0; index < Math.min(uv.count, 256); index += 1) {
    minU = Math.min(minU, uv.getX(index));
    maxU = Math.max(maxU, uv.getX(index));
    minV = Math.min(minV, uv.getY(index));
    maxV = Math.max(maxV, uv.getY(index));
  }
  return { minU, spanU: maxU - minU, minV, spanV: maxV - minV };
}

/**
 * @param {THREE.BufferGeometry} trunk the prototype's bark
 * @param {string} seed stable per prototype, so a tree's roots never change
 * @param {number} [count] roots round the stem
 * @returns {THREE.BufferGeometry | null} in the trunk's frame, or null with no stem
 */
export function createTreeRootGeometry(trunk, seed, count = 7) {
  const stem = measureStem(trunk);
  if (!stem) return null;
  const range = uvRange(trunk);
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (let root = 0; root < count; root += 1) {
    const channel = 300 + root * 7;
    const angle = ((root + (unitRandom(seed, channel) - 0.5) * 0.6) / count) * Math.PI * 2;
    const reach = stem.radius * (2.6 + unitRandom(seed, channel + 1) * 2.6);
    const rise = stem.radius * (1.1 + unitRandom(seed, channel + 2) * 1.2);
    const thickness = stem.radius * (0.3 + unitRandom(seed, channel + 3) * 0.2);
    const wander = (unitRandom(seed, channel + 4) - 0.5) * 0.8;
    const first = positions.length / 3;
    for (let ring = 0; ring < ROOT_RINGS; ring += 1) {
      const t = ring / (ROOT_RINGS - 1);
      const heading = angle + wander * t * t;
      const out = stem.radius * 0.72 + reach * t;
      const cx = stem.x + Math.cos(heading) * out;
      const cz = stem.z + Math.sin(heading) * out;
      // Falls fast off the bole, then creeps along the ground into the soil.
      const cy = stem.minY + rise * (1 - t) ** 2.4 - thickness * 0.2 * t;
      const radius = thickness * (1 - t * 0.92);
      for (let side = 0; side < ROOT_SIDES; side += 1) {
        const around = (side / ROOT_SIDES) * Math.PI * 2;
        const across = Math.cos(around);
        const up = Math.sin(around);
        const nx = -Math.sin(heading) * across;
        const nz = Math.cos(heading) * across;
        positions.push(cx + nx * radius, cy + up * radius * 1.25, cz + nz * radius);
        normals.push(nx, up, nz);
        uvs.push(
          range ? range.minU + (side / ROOT_SIDES) * range.spanU * 0.3 : 0,
          range ? range.minV + t * range.spanV * 0.4 : t,
        );
      }
    }
    for (let ring = 0; ring + 1 < ROOT_RINGS; ring += 1) {
      for (let side = 0; side < ROOT_SIDES; side += 1) {
        const next = (side + 1) % ROOT_SIDES;
        const a = first + ring * ROOT_SIDES + side;
        const b = first + ring * ROOT_SIDES + next;
        const c = a + ROOT_SIDES;
        const d = b + ROOT_SIDES;
        indices.push(a, b, c, b, d, c);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}
