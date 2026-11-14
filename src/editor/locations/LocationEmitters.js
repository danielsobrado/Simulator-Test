import * as THREE from 'three/webgpu';
import {
  color, float, fract, hash, instancedBufferAttribute, instanceIndex, mix, smoothstep, time, uniform, vec2, vec3,
} from 'three/tsl';
import { softDisc } from './LocationEffects.js';
import { locationLight } from './materials/LocationShading.js';

/**
 * Particles shed from fixed points: hearth smoke from a vent, drips off
 * icicles above a warm door, snow sifting from a lip. One instanced draw per
 * kind; a particle's whole life is a function of time, so nothing is simulated.
 *
 * @param {object} profile an `atmosphereProfiles.*.emitters` entry:
 *   `perPoint` particles each, `life` seconds, `velocity` m/s, `gravity` m/s², `spread` metres of
 *   wander by the end of life, `size` metres [born, dying], `color`, `opacity`, `additive`,
 *   `ambientGain` (how much the place's ambient light shows on them) and `glow` (their own light)
 * @param {Array<{ x: number, y: number, z: number }>} points
 * @param {number} scale quality multiplier on the particle count
 */
export function createEmitters(profile, points, scale = 1) {
  const perPoint = Math.max(1, Math.round(profile.perPoint * scale));
  const count = points.length * perPoint;
  const origin = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const point = points[index % points.length];
    origin.set([point.x, point.y, point.z], index * 3);
  }
  const index = instanceIndex.toFloat();
  const seed = vec3(hash(index.mul(3)), hash(index.mul(3).add(1)), hash(index.mul(3).add(2)));
  const age = fract(time.div(profile.life).add(hash(index.add(977))));
  const seconds = age.mul(profile.life);
  const wander = seed.sub(0.5).mul(vec3(1, 0.3, 1)).mul(age.mul(0.85).add(0.15)).mul(profile.spread);
  const material = new THREE.SpriteNodeMaterial({
    name: 'location-emitters', depthWrite: false, fog: true,
    blending: profile.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  material.positionNode = instancedBufferAttribute(new THREE.InstancedBufferAttribute(origin, 3)).add(wander)
    .add(vec3(...profile.velocity).mul(seconds)).sub(vec3(0, 0.5 * profile.gravity, 0).mul(seconds.mul(seconds)));
  material.scaleNode = vec2(mix(float(profile.size[0]), float(profile.size[1]), age));
  material.colorNode = color(profile.color).mul(locationLight.ambientUp.mul(profile.ambientGain).add(profile.glow));
  material.opacityNode = softDisc(1.5).mul(smoothstep(0, 0.12, age)).mul(age.oneMinus()).mul(uniform(profile.opacity));
  const sprite = new THREE.Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.renderOrder = 3;
  return sprite;
}
