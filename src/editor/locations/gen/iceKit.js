import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { fbm3 } from './noise.js';

/** World-space natural forms too small for the volume: icicles, boulders, fallen ice. */

const ICICLE_SIDES = 6;
/** Share of an icicle's length taken by the flare where it grew out of the roof. */
const ROOT = 0.16;

/**
 * An icicle hanging from `top`. It widens into the surface it grew from, so it
 * reads as part of the roof rather than a cone stuck to it; drip bulges ring
 * its length and `lean` (metres at the tip) is the wind it froze in.
 *
 * @param {{x:number,y:number,z:number}} top where it meets the roof or eave
 * @param {number} length metres
 * @param {number} radius metres, at the base of the flare
 * @param {{ lean?: {x:number,z:number}, phase?: number }} [options]
 */
export function icicle(top, length, radius, { lean = { x: 0, z: 0 }, phase = 0 } = {}) {
  const rings = Math.max(5, Math.round(length / 0.22));
  const profile = [];
  for (let ring = 0; ring <= rings; ring += 1) {
    const t = ring / rings;
    const flare = t > 1 - ROOT ? 1 + 0.9 * ((t - 1 + ROOT) / ROOT) ** 2 : 1;
    const bulge = 1 + 0.16 * Math.sin(t * rings * 1.9 + phase) * (1 - t);
    profile.push(new THREE.Vector2(Math.max(0.004, radius * t ** 0.75 * bulge * flare), -length * (1 - t)));
  }
  const geometry = new THREE.LatheGeometry(profile, ICICLE_SIDES);
  const position = geometry.attributes.position;
  for (let v = 0; v < position.count; v += 1) {
    const hang = (-position.getY(v) / length) ** 2;
    position.setX(v, position.getX(v) + lean.x * hang);
    position.setZ(v, position.getZ(v) + lean.z * hang);
  }
  geometry.computeVertexNormals();
  return geometry.translate(top.x, top.y, top.z);
}

/**
 * A boulder or a block of fallen ice resting on `at`: a sphere pushed about by
 * noise, flattened underneath. `blocky` (0..1) squares it toward a broken slab.
 */
export function boulder(at, rx, ry, rz, { seed = 1, blocky = 0, yaw = 0 } = {}) {
  const geometry = mergeVertices(new THREE.IcosahedronGeometry(1, 3).deleteAttribute('uv').deleteAttribute('normal'));
  const position = geometry.attributes.position;
  for (let v = 0; v < position.count; v += 1) {
    let x = position.getX(v), y = position.getY(v), z = position.getZ(v);
    // Pushing each axis toward ±1 turns the sphere into a rounded box.
    const square = (value) => value + (Math.sign(value) * Math.min(1, Math.abs(value) * 1.9) - value) * blocky;
    x = square(x); y = square(y); z = square(z);
    const swell = 0.72 + 0.56 * fbm3(x * 1.3 + seed, y * 1.3, z * 1.3, seed, 3);
    position.setXYZ(v, x * rx * swell, Math.max(-0.35, y) * ry * swell + ry * 0.35, z * rz * swell);
  }
  geometry.computeVertexNormals();
  if (yaw) geometry.rotateY(yaw);
  return geometry.translate(at.x, at.y, at.z);
}
