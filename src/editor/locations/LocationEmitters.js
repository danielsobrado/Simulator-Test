import * as THREE from 'three/webgpu';
import {
  cameraPosition, clamp, color, float, fract, hash, instancedBufferAttribute, instanceIndex, length, mix, pow,
  smoothstep, time, uniform, vec2, vec3,
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

/** Puffs alive at once; older ones are reused. */
const BREATH_PUFFS = 8;
/** Seconds between the puffs of one breath. */
const BREATH_GAP = 0.12;
/** Where a puff starts, metres ahead of and below the eye. */
const BREATH_AHEAD = 0.75, BREATH_BELOW = 0.16;
/** The fastest the walker is taken to be moving when a puff inherits their speed: a teleport is not a sprint. */
const BREATH_MAX_SPEED = 8;

/**
 * The walker's breath in cold air. The view is first person, so it is the only
 * body there is: a few puffs leave from below the eye every few seconds, carry
 * on with the walker's own speed, spread and thin out. Each is placed once on
 * the CPU when it is breathed and then runs on the GPU like any emitter.
 *
 * @param {object} profile an `atmosphereProfiles.*.breath` entry: `interval` seconds between breaths,
 *   `puffs` in each, `life`, `speed` and `rise` (m/s), `size` [born, dying], `color`, `opacity`,
 *   `ambientGain`, `glow`, and `outdoor` if it should stop under a roof
 * @returns {{ sprite: THREE.Sprite, update(camera: THREE.Camera, seconds: number): void }}
 */
export function createBreath(profile) {
  const origins = new THREE.InstancedBufferAttribute(new Float32Array(BREATH_PUFFS * 4), 4);
  const headings = new THREE.InstancedBufferAttribute(new Float32Array(BREATH_PUFFS * 3), 3);
  origins.setUsage(THREE.DynamicDrawUsage);
  headings.setUsage(THREE.DynamicDrawUsage);
  // Born long ago, so every slot starts spent.
  for (let slot = 0; slot < BREATH_PUFFS; slot += 1) origins.setW(slot, -1e6);
  const clock = uniform(0);
  const born = instancedBufferAttribute(origins);
  const seconds = clock.sub(born.w);
  const age = clamp(seconds.div(profile.life), 0, 1);
  const at = born.xyz.add(instancedBufferAttribute(headings).mul(seconds)).add(vec3(0, profile.rise, 0).mul(seconds));
  const material = new THREE.SpriteNodeMaterial({ name: 'location-breath', depthWrite: false, fog: false });
  material.positionNode = at;
  material.scaleNode = vec2(mix(float(profile.size[0]), float(profile.size[1]), age));
  material.colorNode = color(profile.color).mul(locationLight.ambientUp.mul(profile.ambientGain).add(profile.glow));
  // Faded out close to the eye: a puff walked into must not slam against the lens.
  let opacity = softDisc(1.8).mul(smoothstep(0, 0.1, age)).mul(pow(age.oneMinus(), 1.5))
    .mul(smoothstep(0.55, 1.2, length(at.sub(cameraPosition)))).mul(uniform(profile.opacity));
  if (profile.outdoor) opacity = opacity.mul(locationLight.outdoors);
  material.opacityNode = opacity;
  const sprite = new THREE.Sprite(material);
  sprite.count = BREATH_PUFFS;
  sprite.frustumCulled = false;
  sprite.renderOrder = 4;

  const forward = new THREE.Vector3(), velocity = new THREE.Vector3(), previous = new THREE.Vector3();
  let slot = 0, breathed = 0, nextAt = profile.interval, last = null;
  return {
    sprite,
    update(camera, now) {
      clock.value = now;
      if (last !== null && now > last) {
        velocity.copy(camera.position).sub(previous).divideScalar(now - last).clampLength(0, BREATH_MAX_SPEED);
      }
      previous.copy(camera.position);
      last = now;
      if (now < nextAt) return;
      camera.getWorldDirection(forward);
      origins.setXYZW(slot, camera.position.x + forward.x * BREATH_AHEAD, camera.position.y + forward.y * BREATH_AHEAD - BREATH_BELOW,
        camera.position.z + forward.z * BREATH_AHEAD, now);
      headings.setXYZ(slot, velocity.x + forward.x * profile.speed, velocity.y + forward.y * profile.speed * 0.4,
        velocity.z + forward.z * profile.speed);
      origins.needsUpdate = true;
      headings.needsUpdate = true;
      slot = (slot + 1) % BREATH_PUFFS;
      breathed += 1;
      nextAt = now + (breathed % profile.puffs === 0 ? profile.interval : BREATH_GAP);
    },
  };
}
