import * as THREE from 'three/webgpu';
import { float, positionWorld, smoothstep } from 'three/tsl';
import { frameUniform as uniform } from '../../render/FrameUniforms.js';

import { cloudMotionCoordinatesNode } from './AtmosphereMotion.js';
import { cloudFbm2 } from './sky/cloudNoise.js';

/**
 * Cloud units the sky's canonical sampling position wraps at. The cloud noise
 * hashes `fract(position × 127.1)`, which float32 flattens to a constant once
 * positions reach tens of thousands of units — on Eldara the sky went blank or
 * broke into streaks. Wrapping in double precision keeps the shader's
 * coordinates small; crossing a wrap shifts the whole field once, every
 * `CLOUD_WRAP_UNITS × cloudWorldScale` metres (92 km at 180 m per unit).
 */
export const CLOUD_WRAP_UNITS = 512;

/** Sharpness widths added to each side of a shadow's edge, around its midpoint. */
const CLOUD_SHADOW_PENUMBRA = 1.5;

/** A canonical metre coordinate wrapped for cloud sampling, in metres. */
export function wrapCloudCoordinate(canonicalMeters, worldScale) {
  const period = CLOUD_WRAP_UNITS * worldScale;
  return canonicalMeters - Math.floor(canonicalMeters / period) * period;
}

/**
 * Shared by the sky (which advances them) and every lit surface that takes
 * cloud shadows. `origin` is the wrapped canonical position of render-space
 * zero, so a surface's cloud position is `positionWorld.xz + origin`, matching
 * the dome exactly.
 */
export const cloudShadowUniforms = {
  time: uniform(0),
  origin: uniform(new THREE.Vector2()),
  strength: uniform(0),
  /** The sun's direction as the dome projects it (see cloudSunGeometry). */
  sunProjected: uniform(new THREE.Vector2()),
  /** 0..1 how much of the cloud band the sun sits in. */
  sunBand: uniform(0),
  cloudDensity: uniform(0.56),
  /** The look's cloud edge softness, which the region varies (cumulus vs wisps). */
  cloudSharpness: uniform(0.24),
};

/**
 * Advance the shadows with the sky. `cameraRender` and `cameraCanonical` are
 * the same camera in render and canonical space; `sunDirection` and
 * `cloudDensity` follow the current look.
 */
export function updateCloudShadows({
  timeSeconds, cameraRender, cameraCanonical, worldScale, strength, sunDirection, sky, cloudDensity, cloudSharpness,
}) {
  if (Number.isFinite(cloudSharpness)) cloudShadowUniforms.cloudSharpness.value = cloudSharpness;
  if (sunDirection && sky) {
    const sun = cloudSunGeometry(sunDirection, sky);
    cloudShadowUniforms.sunProjected.value.set(sun.projectedX, sun.projectedZ);
    cloudShadowUniforms.sunBand.value = sun.band;
  }
  if (Number.isFinite(cloudDensity)) cloudShadowUniforms.cloudDensity.value = cloudDensity;
  cloudShadowUniforms.time.value = timeSeconds;
  cloudShadowUniforms.origin.value.set(
    wrapCloudCoordinate(cameraCanonical.x, worldScale) - cameraRender.x,
    wrapCloudCoordinate(cameraCanonical.z, worldScale) - cameraRender.z,
  );
  cloudShadowUniforms.strength.value = strength;
}

function smoothstepCpu(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Where the dome draws the cloud in front of the sun, in its projected sky
 * coordinates, and how much of its cloud band the sun sits in (the band cuts
 * off near the horizon and zenith; so does the sunlight clouds can block).
 */
export function cloudSunGeometry(sun, sky) {
  const lift = Math.max(sun.y + 0.55, 0.16);
  return {
    projectedX: sun.x / lift,
    projectedZ: sun.z / lift,
    band: smoothstepCpu(sky.cloudFloor, sky.cloudFloor + 0.08, sun.y)
      * (1 - smoothstepCpu(sky.cloudCeiling - 0.08, sky.cloudCeiling, sun.y)),
  };
}

/**
 * How much of the sun the clouds leave on a surface, 1 in the clear. The cloud
 * sampled is the one the dome draws in front of the sun as seen from the
 * surface, so a shadow falls where the sky shows the sun behind a cloud. Two
 * octaves of the dome's four: the fine ones only fray edges a shadow softens
 * anyway.
 */
function cloudSunlightNode(sky) {
  const u = cloudShadowUniforms;
  const uv = cloudMotionCoordinatesNode({
    projected: u.sunProjected,
    cameraWorldPosition: positionWorld.xz.add(cloudShadowUniforms.origin),
    timeNode: cloudShadowUniforms.time,
    scale: sky.cloudScale,
    speed: sky.cloudSpeed,
    worldScale: sky.cloudWorldScale,
  });
  // A cloud's edge is crisp in the sky, but its shadow is a wide penumbra on the
  // ground: at the dome's width it drew hard lobes across the meadow.
  const cover = smoothstep(
    u.cloudDensity.sub(u.cloudSharpness.mul(CLOUD_SHADOW_PENUMBRA)),
    u.cloudDensity.add(u.cloudSharpness.mul(1 + CLOUD_SHADOW_PENUMBRA)),
    cloudFbm2(uv),
  );
  return float(1).sub(cover.mul(u.sunBand).mul(u.strength));
}

/**
 * Let the clouds shade this material's sunlight: the sun's shadow term is
 * scaled, so ambient light is untouched, as under a real cloud. Built only when
 * `sky.cloudShadows.enabled`; a disabled world compiles no cloud nodes.
 */
export function applyCloudShadow(material, sky) {
  if (!sky?.cloudShadows?.enabled || material.userData.cloudShadow) return material;
  const sunlight = cloudSunlightNode(sky);
  const previous = material.receivedShadowNode;
  material.receivedShadowNode = (shadow) => (previous ? previous(shadow) : shadow).mul(sunlight);
  material.userData.cloudShadow = true;
  return material;
}
