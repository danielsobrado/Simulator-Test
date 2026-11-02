import * as THREE from 'three/webgpu';
import {
  color, float, mix, mx_noise_float, normalWorld, normalize, positionWorld, smoothstep, texture, vec3,
} from 'three/tsl';
import { acquireRockTextures } from '../../world/FarAlpineSurface.js';

const STONE_METERS = 7;
const ROCK_TINT = '#7f8c9e';
const SNOW = '#e8eef2';

/** Stone projected in world space so every instance differs, with snow settled on its upper faces. */
export function createAlpineRockMaterial() {
  const maps = acquireRockTextures();
  const material = new THREE.MeshStandardNodeMaterial({ name: 'alpine-rock' });
  const p = positionWorld.toVar();
  const n = normalize(normalWorld).toVar();
  const blend = n.abs().pow(vec3(4)).toVar();
  const weights = blend.div(blend.x.add(blend.y).add(blend.z)).toVar();
  const scale = float(1 / STONE_METERS);
  const stone = texture(maps.color, p.zy.mul(scale)).rgb.mul(weights.x)
    .add(texture(maps.color, p.xz.mul(scale)).rgb.mul(weights.y))
    .add(texture(maps.color, p.xy.mul(scale)).rgb.mul(weights.z)).toVar();
  const breakup = mx_noise_float(p.mul(0.35)).toVar();
  const snow = smoothstep(0.6, 0.88, n.y.add(breakup.mul(0.28)));
  material.colorNode = mix(stone.mul(color(ROCK_TINT)).mul(2), color(SNOW), snow);
  material.roughnessNode = mix(float(0.86), float(0.78), snow);
  return material;
}
