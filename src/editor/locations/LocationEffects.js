import * as THREE from 'three/webgpu';
import {
  abs, attribute, cameraPosition, clamp, color, densityFogFactor, dot, float, Fn, fract, hash, instancedBufferAttribute,
  instanceIndex, length, max, mix, mx_noise_float, normalWorldGeometry, normalize, positionWorld, pow, reference,
  renderGroup, sin, smoothstep, time, uniform, uv, vec2, vec3,
} from 'three/tsl';
import { locationLight } from './materials/LocationShading.js';

/**
 * A location's light sources and air. Each effect is one instanced draw of
 * camera-facing sprites placed in the vertex stage; none is a scene light.
 */

/** A round sprite fading to nothing at its edge. */
export const softDisc = (falloff) => pow(smoothstep(0, 0.5, length(uv().sub(0.5))).oneMinus(), falloff);

const flicker = (seed, amount) => {
  const draft = sin(time.mul(mix(float(2.1), float(3.4), hash(seed))).add(hash(seed.add(1.3)).mul(6.28))).mul(0.45)
    .add(sin(time.mul(mix(float(5.2), float(7.8), hash(seed.add(2.7)))).add(hash(seed.add(3.9)).mul(6.28))).mul(0.35));
  const wick = sin(time.mul(mix(float(11.0), float(15.0), hash(seed.add(5.1)))).add(seed.mul(2.1))).mul(0.2);
  return draft.add(wick).sub(0.1).mul(amount).add(1).max(0.55);
};

/**
 * Emissive surfaces — lantern globes, coals, crystals, lit windows.
 * Uses soft HDR compression and view-angle limb darkening so curved lantern
 * glass shows a hot pale-gold heart falling smoothly into rich amber/copper
 * toward the edges and frame under ACESFilmicToneMapping.
 */
export function createGlowMaterial() {
  const material = new THREE.MeshBasicNodeMaterial({ name: 'location-glow', fog: true });
  const phase = positionWorld.x.mul(1.73).add(positionWorld.z.mul(2.41)).add(positionWorld.y.mul(0.97));
  const baseFlicker = sin(time.mul(7.6).add(phase)).mul(sin(time.mul(2.9).add(phase.mul(1.37)))).mul(0.085).add(0.98);
  const heatWave = sin(positionWorld.y.mul(18.0).sub(time.mul(9.2)).add(positionWorld.x.mul(6.5))).mul(0.065).add(0.98);

  const baseTint = attribute('tint', 'vec3');
  const rawLuma = dot(baseTint, vec3(0.299, 0.587, 0.114));
  const softScale = float(1).div(rawLuma.mul(0.45).add(0.72));
  const bodyTint = baseTint.mul(softScale);
  const bodyLuma = dot(bodyTint, vec3(0.299, 0.587, 0.114));

  const facing = clamp(abs(dot(normalize(normalWorldGeometry), normalize(cameraPosition.sub(positionWorld)))), 0, 1);
  const coreMask = pow(facing, 1.55);
  const edgeColor = pow(max(bodyTint, vec3(1e-4)), vec3(1.65)).mul(0.36);
  const heartColor = bodyTint.mul(1.22).add(mix(bodyTint, vec3(bodyLuma), 0.35).mul(0.18));

  material.colorNode = mix(edgeColor, heartColor, coreMask).mul(baseFlicker).mul(heatWave);
  return material;
}

/**
 * Soft glows around light sources: what the eye reads as a lamp in dusty air,
 * without a bloom pass. Attenuates with scene FogExp2 so distant lanterns
 * recede into depth haze, and relieves the tightest core so dark lantern
 * ironwork remains crisp and un-washed.
 *
 * @param {Array<{ x: number, y: number, z: number, color: number[], size: number, flicker?: number }>} halos
 */
