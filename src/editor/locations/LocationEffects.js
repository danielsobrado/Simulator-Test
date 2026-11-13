import * as THREE from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, color, float, fract, hash, instancedBufferAttribute, instanceIndex, length,
  mix, mx_noise_float, positionWorld, pow, sin, smoothstep, time, uniform, uv, vec2, vec3,
} from 'three/tsl';
import { locationLight } from './materials/LocationShading.js';

/**
 * A location's light sources and air. Each effect is one instanced draw of
 * camera-facing sprites placed in the vertex stage; none is a scene light.
 */

const softDisc = (falloff) => pow(smoothstep(0, 0.5, length(uv().sub(0.5))).oneMinus(), falloff);
const flicker = (seed, amount) => sin(time.mul(mix(float(7), float(13), hash(seed))).add(hash(seed.add(3.7)).mul(6.28)))
  .mul(sin(time.mul(2.3).add(seed))).mul(amount).add(1);

/** Emissive surfaces — lamp panes, coals, crystals, lit windows. Colour comes from the `tint` vertex attribute. */
export function createGlowMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({ name: 'location-glow', fog: true });
  const cell = positionWorld.mul(0.5).floor();
  const baseFlicker = flicker(cell.x.add(cell.z.mul(7.3)).add(cell.y.mul(3.1)), 0.12);
  const heatWave = sin(positionWorld.y.mul(5.2).sub(time.mul(8.5)).add(positionWorld.x.mul(2.1))).mul(0.08).add(0.96);
  material.colorNode = attribute('tint', 'vec3').mul(baseFlicker).mul(heatWave);
  return material;
}

/**
 * Soft glows around light sources: what the eye reads as a lamp in dusty air,
 * without a bloom pass.
 *
 * @param {Array<{ x: number, y: number, z: number, color: number[], size: number, flicker?: number }>} halos
 */
