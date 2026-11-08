/**
 * The world wind field: an advected, multi-scale gust field, ported from
 * grass-test (`src/weather/WindField.js`).
 *
 *   prevailing direction   from the weather (or the configured default)
 *   + large gust fronts    the main strength envelope, travelling downwind
 *   + medium turbulence    local breakup of direction and strength
 *   + bounded domain warp  gust cells curl and wander across the wind instead
 *                          of sweeping past as clean parallel bands
 *   + gust inertia         a gust arriving pushes a little harder than one
 *                          that has been blowing
 *
 * Every layer advects along the prevailing direction, never the locally
 * wobbled one: the offset is direction × elapsed time, so a time-varying
 * direction would displace the sample without bound and the wind would appear
 * to accelerate for as long as the session runs.
 *
 * Adapted for a planet-scale world: every noise lookup is wrapped to a lattice
 * period, so neither canonical coordinates in the thousands of kilometres nor a
 * long-running clock cost float32 precision. Lattice gradients are periodic too,
 * so gust strength and direction stay continuous across the wrap boundaries.
 */

import { cos, float, mod, sin, smoothstep, vec2 } from 'three/tsl';
import {
  periodicGradientNoise2dCpu,
  periodicGradientNoise2dNode,
  WIND_NOISE_LATTICE_PERIOD,
} from './windNoise.js';

const DEG_TO_RAD = Math.PI / 180;
const LATTICE_PERIOD = WIND_NOISE_LATTICE_PERIOD;
/** Decorrelates the cross-wind warp lookup from the along-wind one. */
const WARP_LOOKUP_OFFSET = Object.freeze([37.41, -19.73]);

export const DEFAULT_WIND_FIELD = Object.freeze({
  baseStrength: 0.18,
  minStrength: 0.06,
  maxStrength: 1.25,
  direction: Object.freeze({ variationDegrees: 12, scale: 0.03, speed: 0.035 }),
  large: Object.freeze({ scale: 0.015, speed: 0.08, strength: 0.7 }),
  medium: Object.freeze({ scale: 0.07, speed: 0.21, strength: 0.23 }),
  flutter: Object.freeze({ scale: 0.35, speed: 0.7, strength: 0.07 }),
  warp: Object.freeze({ scale: 0.01, speed: 0.045, amplitude: 0.85, lateralGain: 1.6 }),
  gust: Object.freeze({ threshold: 0.48, peak: 0.86, exponent: 1.6, inertiaSeconds: 0.12, inertiaGain: 0.2 }),
});

function mergeSection(defaults, override) {
  return Object.freeze({ ...defaults, ...(override ?? {}) });
}

export function resolveWindFieldConfig(source = {}) {
  return Object.freeze({
    ...DEFAULT_WIND_FIELD,
    ...source,
    direction: mergeSection(DEFAULT_WIND_FIELD.direction, source.direction),
    large: mergeSection(DEFAULT_WIND_FIELD.large, source.large),
    medium: mergeSection(DEFAULT_WIND_FIELD.medium, source.medium),
    flutter: mergeSection(DEFAULT_WIND_FIELD.flutter, source.flutter),
    warp: mergeSection(DEFAULT_WIND_FIELD.warp, source.warp),
    gust: mergeSection(DEFAULT_WIND_FIELD.gust, source.gust),
  });
}

// ---------------------------------------------------------------- CPU

function wrapCpu(value) {
  return value - Math.floor(value / LATTICE_PERIOD) * LATTICE_PERIOD;
}

function noiseCpu(x, y) {
  return periodicGradientNoise2dCpu(wrapCpu(x), wrapCpu(y));
}