export function createHalos(halos) {
  const count = halos.length;
  const position = new Float32Array(count * 3);
  const tint = new Float32Array(count * 4);
  const flickerArr = new Float32Array(count);
  halos.forEach((halo, index) => {
    position.set([halo.x, halo.y, halo.z], index * 3);
    tint.set([halo.color[0], halo.color[1], halo.color[2], halo.size], index * 4);
    flickerArr[index] = halo.flicker ?? 0.08;
  });
  const material = new THREE.SpriteNodeMaterial({
    name: 'location-halos', blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const haloPos = instancedBufferAttribute(new THREE.InstancedBufferAttribute(position, 3));
  const haloTint = instancedBufferAttribute(new THREE.InstancedBufferAttribute(tint, 4));
  const haloFlicker = instancedBufferAttribute(new THREE.InstancedBufferAttribute(flickerArr, 1));

  const fogTransmittance = Fn((_, builder) => {
    const sceneFog = builder.scene?.fog;
    if (sceneFog?.isFogExp2) {
      const density = reference('density', 'float', sceneFog).setGroup(renderGroup);
      return densityFogFactor(density).oneMinus();
    }
    return float(1);
  })();

  const pulse = flicker(instanceIndex.toFloat(), haloFlicker);
  const dist = length(cameraPosition.sub(haloPos));
  const radial = length(uv().sub(0.5)).mul(2.0);
  const outerFalloff = pow(smoothstep(float(1.0), float(0.04), radial), 2.5);
  const coreRelief = smoothstep(float(0.0), float(0.3), radial).mul(0.52).add(0.48);
  const nearFade = smoothstep(float(0.85), float(3.8), dist).mul(0.52).add(0.48);
  const airDepth = fogTransmittance.mul(dist.mul(-0.006).exp());

  material.positionNode = haloPos;
  material.scaleNode = vec2(haloTint.w).mul(pulse.sub(1).mul(0.45).add(1));
  material.colorNode = haloTint.rgb.mul(outerFalloff).mul(coreRelief).mul(nearFade).mul(airDepth).mul(pulse);
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

  const tongues = clamp(envelope.mul(1.0).add(n2.mul(0.2).mul(v)), 0.01, 1);
  const bodyMask = smoothstep(tongues.mul(0.95), tongues.mul(0.18), dx)
    .mul(smoothstep(float(0.02), float(0.15), v))
    .mul(smoothstep(float(0.98), float(0.56), v.add(n2.mul(0.26))))
    .mul(smoothstep(float(0.99), float(0.84), v));
  const coreMask = pow(smoothstep(tongues.mul(0.54), float(0), dx).mul(smoothstep(float(0.66), float(0.08), v)), 1.75);
  const shimmer = flicker(instanceIndex.toFloat().add(5.1), 0.1);
  material.colorNode = mix(outerAttr, coreAttr, coreMask).mul(bodyMask).mul(shimmer).mul(0.84);

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
 * @param {object} profile a resolved `atmosphereProfiles.*.particles` entry; `outdoor` ones (snowfall,
 *   spindrift) fade out while the walker is under a roof
 */
export function createParticles(profile) {
  const size = profile.box;
  const index = instanceIndex.toFloat();
  // Integer-spaced seeds: fractional offsets of one index hash to correlated values and draw the field as a line.
  const seed = vec3(hash(index.mul(3)), hash(index.mul(3).add(1)), hash(index.mul(3).add(2)));
  const drift = vec3(...profile.velocity).mul(mix(float(0.5), float(1.5), hash(index.add(7919))));
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
  material.scaleNode = vec2(mix(float(profile.size[0]), float(profile.size[1]), hash(index.add(15485))));
  let lamp = locationLight.carriedColor
    .mul(pow(smoothstep(0, max(locationLight.carriedRange, 1e-3), length(world.sub(locationLight.carriedPosition))).oneMinus(), 2.6))
    .mul(0.55);
  for (const slot of locationLight.dynamicLights) {
    const dynDist = length(world.sub(slot.position));
    const dynRange = max(slot.params.x, 1e-3);
    const dynFade = smoothstep(0, dynRange, dynDist).oneMinus();
    const nearPool = pow(smoothstep(0, max(dynRange.mul(0.42), 0.5), dynDist).oneMinus(), 3.0);
    lamp = lamp.add(slot.color.mul(pow(dynFade, 2.4).mul(0.26).add(nearPool.mul(0.68))));
  }
  const edge = smoothstep(0.35, 0.5, length(local.div(size))).oneMinus();
  const nearCamFade = smoothstep(float(0.35), float(1.1), length(local));
  const twinkle = profile.twinkle
    ? pow(sin(time.mul(mix(float(2), float(6), seed.x)).add(seed.y.mul(60))).mul(0.5).add(0.5), 6).mul(profile.twinkle).add(1)
    : float(1);
  const rawAmbientGain = profile.ambientGain ?? 6;
  const effectiveAmbientGain = !profile.outdoor && !(profile.glow > 0) && rawAmbientGain <= 1.0
    ? rawAmbientGain * 0.12
    : rawAmbientGain;
  material.colorNode = color(profile.color).mul(locationLight.ambientUp.mul(effectiveAmbientGain)
    .add(lamp.mul(profile.lampGain ?? 1)).add(profile.glow ?? 0)).mul(twinkle);
  let opacity = softDisc(1.8).mul(edge).mul(nearCamFade).mul(uniform(profile.opacity));
  if (profile.anchorPoint) {
    const { x, y, z } = profile.anchorPoint;
    opacity = opacity.mul(smoothstep(0, profile.anchorRadius, length(world.sub(vec3(x, y, z)))).oneMinus());
  }
  if (profile.outdoor) opacity = opacity.mul(locationLight.outdoors);
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