export function createHalos(halos) {
  const count = halos.length;
  const position = new Float32Array(count * 3), tint = new Float32Array(count * 4);
  halos.forEach((halo, index) => {
    position.set([halo.x, halo.y, halo.z], index * 3);
    tint.set([halo.color[0], halo.color[1], halo.color[2], halo.size], index * 4);
  });
  const material = new THREE.SpriteNodeMaterial({
    name: 'location-halos', blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const haloTint = instancedBufferAttribute(new THREE.InstancedBufferAttribute(tint, 4));
  material.positionNode = instancedBufferAttribute(new THREE.InstancedBufferAttribute(position, 3));
  material.scaleNode = vec2(haloTint.w);
  material.colorNode = haloTint.rgb.mul(softDisc(2.2)).mul(flicker(instanceIndex.toFloat(), 0.1));
  const sprite = new THREE.Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.renderOrder = 2;
  return sprite;
}

/**
 * Animated procedural flame tongues rendered in one instanced draw call:
 * multi-octave upward turbulence, teardrop envelope, amber-gold core to orange tips.
 *
 * @param {Array<{ x: number, y: number, z: number, width: number, height: number, speed: number, core: number[], outer: number[] }>} flames
 */
export function createFlames(flames) {
  const count = flames.length;
  const position = new Float32Array(count * 3);
  const scaleSpeed = new Float32Array(count * 3);
  const coreArr = new Float32Array(count * 3);
  const outerArr = new Float32Array(count * 3);
  flames.forEach((flame, index) => {
    position.set([flame.x, flame.y, flame.z], index * 3);
    scaleSpeed.set([flame.width, flame.height, flame.speed ?? 1], index * 3);
    coreArr.set(flame.core, index * 3);
    outerArr.set(flame.outer, index * 3);
  });

  const material = new THREE.SpriteNodeMaterial({
    name: 'location-flames',
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
  });
  const sAttr = instancedBufferAttribute(new THREE.InstancedBufferAttribute(scaleSpeed, 3));
  const coreAttr = instancedBufferAttribute(new THREE.InstancedBufferAttribute(coreArr, 3));
  const outerAttr = instancedBufferAttribute(new THREE.InstancedBufferAttribute(outerArr, 3));
  material.positionNode = instancedBufferAttribute(new THREE.InstancedBufferAttribute(position, 3));
  material.scaleNode = vec2(sAttr.x, sAttr.y);

  const seed = hash(instanceIndex.toFloat().add(1.37));
  const u = uv().x.sub(0.5).mul(2);
  const v = uv().y;
  const scrollT = time.mul(sAttr.z);

  const n1 = mx_noise_float(vec3(u.mul(2.1), v.mul(2.8).sub(scrollT.mul(3.1)), seed.mul(19.3)));
  const n2 = mx_noise_float(vec3(u.mul(4.8).add(n1.mul(0.85)), v.mul(5.8).sub(scrollT.mul(5.7)), seed.mul(37.1)));
  const turb = n1.mul(0.65).add(n2.mul(0.35));

  const envelope = pow(clamp(v.mul(3.6), 0, 1), 0.45).mul(pow(clamp(v.oneMinus(), 0, 1), 0.78));
  const shiftedU = u.add(turb.mul(0.36).mul(v.mul(0.85).add(0.15)));
  const dx = abs(shiftedU);

  const tongues = clamp(envelope.mul(1.05).add(n2.mul(0.14).mul(v)), 0.01, 1);
  const bodyMask = smoothstep(tongues, tongues.mul(0.24), dx)
    .mul(smoothstep(float(0.02), float(0.16), v))
    .mul(smoothstep(float(1.0), float(0.62), v.add(n2.mul(0.24))))
    .mul(smoothstep(float(0.99), float(0.84), v));
  const coreMask = pow(smoothstep(tongues.mul(0.6), float(0), dx).mul(smoothstep(float(0.72), float(0.08), v)), 1.45);
  const shimmer = flicker(instanceIndex.toFloat().add(5.1), 0.08);
  material.colorNode = mix(outerAttr, coreAttr, coreMask).mul(bodyMask).mul(shimmer).mul(1.38);

  const sprite = new THREE.Sprite(material);
  sprite.count = count;
  sprite.frustumCulled = false;
  sprite.renderOrder = 2;
  return sprite;
}

/**
 * Airborne particles in a box that follows the camera: dust motes, spindrift,
 * ice crystals, embers. They brighten inside the carried lamp's reach, which is
 * what makes still air read as having volume.
 *
 * @param {object} profile a resolved `atmosphereProfiles.*.particles` entry
 */
export function createParticles(profile) {
  const size = profile.box;
  const index = instanceIndex.toFloat();
  const seed = vec3(hash(index), hash(index.add(0.37)), hash(index.add(0.71)));
  const drift = vec3(...profile.velocity).mul(mix(float(0.5), float(1.5), hash(index.add(0.19))));
  const sway = vec3(sin(time.mul(0.7).add(seed.x.mul(40))), sin(time.mul(0.9).add(seed.y.mul(40))),
    sin(time.mul(0.6).add(seed.z.mul(40)))).mul(profile.sway);
  // Wrapped relative to the camera so the box travels with it and no particle pops.
  const local = fract(seed.add(drift.mul(time).add(sway).sub(cameraPosition).div(size))).sub(0.5).mul(size);
  const world = cameraPosition.add(local);
  const material = new THREE.SpriteNodeMaterial({
    name: 'location-particles', depthWrite: false, fog: false,
    blending: profile.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  material.positionNode = world;
  material.scaleNode = vec2(mix(float(profile.size[0]), float(profile.size[1]), hash(index.add(0.53))));
  const lamp = locationLight.carriedColor
    .mul(pow(smoothstep(0, locationLight.carriedRange, length(world.sub(locationLight.carriedPosition))).oneMinus(), 2));
  const edge = smoothstep(0.35, 0.5, length(local.div(size))).oneMinus();
  const twinkle = profile.twinkle
    ? pow(sin(time.mul(mix(float(2), float(6), seed.x)).add(seed.y.mul(60))).mul(0.5).add(0.5), 6).mul(profile.twinkle).add(1)
    : float(1);
  material.colorNode = color(profile.color).mul(locationLight.ambientUp.mul(profile.ambientGain ?? 6)
    .add(lamp.mul(profile.lampGain ?? 1)).add(profile.glow ?? 0)).mul(twinkle);
  let opacity = softDisc(1.5).mul(edge).mul(uniform(profile.opacity));
  if (profile.anchorPoint) {
    const { x, y, z } = profile.anchorPoint;
    opacity = opacity.mul(smoothstep(0, profile.anchorRadius, length(world.sub(vec3(x, y, z)))).oneMinus());
  }
  material.opacityNode = opacity;
  const sprite = new THREE.Sprite(material);
  sprite.count = profile.count;
  sprite.frustumCulled = false;
  sprite.renderOrder = 3;
  return sprite;
}

/**
 * A shaft of light through hazy air: two crossed additive sheets from `from` to
 * `to`, widening to `width`. Stands in for volumetric light at a cave mouth.
 */
export function createLightShaft({ from, to, width, tint, strength }) {
  const a = new THREE.Vector3(from.x, from.y, from.z), b = new THREE.Vector3(to.x, to.y, to.z);
  const axis = b.clone().sub(a);
  const lengthMetres = axis.length();
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 8);
  const group = new THREE.Group();
  const material = new THREE.MeshBasicNodeMaterial({
    name: 'location-shaft', blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
    transparent: true,
  });
  const across = smoothstep(0, 0.5, uv().x).mul(smoothstep(0.5, 1, uv().x).oneMinus());
  const along = smoothstep(0, 0.15, uv().y).mul(pow(uv().y.oneMinus(), 1.4).add(0.08));
  const streaks = sin(uv().x.mul(37).add(time.mul(0.05))).mul(0.15).add(0.85);
  material.colorNode = color(tint).mul(across).mul(along).mul(streaks).mul(strength);
  for (const roll of [0, Math.PI / 2]) {
    const sheet = new THREE.Mesh(geometry, material);
    // PlaneGeometry's +Y runs along the shaft, source end at v = 1.
    sheet.scale.set(width, lengthMetres, 1);
    sheet.rotation.y = roll;
    sheet.position.y = -lengthMetres / 2;
    group.add(sheet);
  }
  group.position.copy(a);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), axis.normalize());
  group.renderOrder = 1;
  return group;
}
