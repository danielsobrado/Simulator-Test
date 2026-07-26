import * as THREE from 'three/webgpu';

const BARK_RESOLUTION = 128;

export const BARK_PROFILES = Object.freeze({
  spruce: Object.freeze({
    plates: [16, 4],
    warp: 0.5,
    fissureWidth: 0.34,
    fissureDepth: 0.85,
    plateRoundness: 0.25,
    micro: 0.3,
    verticalCracks: 0.55,
    lenticels: 0,
    deep: [0.045, 0.032, 0.026],
    high: [0.21, 0.155, 0.115],
    mottle: 0.25,
    roughness: 0.92,
    roughnessVariation: 0.07,
    normalStrength: 2.6,
  }),
  pine: Object.freeze({
    plates: [7, 9],
    warp: 0.35,
    fissureWidth: 0.42,
    fissureDepth: 1,
    plateRoundness: 0.55,
    micro: 0.22,
    verticalCracks: 0.1,
    lenticels: 0,
    deep: [0.05, 0.027, 0.016],
    high: [0.3, 0.155, 0.075],
    mottle: 0.35,
    roughness: 0.88,
    roughnessVariation: 0.1,
    normalStrength: 3,
  }),
  beech: Object.freeze({
    plates: [5, 5],
    warp: 0.6,
    fissureWidth: 0.85,
    fissureDepth: 0.12,
    plateRoundness: 0.1,
    micro: 0.12,
    verticalCracks: 0,
    lenticels: 0,
    deep: [0.16, 0.15, 0.135],
    high: [0.3, 0.285, 0.25],
    mottle: 0.5,
    roughness: 0.78,
    roughnessVariation: 0.08,
    normalStrength: 0.9,
  }),
  birch: Object.freeze({
    plates: [4, 3],
    warp: 0.3,
    fissureWidth: 0.9,
    fissureDepth: 0.06,
    plateRoundness: 0.05,
    micro: 0.1,
    verticalCracks: 0,
    lenticels: 1,
    deep: [0.46, 0.44, 0.42],
    high: [0.8, 0.79, 0.76],
    mottle: 0.22,
    roughness: 0.62,
    roughnessVariation: 0.18,
    normalStrength: 0.7,
  }),
  karst_gnarl: Object.freeze({
    plates: [9, 3],
    warp: 1.4,
    fissureWidth: 0.5,
    fissureDepth: 0.9,
    plateRoundness: 0.3,
    micro: 0.34,
    verticalCracks: 0.3,
    lenticels: 0,
    deep: [0.05, 0.043, 0.036],
    high: [0.205, 0.18, 0.15],
    mottle: 0.3,
    roughness: 0.93,
    roughnessVariation: 0.05,
    normalStrength: 2.8,
  }),
  snag: Object.freeze({
    plates: [11, 2],
    warp: 0.4,
    fissureWidth: 0.3,
    fissureDepth: 0.7,
    plateRoundness: 0.15,
    micro: 0.26,
    verticalCracks: 0.8,
    lenticels: 0,
    deep: [0.07, 0.065, 0.06],
    high: [0.26, 0.25, 0.23],
    mottle: 0.2,
    roughness: 0.9,
    roughnessVariation: 0.06,
    normalStrength: 2.2,
  }),
});

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function toByte(value) {
  return Math.round(clamp01(value) * 255);
}

