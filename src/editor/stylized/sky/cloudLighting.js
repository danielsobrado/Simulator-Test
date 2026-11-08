import {
  clamp,
  dFdx,
  dFdy,
  dot,
  length,
  max,
  mix,
  oneMinus,
  pow,
  smoothstep,
  vec3,
} from 'three/tsl';
import { frameUniform } from '../../../render/FrameUniforms.js';

/** Lightning lighting the cloud deck from inside, 0..1 (LightningScheduler.flash, written by the CPU). */
export const lightningFlash = frameUniform(0);
const FLASH_GLOW = vec3(0.8, 0.86, 1).mul(1.8);

/**
 * Light on the dome's clouds, so they read as masses rather than a flat stencil.
 *
 * - `sunShading`: the side of each billow facing the sun is lit and the far side
 *   falls into the cloud's core colour. The slope comes from screen-space
 *   derivatives of the noise the coverage already sampled, projected onto the
 *   direction toward the sun, so it costs no extra noise sample (a second sample
 *   toward the sun cost 0.4 ms a frame, the sky being full screen).
 * - `slopeScale`: noise change per radian that counts as a fully lit/shaded face.
 * - `silverStrength`/`silverFalloff`: thin cloud between the eye and the sun
 *   glows in the sun's colour — the silver lining of a backlit sky.
 * - `horizonHaze`/`horizonFade`: clouds low on the horizon are far away and sink
 *   into the horizon haze over `horizonFade` of elevation.
 */
export const CLOUD_LIGHTING_DEFAULTS = Object.freeze({
  enabled: true,
  sunShading: 0.55,
  slopeScale: 0.06,
  silverStrength: 0.9,
  silverFalloff: 5,
  horizonHaze: 0.65,
  horizonFade: 0.22,
});

export function resolveCloudLightingConfig(sky = {}) {
  const source = sky.cloudLighting ?? {};
  if (typeof source !== 'object' || Array.isArray(source)) throw new TypeError('sky.cloudLighting must be an object.');
  const value = { ...CLOUD_LIGHTING_DEFAULTS, ...source };
  if (typeof value.enabled !== 'boolean') throw new TypeError('sky.cloudLighting.enabled must be a boolean.');
  for (const [key, min, max] of [
    ['sunShading', 0, 1],
    ['slopeScale', 0.001, 10],
    ['silverStrength', 0, 4],
    ['silverFalloff', 0.5, 128],
    ['horizonHaze', 0, 1],
    ['horizonFade', 0.01, 1],
  ]) {
    if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max) {
      throw new RangeError(`sky.cloudLighting.${key} must be in [${min}, ${max}].`);
    }
  }
  return Object.freeze(value);
}

/**
 * How much a cloud pixel faces the sun, -1 (turned away) … 1 (facing it), from
 * how the coverage noise changes when stepping toward the sun across the dome.
 * Rising noise toward the sun means the pixel is on the cloud's sunward edge.
 */
function sunFacingNode({ noise, direction, sunDirection, slopeScale }) {
  const tangent = sunDirection.sub(direction.mul(dot(direction, sunDirection)));
  const tangentLength = length(tangent);
  const towardSun = tangent.div(max(tangentLength, 1e-4));
  const stepX = dFdx(direction);
  const stepY = dFdy(direction);
  // Screen steps that move the ray toward the sun, one radian's worth.
  const pixelsX = dot(stepX, towardSun).div(max(dot(stepX, stepX), 1e-12));
  const pixelsY = dot(stepY, towardSun).div(max(dot(stepY, stepY), 1e-12));
  const slope = pixelsX.mul(dFdx(noise)).add(pixelsY.mul(dFdy(noise)));
  // Right at the sun the direction toward it is undefined; leave those flat.
  return clamp(slope.mul(slopeScale), -1, 1).mul(smoothstep(0.02, 0.12, tangentLength));
}

/**
 * The lit colour of a cloud pixel.
 *
 * @param {object} options.cloud `{ noise, shape, shadow, body }` from the coverage
 * @param {Node} options.presence 0…1, how much the sun is out (night, overcast)
 * @param {Node} options.horizonColor the sky colour behind a low cloud
 */
export function litCloudColorNode({
  cloud,
  look,
  direction,
  sunDirection,
  sunAlignment,
  presence,
  horizonColor,
  rim,
  cloudFloor,
  settings,
}) {
  const facing = settings.enabled
    ? sunFacingNode({ noise: cloud.noise, direction, sunDirection, slopeScale: settings.slopeScale })
    : null;
  const shade = facing
    ? clamp(cloud.shadow.sub(facing.mul(settings.sunShading).mul(presence)), 0, 1)
    : cloud.shadow;
  let color = mix(look.cloudEdge, look.cloudCore, shade).add(rim).add(FLASH_GLOW.mul(lightningFlash));
  if (!settings.enabled) return color;
  const thin = cloud.shape.mul(oneMinus(cloud.body));
  const silver = pow(sunAlignment, settings.silverFalloff)
    .mul(settings.silverStrength)
    .mul(thin)
    .mul(presence);
  color = color.add(look.sunGlowColor.mul(silver));
  const distant = oneMinus(smoothstep(cloudFloor, cloudFloor + settings.horizonFade, direction.y));
  return mix(color, horizonColor, distant.mul(settings.horizonHaze));
}
