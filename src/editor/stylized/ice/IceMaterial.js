import * as THREE from 'three/webgpu';
import {
  cameraPosition, clamp, color, dot, float, max, mix, mx_fractal_noise_float, mx_noise_float, normalWorld, normalize,
  positionGeometry, positionWorld, smoothstep, uniform,
} from 'three/tsl';
import { skyLightUniforms } from '../sky/skyLight.js';

const DEEP = '#0b64b8';
const CLEAR = '#4cc4ee';
const FROST = '#e6f6fc';
const SNOW = '#f2f7fa';
/** How far the view ray reaches into the body: reading noise there makes the veins read as depth. */
const INNER_REACH = 1;
const NOISE_SCALE = 3.2;

/**
 * Frosted glacial ice. Opaque, because a viewport refraction would charge the
 * whole frame (CLAUDE.md, QA and performance): depth comes from sampling along
 * the view ray, and the glow from a blue lobe around the sun.
 *
 * @param {import('three').Vector3} sunDirection the live sun, turned in place
 * @param {number} seaLevel world metres
 */
export function createIceMaterial({ sunDirection, seaLevel }) {
  const material = new THREE.MeshStandardNodeMaterial({ name: 'frosted-ice' });
  const view = normalize(cameraPosition.sub(positionWorld)).toVar();
  const normal = normalize(normalWorld).toVar();
  const local = positionGeometry.mul(NOISE_SCALE).toVar();
  const sun = normalize(uniform(sunDirection));
  const rim = float(1).sub(clamp(dot(normal, view), 0, 1)).pow(2.5);
  const veins = mx_fractal_noise_float(local.sub(view.mul(INNER_REACH)), 3, 2.1, 0.5).mul(0.9).add(0.5).toVar();
  const clouds = mx_noise_float(local.mul(0.55)).mul(0.5).add(0.5).toVar();
  const body = mix(color(DEEP), color(CLEAR), smoothstep(0.25, 0.72, veins)).toVar();
  const frost = smoothstep(0.42, 0.78, clouds.add(rim.mul(0.45))).toVar();
  const cap = smoothstep(0.62, 0.86, normal.y.add(clouds.sub(0.5).mul(0.5))).toVar();
  const ice = mix(body, color(FROST), frost.mul(0.8));
  const wet = smoothstep(seaLevel + 1.6, seaLevel + 0.3, positionWorld.y).mul(cap.oneMinus());
  material.colorNode = mix(mix(ice, ice.mul(color(CLEAR)), wet), color(SNOW), cap);
  material.roughnessNode = mix(mix(float(0.14), float(0.62), frost), float(0.82), cap);
  // Ice carries blue through itself, most of all toward a backlighting sun.
  const through = max(dot(view, sun.negate()), 0).pow(3).mul(0.9).add(0.14);
  material.emissiveNode = body.mul(through).mul(cap.oneMinus()).mul(frost.mul(0.6).oneMinus())
    .mul(skyLightUniforms.brightness);
  return material;
}