function hash2(x, y, seed) {
  let hash = Math.imul(x | 0, 374761393)
    ^ Math.imul(y | 0, 668265263)
    ^ Math.imul(seed | 0, 2246822519);
  hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

function hash22(x, y, seed) {
  return [hash2(x, y, seed), hash2(x + 19, y - 37, seed ^ 0x9e3779b9)];
}

function wrap(value, period) {
  return ((value % period) + period) % period;
}

function periodicValueNoise2(x, y, period, seed) {
  const safePeriod = Math.max(1, Math.round(period));
  const integerX = Math.floor(x);
  const integerY = Math.floor(y);
  const fractionX = x - integerX;
  const fractionY = y - integerY;
  const blendX = fractionX * fractionX * (3 - 2 * fractionX);
  const blendY = fractionY * fractionY * (3 - 2 * fractionY);
  const x0 = wrap(integerX, safePeriod);
  const x1 = wrap(integerX + 1, safePeriod);
  const y0 = wrap(integerY, safePeriod);
  const y1 = wrap(integerY + 1, safePeriod);
  const bottom = hash2(x0, y0, seed)
    + (hash2(x1, y0, seed) - hash2(x0, y0, seed)) * blendX;
  const top = hash2(x0, y1, seed)
    + (hash2(x1, y1, seed) - hash2(x0, y1, seed)) * blendX;
  return bottom + (top - bottom) * blendY;
}

function periodicFbm(x, y, octaves, period, seed) {
  let sum = 0;
  let amplitude = 0.5;
  let scale = 1;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += periodicValueNoise2(
      x * scale,
      y * scale,
      period * scale,
      seed + octave * 7,
    ) * amplitude;
    amplitude *= 0.5;
    scale *= 2;
  }
  return sum;
}

function periodicWorleyEdge(x, y, periodX, periodY, seed) {
  const safePeriodX = Math.max(1, Math.round(periodX));
  const safePeriodY = Math.max(1, Math.round(periodY));
  const integerX = Math.floor(x);
  const integerY = Math.floor(y);
  const fractionX = x - integerX;
  const fractionY = y - integerY;
  let nearest = Number.POSITIVE_INFINITY;
  let second = Number.POSITIVE_INFINITY;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const [pointX, pointY] = hash22(
        wrap(integerX + offsetX, safePeriodX),
        wrap(integerY + offsetY, safePeriodY),
        seed,
      );
      const deltaX = offsetX + pointX - fractionX;
      const deltaY = offsetY + pointY - fractionY;
      const distance = Math.hypot(deltaX, deltaY);
      if (distance < nearest) {
        second = nearest;
        nearest = distance;
      } else if (distance < second && distance > nearest + 1e-5) {
        second = distance;
      }
    }
  }

  return {
    nearest: clamp01(nearest / Math.SQRT2),
    edge: clamp01((second - nearest) / Math.SQRT2),
  };
}

function barkHeight(profile, u, v, seed) {
  const warpX = (periodicFbm(u * 6, v * 6, 2, 6, seed + 31) - 0.5)
    * profile.warp * 0.12;
  const warpY = (periodicFbm(u * 6, v * 6, 2, 6, seed + 67) - 0.5)
    * profile.warp * 0.12;
  const warpedU = u + warpX;
  const warpedV = v + warpY;
  const plate = periodicWorleyEdge(
    warpedU * profile.plates[0],
    warpedV * profile.plates[1],
    profile.plates[0],
    profile.plates[1],
    seed,
  );
  const fissure = clamp01(plate.edge / Math.max(profile.fissureWidth, 0.0001));
  let height = Math.pow(fissure, 0.65) * profile.fissureDepth
    + plate.nearest * profile.plateRoundness;

  if (profile.verticalCracks > 0) {
    const lanes = Math.max(1, Math.round(profile.plates[0] * 0.5));
    const phase = warpedU * lanes
      + periodicFbm(warpedU * 3, warpedV * 3, 2, 3, seed + 5) * 1.4;
    const crack = Math.abs((phase - Math.floor(phase)) - 0.5) * 2;
    height *= Math.pow(clamp01(crack / 0.22), 0.5) * profile.verticalCracks
      + (1 - profile.verticalCracks);
  }

  return height + (
    periodicFbm(u * 24, v * 24, 3, 24, seed + 91) - 0.5
  ) * profile.micro;
}

/**
 * Generates the compact bark texture pair used by the CLOD tree material:
 * sqrt-encoded albedo + height, then tangent normal XY + roughness + raw height.
 */
