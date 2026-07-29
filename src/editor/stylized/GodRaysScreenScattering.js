import {
  Fn,
  clamp,
  dot,
  float,
  floor,
  fract,
  max,
  mix,
  pow,
  smoothstep,
  step,
  vec2,
  vec3,
} from 'three/tsl';

const SKY_DEPTH_THRESHOLD = 0.9999;
const SUN_SCATTER_RADIUS_UV = 0.22;
const REFERENCE_SAMPLE_COUNT = 12;
const GOD_RAYS_SCREEN_FALLOFF_RADIUS = 1.4;
const DUST_SECOND_OCTAVE_SCALE = 2.13;
const DUST_WARP_STRENGTH = 0.38;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smooth01(value) {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function hashNoise2Reference(x, y) {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function valueNoise2Reference(x, y) {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const fractionX = x - cellX;
  const fractionY = y - cellY;
  const curveX = smooth01(fractionX);
  const curveY = smooth01(fractionY);
  const a = hashNoise2Reference(cellX, cellY);
  const b = hashNoise2Reference(cellX + 1, cellY);
  const c = hashNoise2Reference(cellX, cellY + 1);
  const d = hashNoise2Reference(cellX + 1, cellY + 1);
  const low = a + (b - a) * curveX;
  const high = c + (d - c) * curveX;
  return low + (high - low) * curveY;
}

function dustFieldReference(u, v, timeSeconds, scale, speed) {
  const drift = timeSeconds * speed;
  const pointX = u * scale + drift;
  const pointY = v * scale - drift * 0.37;
  const warpedX = pointX
    + Math.sin(pointY * 0.73 + drift * 0.41) * DUST_WARP_STRENGTH;
  const warpedY = pointY
    + Math.sin(pointX * 0.61 - drift * 0.29) * DUST_WARP_STRENGTH;
  const broad = valueNoise2Reference(warpedX, warpedY);
  const detail = valueNoise2Reference(
    warpedX * DUST_SECOND_OCTAVE_SCALE + 17.13,
    warpedY * DUST_SECOND_OCTAVE_SCALE + 9.71,
  );
  return broad * 0.72 + detail * 0.28;
}

export function godRaysScreenUvCoverageReference(u, v) {
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? 1 : 0;
}

export function godRaysCloudTransmissionReference(cloudCoverage, occlusionStrength) {
  return 1 - clamp01(cloudCoverage) * clamp01(occlusionStrength);
}

export function godRaysVisibilityReference(depth, cloudTransmission) {
  return depth >= SKY_DEPTH_THRESHOLD ? clamp01(cloudTransmission) : 0;
}

export function godRaysOcclusionContrastReference(visibilities) {
  if (!Array.isArray(visibilities) || visibilities.length === 0) return 0;
  const nearSunSamples = visibilities.slice(-8);
  let visibleSum = 0;
  let visibleSquaredSum = 0;
  for (const visibility of nearSunSamples) {
    const clamped = clamp01(visibility);
    visibleSum += clamped;
    visibleSquaredSum += clamped * clamped;
  }
  const visibleShare = visibleSum / nearSunSamples.length;
  const visibleSquaredShare = visibleSquaredSum / nearSunSamples.length;
  const variance = visibleSquaredShare - visibleShare * visibleShare;
  return variance <= 1e-8 ? 0 : smooth01((variance - 0.02) / 0.22);
}

export function godRaysSunSourceReference(distanceToSun) {
  return 1 - smooth01(distanceToSun / SUN_SCATTER_RADIUS_UV);
}

export function godRaysRadialStepReference(distanceToSun, density, samples) {
  return Math.max(0, distanceToSun) * Math.max(0, density) / Math.max(1, samples);
}

export function dustModulationReference(dust, detail, strength) {
  const clustered = smooth01((dust * 0.72 + detail * 0.28 - 0.18) / 0.64);
  const density = 0.08 + clustered * clustered * 1.52;
  return 1 + (density - 1) * clamp01(strength);
}

export function advectedDustDensityReference({
  u,
  v,
  timeSeconds,
  scale,
  speed,
  strength,
}) {
  const dust = dustFieldReference(u, v, timeSeconds, scale, speed);
  return dustModulationReference(dust, dust, strength);
}

export function godRaysScreenFalloffReference(distanceToSun) {
  return 1 - smooth01(distanceToSun / GOD_RAYS_SCREEN_FALLOFF_RADIUS);
}

function screenUvCoverage(coord) {
  return step(0, coord.x)
    .mul(step(coord.x, 1))
    .mul(step(0, coord.y))
    .mul(step(coord.y, 1));
}

function hashNoise2(point) {
  return fract(dot(point, vec2(127.1, 311.7)).sin().mul(43758.5453));
}

function valueNoise2(point) {
  const lattice = floor(point);
  const fraction = fract(point);
  const curve = fraction.mul(fraction).mul(float(3).sub(fraction.mul(2)));
  const a = hashNoise2(lattice);
  const b = hashNoise2(lattice.add(vec2(1, 0)));
  const c = hashNoise2(lattice.add(vec2(0, 1)));
  const d = hashNoise2(lattice.add(vec2(1, 1)));
  return mix(mix(a, b, curve.x), mix(c, d, curve.x), curve.y);
}

function advectedDustDensity(coord, timeNode, dustStrength, dustScale, dustSpeed) {
  const drift = timeNode.mul(dustSpeed);
  const point = coord
    .mul(dustScale)
    .add(vec2(drift, drift.mul(-0.37)))
    .toVar();
  const warp = vec2(
    point.y.mul(0.73).add(drift.mul(0.41)).sin(),
    point.x.mul(0.61).sub(drift.mul(0.29)).sin(),
  );
  const warpedPoint = point.add(warp.mul(DUST_WARP_STRENGTH));
  const broad = valueNoise2(warpedPoint);
  const detail = valueNoise2(
    warpedPoint.mul(DUST_SECOND_OCTAVE_SCALE).add(vec2(17.13, 9.71)),
  );
  const clustered = smoothstep(0.18, 0.82, broad.mul(0.72).add(detail.mul(0.28)));
  const density = float(0.08).add(clustered.mul(clustered).mul(1.52));
  return mix(float(1), density, clamp(dustStrength, 0, 1));
}

/**
 * Radial screen-space light scattering with a smoothly advected density field.
 * Occlusion determines where shafts can exist; broad dust patches continuously
 * modulate those shafts without screen-pixel grain or per-tap noise cost.
 */
export function buildDustGodRays({
  depthTex,
  cloudTex,
  uvNode,
  sunUv,
  intensity,
  density,
  decay,
  weight,
  exposure,
  samples,
  dustStrength,
  dustScale,
  dustSpeed,
  timeNode,
}) {
  return Fn(() => {
    const skyThreshold = float(SKY_DEPTH_THRESHOLD);
    const delta = uvNode.sub(sunUv).mul(density.mul(1 / samples)).toConst();
    const coord = uvNode.toVar();
    const sampleScale = float(REFERENCE_SAMPLE_COUNT / samples);
    const perSampleDecay = pow(decay, sampleScale);
    const illuminationDecay = float(1).toVar();
    const accumulated = vec3(0).toVar();
    const visibilityAccumulated = float(0).toVar();
    const visibilitySquaredAccumulated = float(0).toVar();
    const visibilitySampleCount = float(0).toVar();

    for (let index = 0; index < samples; index += 1) {
      coord.subAssign(delta);
      const coverage = screenUvCoverage(coord);
      const skyVisibility = step(skyThreshold, depthTex.sample(coord).r)
        .mul(cloudTex.sample(coord).r);
      const sampleDistanceToSun = coord.sub(sunUv).length();
      const contrastWeight = coverage.mul(
        float(1).sub(smoothstep(0.18, 0.32, sampleDistanceToSun)),
      );
      visibilityAccumulated.addAssign(skyVisibility.mul(contrastWeight));
      visibilitySquaredAccumulated.addAssign(
        skyVisibility.mul(skyVisibility).mul(contrastWeight),
      );
      visibilitySampleCount.addAssign(contrastWeight);
      const sampleWeight = illuminationDecay
        .mul(weight)
        .mul(sampleScale)
        .mul(coverage);
      const sunSource = float(1).sub(smoothstep(
        0,
        SUN_SCATTER_RADIUS_UV,
        sampleDistanceToSun,
      ));
      accumulated.addAssign(
        vec3(skyVisibility)
          .mul(sunSource)
          .mul(sampleWeight),
      );
      illuminationDecay.mulAssign(perSampleDecay);
    }

    const visibleShare = clamp(
      visibilityAccumulated.div(visibilitySampleCount.max(1e-4)),
      0,
      1,
    );
    const visibleSquaredShare = visibilitySquaredAccumulated
      .div(visibilitySampleCount.max(1e-4));
    const visibilityVariance = visibleSquaredShare
      .sub(visibleShare.mul(visibleShare));
    const occlusionContrast = smoothstep(0.02, 0.24, visibilityVariance);
    const distanceToSun = sunUv.sub(uvNode).length();
    const dustDensity = advectedDustDensity(
      uvNode,
      timeNode,
      dustStrength,
      dustScale,
      dustSpeed,
    );
    const screenFalloff = float(1).sub(
      smoothstep(0, GOD_RAYS_SCREEN_FALLOFF_RADIUS, distanceToSun),
    );

    return max(
      accumulated
        .mul(occlusionContrast)
        .mul(dustDensity)
        .mul(screenFalloff)
        .mul(exposure)
        .mul(intensity),
      vec3(0),
    );
  })();
}
