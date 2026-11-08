import * as THREE from 'three/webgpu';
import {
  color, float, mix, mx_noise_float, normalWorld, normalize, positionWorld, texture, vec3,
} from 'three/tsl';
import { acquireRockTextures } from '../../world/FarAlpineSurface.js';
import { SNOW_GROUND_COLOR, snowDeposition } from '../snowDeposition.js';

const STONE_METERS = 7;
const ROCK_TINT = '#7f8c9e';
const SNOW = '#e8eef2';
/** AlpineRockView sinks each unit rock to put the ground here, in its own space (0.5 - BURIAL below centre). */
const GROUND_Y = -0.15;

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
  // Crags grow only on snowy or craggy ground, so they carry full snow.
  const { cover: snow, skirt } = snowDeposition({ snow: float(0.8), breakup: breakup.mul(0.9), centre: [0, 0, 0], groundY: GROUND_Y, height: 1.15 });
  material.colorNode = mix(stone.mul(color(ROCK_TINT)).mul(2), mix(color(SNOW), color(SNOW_GROUND_COLOR), skirt), snow);
  material.roughnessNode = mix(float(0.86), float(0.78), snow);
  return material;
}