export function createProceduralBarkPixels({
  profile: profileId = 'spruce',
  seed = 83,
  resolution = BARK_RESOLUTION,
} = {}) {
  const profile = BARK_PROFILES[profileId];
  if (!profile) {
    throw new Error(`Unknown procedural bark profile: ${profileId}.`);
  }
  if (!Number.isInteger(resolution) || resolution < 4) {
    throw new Error(`Procedural bark resolution must be an integer of at least 4.`);
  }

  const albedoHeight = new Uint8Array(resolution * resolution * 4);
  const normalRoughness = new Uint8Array(resolution * resolution * 4);
  const derivativeStep = 1.6 / resolution;

  for (let y = 0; y < resolution; y += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const u = (x + 0.5) / resolution;
      const v = (y + 0.5) / resolution;
      const height = barkHeight(profile, u, v, seed);
      const heightX0 = barkHeight(profile, u - derivativeStep, v, seed);
      const heightX1 = barkHeight(profile, u + derivativeStep, v, seed);
      const heightY0 = barkHeight(profile, u, v - derivativeStep, seed);
      const heightY1 = barkHeight(profile, u, v + derivativeStep, seed);
      const normalX = (heightX0 - heightX1) * profile.normalStrength * 0.5;
      const normalY = (heightY0 - heightY1) * profile.normalStrength * 0.5;
      const inverseLength = 1 / Math.max(Math.hypot(normalX, normalY, 1), 0.0001);
      const normalizedHeight = clamp01(height);
      const mottle = (
        periodicValueNoise2(u * 2, v * 2, 2, seed + 201) - 0.5
      ) * profile.mottle;
      let red = (
        profile.deep[0] + (profile.high[0] - profile.deep[0]) * normalizedHeight
      ) * (1 + mottle);
      let green = (
        profile.deep[1] + (profile.high[1] - profile.deep[1]) * normalizedHeight
      ) * (1 + mottle);
      let blue = (
        profile.deep[2] + (profile.high[2] - profile.deep[2]) * normalizedHeight
      ) * (1 + mottle);

      if (profile.lenticels > 0) {
        const lenticel = 1 - clamp01(
          (periodicWorleyEdge(u * 5, v * 24, 5, 24, seed + 77).nearest - 0.2) / 0.22,
        );
        red += (0.045 - red) * lenticel * 0.85;
        green += (0.04 - green) * lenticel * 0.85;
        blue += (0.038 - blue) * lenticel * 0.85;
      }

      const roughness = clamp01(
        profile.roughness
          + (height - 0.5) * profile.roughnessVariation * 2,
      );
      const offset = (y * resolution + x) * 4;
      albedoHeight[offset] = toByte(Math.sqrt(clamp01(red)));
      albedoHeight[offset + 1] = toByte(Math.sqrt(clamp01(green)));
      albedoHeight[offset + 2] = toByte(Math.sqrt(clamp01(blue)));
      albedoHeight[offset + 3] = toByte(normalizedHeight * 0.7 + 0.3);
      normalRoughness[offset] = toByte(normalX * inverseLength * 0.5 + 0.5);
      normalRoughness[offset + 1] = toByte(normalY * inverseLength * 0.5 + 0.5);
      normalRoughness[offset + 2] = toByte(Math.max(0.3, roughness));
      normalRoughness[offset + 3] = toByte(normalizedHeight);
    }
  }

  return Object.freeze({
    profile: profileId,
    seed,
    resolution,
    albedoHeight,
    normalRoughness,
  });
}

function createTexture(pixels, resolution, name) {
  const texture = new THREE.DataTexture(
    pixels,
    resolution,
    resolution,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  texture.name = name;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

export function createProceduralBarkTextures(options = {}) {
  const pixels = createProceduralBarkPixels(options);
  return Object.freeze({
    profile: pixels.profile,
    albedoHeight: createTexture(
      pixels.albedoHeight,
      pixels.resolution,
      `tree-bark-${pixels.profile}-albedo-height`,
    ),
    normalRoughness: createTexture(
      pixels.normalRoughness,
      pixels.resolution,
      `tree-bark-${pixels.profile}-normal-roughness`,
    ),
  });
}