function smoothstepCpu(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function layerCpu(x, z, time, prevailingX, prevailingZ, layer, warpX, warpZ) {
  const clock = time * layer.speed;
  return noiseCpu(
    x * layer.scale - prevailingX * clock + warpX,
    z * layer.scale - prevailingZ * clock + warpZ,
  );
}

/**
 * @param {object} options
 * @param {number} options.x canonical world x, metres
 * @param {number} options.z canonical world z, metres
 * @param {number} options.time seconds
 * @param {number} options.directionDegrees prevailing direction (0 = +x, 90 = +z)
 * @param {number} [options.intensity]
 * @param {ReturnType<typeof resolveWindFieldConfig>} options.params
 * @param {number} [options.gustThreshold] live gust shape (storms); defaults to params.gust
 * @param {number} [options.gustPeak]
 */
export function sampleWindFieldCpu({
  x, z, time, directionDegrees, intensity = 1, params,
  gustThreshold = params.gust.threshold, gustPeak = params.gust.peak,
}) {
  const radians = directionDegrees * DEG_TO_RAD;
  const px = Math.cos(radians);
  const pz = Math.sin(radians);

  const directionClock = time * params.direction.speed;
  const directionNoise = noiseCpu(
    x * params.direction.scale - px * directionClock,
    z * params.direction.scale - pz * directionClock,
  ) * 2 - 1;
  const localAngle = radians + directionNoise * params.direction.variationDegrees * DEG_TO_RAD;

  const { warp } = params;
  let warpX = 0;
  let warpZ = 0;
  if (warp.amplitude > 0) {
    const clock = time * warp.speed;
    const sx = x * warp.scale - px * clock;
    const sz = z * warp.scale - pz * clock;
    const along = (noiseCpu(sx, sz) * 2 - 1) * warp.amplitude;
    const across = (noiseCpu(sx + WARP_LOOKUP_OFFSET[0], sz + WARP_LOOKUP_OFFSET[1]) * 2 - 1)
      * warp.amplitude * warp.lateralGain;
    warpX = px * along - pz * across;
    warpZ = pz * along + px * across;
  }

  const large = layerCpu(x, z, time, px, pz, params.large, warpX, warpZ);
  const previousLarge = layerCpu(x, z, time - params.gust.inertiaSeconds, px, pz, params.large, warpX, warpZ);
  const medium = layerCpu(x, z, time, px, pz, params.medium, warpX, warpZ) * 2 - 1;
  const flutter = layerCpu(x, z, time, px, pz, params.flutter, warpX, warpZ) * 2 - 1;

  const { gust: gustParams } = params;
  const gust = smoothstepCpu(gustThreshold, gustPeak, large) ** gustParams.exponent;
  const previousGust = smoothstepCpu(gustThreshold, gustPeak, previousLarge) ** gustParams.exponent;
  const envelope = Math.max(params.minStrength, Math.min(
    params.maxStrength,
    params.baseStrength
      + gust * params.large.strength
      + Math.abs(medium) * params.medium.strength
      + (gust - previousGust) * gustParams.inertiaGain,
  ));
  return {
    directionX: Math.cos(localAngle),
    directionZ: Math.sin(localAngle),
    strength: envelope * Math.max(0, intensity),
    gust,
    turbulence: medium,
    flutter,
  };
}

// ---------------------------------------------------------------- TSL

function noiseNode(point) {
  return periodicGradientNoise2dNode(mod(point, LATTICE_PERIOD));
}

function layerNode(positionXZ, timeNode, prevailing, layer, warpOffset) {
  const clock = timeNode.mul(layer.speed);
  return noiseNode(positionXZ.mul(layer.scale).sub(prevailing.mul(clock)).add(warpOffset));
}

/**
 * The same field as a TSL expression over a canonical-space position.
 * `gustThreshold` / `gustPeak` are optional nodes (uniforms) for a live gust shape.
 *
 * @returns {{ direction: object, strength: object, gust: object, turbulence: object }} TSL nodes
 */
export function createWindFieldNode({
  positionXZ, timeNode, directionDegrees, intensity, params,
  gustThreshold = float(params.gust.threshold), gustPeak = float(params.gust.peak),
}) {
  const radians = directionDegrees.mul(DEG_TO_RAD);
  const prevailing = vec2(cos(radians), sin(radians));
  const directionClock = timeNode.mul(params.direction.speed);
  const directionNoise = noiseNode(
    positionXZ.mul(params.direction.scale).sub(prevailing.mul(directionClock)),
  ).sub(0.5).mul(2);
  const localAngle = radians.add(directionNoise.mul(params.direction.variationDegrees * DEG_TO_RAD));
  const direction = vec2(cos(localAngle), sin(localAngle));

  const { warp } = params;
  let warpOffset = vec2(0, 0);
  if (warp.amplitude > 0) {
    const clock = timeNode.mul(warp.speed);
    const samplePoint = positionXZ.mul(warp.scale).sub(prevailing.mul(clock)).toVar();
    const along = noiseNode(samplePoint).sub(0.5).mul(2 * warp.amplitude);
    const across = noiseNode(samplePoint.add(vec2(WARP_LOOKUP_OFFSET[0], WARP_LOOKUP_OFFSET[1])))
      .sub(0.5).mul(2 * warp.amplitude * warp.lateralGain);
    const perpendicular = vec2(prevailing.y.negate(), prevailing.x);
    warpOffset = prevailing.mul(along).add(perpendicular.mul(across)).toVar();
  }

  const large = layerNode(positionXZ, timeNode, prevailing, params.large, warpOffset);
  const previousLarge = layerNode(positionXZ, timeNode.sub(params.gust.inertiaSeconds), prevailing, params.large, warpOffset);
  const medium = layerNode(positionXZ, timeNode, prevailing, params.medium, warpOffset).sub(0.5).mul(2);

  const { gust: gustParams } = params;
  const gust = smoothstep(gustThreshold, gustPeak, large).pow(gustParams.exponent);
  const previousGust = smoothstep(gustThreshold, gustPeak, previousLarge).pow(gustParams.exponent);
  const envelope = float(params.baseStrength)
    .add(gust.mul(params.large.strength))
    .add(medium.abs().mul(params.medium.strength))
    .add(gust.sub(previousGust).mul(gustParams.inertiaGain))
    .clamp(params.minStrength, params.maxStrength);
  return { direction, strength: envelope.mul(intensity.max(0)), gust, turbulence: medium };
}
