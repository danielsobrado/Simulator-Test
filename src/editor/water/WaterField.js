import { createWaterAppearanceSampler } from './WaterAppearance.js';

const WATER_FIELD_CHANNELS = 4;
/** RGBA8: discrete kind, organic tint, cold substrate, local sea exposure. */
export const WATER_APPEARANCE_CHANNELS = 4;
/** Flow texture texels: RG the current, B the fall weight, A the plunge weight. */
export const WATER_FLOW_CHANNELS = 4;
const WATER_FIELD_HALO = 1;
const DIAGONAL_WEIGHT = Math.SQRT1_2;

const conversionBuffer = new ArrayBuffer(4);
const conversionFloat = new Float32Array(conversionBuffer);
const conversionBits = new Uint32Array(conversionBuffer);

export function floatToHalf(value) {
  if (Number.isNaN(value)) return 0x7e00;
  if (value === Number.POSITIVE_INFINITY) return 0x7c00;
  if (value === Number.NEGATIVE_INFINITY) return 0xfc00;

  conversionFloat[0] = value;
  const raw = conversionBits[0];
  const sign = (raw >>> 16) & 0x8000;
  let exponent = ((raw >>> 23) & 0xff) - 127 + 15;
  let mantissa = raw & 0x7fffff;

  if (exponent <= 0) {
    if (exponent < -10) return sign;
    mantissa = (mantissa | 0x800000) >>> (1 - exponent);
    return sign | ((mantissa + 0x1000) >>> 13);
  }
  if (exponent >= 31) return sign | 0x7c00;
  mantissa += 0x1000;
  if (mantissa & 0x800000) {
    mantissa = 0;
    exponent += 1;
    if (exponent >= 31) return sign | 0x7c00;
  }
  return sign | (exponent << 10) | (mantissa >>> 13);
}

export function halfToFloat(value) {
  const sign = (value & 0x8000) << 16;
  let exponent = (value >>> 10) & 0x1f;
  let mantissa = value & 0x03ff;
  let raw;
  if (exponent === 0) {
    if (mantissa === 0) {
      raw = sign;
    } else {
      exponent = 1;
      while ((mantissa & 0x0400) === 0) {
        mantissa <<= 1;
        exponent -= 1;
      }
      mantissa &= 0x03ff;
      raw = sign | ((exponent + 127 - 15) << 23) | (mantissa << 13);
    }
  } else if (exponent === 31) {
    raw = sign | 0x7f800000 | (mantissa << 13);
  } else {
    raw = sign | ((exponent + 127 - 15) << 23) | (mantissa << 13);
  }
  conversionBits[0] = raw;
  return conversionFloat[0];
}

export function encodeWaterFlowComponent(value) {
  const clamped = Math.max(-1, Math.min(1, Number.isFinite(value) ? value : 0));
  return Math.round((clamped * 0.5 + 0.5) * 255);
}

export function decodeWaterFlowComponent(value) {
  return Math.max(-1, Math.min(1, Number(value) / 255 * 2 - 1));
}

export function encodeWaterUnit(value) {
  return Math.round(Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 255);
}

/**
 * True when any vertex of an encoded field carries water coverage.
 *
 * Coverage is channel 0 and never negative, so a non-zero magnitude is enough
 * and no half-float decode is needed. The sign bit is masked so an encoded -0
 * still reads as dry.
 */
export function waterFieldHasCoverage(pixels) {
  if (!pixels) return false;
  for (let index = 0; index < pixels.length; index += WATER_FIELD_CHANNELS) {
    if ((pixels[index] & 0x7fff) !== 0) return true;
  }
  return false;
}

/** Surface-height offsets of covered texels, relative to the field's origin. */
export function waterFieldSurfaceRange(pixels) {
  let min = Infinity;
  let max = -Infinity;
  for (let index = 0; index < pixels.length; index += WATER_FIELD_CHANNELS) {
    if ((pixels[index] & 0x7fff) === 0) continue;
    const height = halfToFloat(pixels[index + 1]);
    min = Math.min(min, height);
    max = Math.max(max, height);
  }
  return min === Infinity ? null : { min, max };
}

function sampleIndex(x, z, width) {
  return z * width + x;
}

function resolveDrySurfaceHeight(samples, sampleWidth, localX, localZ, fallback) {
  let weightedSurface = 0;
  let totalWeight = 0;
  const centerX = localX + WATER_FIELD_HALO;
  const centerZ = localZ + WATER_FIELD_HALO;

  for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetZ === 0) continue;
      const neighbor = samples[sampleIndex(
        centerX + offsetX,
        centerZ + offsetZ,
        sampleWidth,
      )];
      if (!(neighbor.coverage > 0)) continue;
      const distanceWeight = offsetX !== 0 && offsetZ !== 0 ? DIAGONAL_WEIGHT : 1;
      const weight = neighbor.coverage * distanceWeight;
      weightedSurface += neighbor.surfaceHeight * weight;
      totalWeight += weight;
    }
  }

  return totalWeight > 0 ? weightedSurface / totalWeight : fallback;
}

/**
 * A dry vertex's current, fall and plunge, from its wet neighbours — so the
 * sheet's edge carries the same whitewater as the water it borders.
 */
function resolveDryFlow(samples, sampleWidth, localX, localZ) {
  let weightedX = 0;
  let weightedZ = 0;
  let weightedFall = 0;
  let weightedPlunge = 0;
  let totalWeight = 0;
  let kind = 0, bestKindWeight = 0;
  const centerX = localX + WATER_FIELD_HALO;
  const centerZ = localZ + WATER_FIELD_HALO;
  for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetZ === 0) continue;
      const neighbor = samples[sampleIndex(
        centerX + offsetX,
        centerZ + offsetZ,
        sampleWidth,
      )];
      if (!(neighbor.coverage > 0)) continue;
      const distanceWeight = offsetX !== 0 && offsetZ !== 0 ? DIAGONAL_WEIGHT : 1;
      const weight = neighbor.coverage * distanceWeight;
      if (weight > bestKindWeight) { bestKindWeight = weight; kind = neighbor.kind ?? 0; }
      weightedX += (Number.isFinite(neighbor.flowX) ? neighbor.flowX : 0) * weight;
      weightedZ += (Number.isFinite(neighbor.flowZ) ? neighbor.flowZ : 0) * weight;
      weightedFall += (neighbor.fall ?? 0) * weight;
      weightedPlunge += (neighbor.plunge ?? 0) * weight;
      totalWeight += weight;
    }
  }
  if (totalWeight <= 0) return { x: 0, z: 0, fall: 0, plunge: 0, kind: 0 };
  const x = weightedX / totalWeight;
  const z = weightedZ / totalWeight;
  const length = Math.hypot(x, z);
  const fall = weightedFall / totalWeight;
  const plunge = weightedPlunge / totalWeight;
  return length > 1e-8
    ? { x: x / length, z: z / length, fall, plunge, kind }
    : { x: 0, z: 0, fall, plunge, kind };
}

export function createWaterField({
  originX,
  originZ,
  chunkSize,
  sampleWater,
  sampleBiome,
}) {
  if (!Number.isSafeInteger(originX) || !Number.isSafeInteger(originZ)) {
    throw new Error('Water field origin must use safe integer cell coordinates.');
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error('Water field chunkSize must be a positive integer.');
  }
  if (typeof sampleWater !== 'function') {
    throw new Error('Water field requires a sampleWater callback.');
  }

  const width = chunkSize + 1;
  const height = chunkSize + 1;
  const sampleWidth = width + WATER_FIELD_HALO * 2;
  const sampleHeight = height + WATER_FIELD_HALO * 2;
  const samples = new Array(sampleWidth * sampleHeight);

  for (let sampleZ = 0; sampleZ < sampleHeight; sampleZ += 1) {
    for (let sampleX = 0; sampleX < sampleWidth; sampleX += 1) {
      samples[sampleIndex(sampleX, sampleZ, sampleWidth)] = sampleWater(
        originX + sampleX - WATER_FIELD_HALO,
        originZ + sampleZ - WATER_FIELD_HALO,
      );
    }
  }

  const vertexCount = width * height;
  const surfaceHeights = new Float64Array(vertexCount);
  let minimumSurface = Number.POSITIVE_INFINITY;
  let maximumSurface = Number.NEGATIVE_INFINITY;
  for (let localZ = 0; localZ < height; localZ += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const sample = samples[sampleIndex(
        localX + WATER_FIELD_HALO,
        localZ + WATER_FIELD_HALO,
        sampleWidth,
      )];
      const surfaceHeight = sample.coverage > 0
        ? sample.surfaceHeight
        : resolveDrySurfaceHeight(
          samples,
          sampleWidth,
          localX,
          localZ,
          sample.surfaceHeight,
        );
      surfaceHeights[localZ * width + localX] = surfaceHeight;
      if (sample.coverage > 0) {
        minimumSurface = Math.min(minimumSurface, surfaceHeight);
        maximumSurface = Math.max(maximumSurface, surfaceHeight);
      }
    }
  }
  const surfaceOrigin = Number.isFinite(minimumSurface)
    ? (minimumSurface + maximumSurface) * 0.5
    : 0;

  const pixels = new Uint16Array(vertexCount * WATER_FIELD_CHANNELS);
  const flowPixels = new Uint8Array(vertexCount * WATER_FLOW_CHANNELS);
  const appearancePixels = new Uint8Array(vertexCount * WATER_APPEARANCE_CHANNELS);
  const appearanceAt = createWaterAppearanceSampler(sampleBiome);
  for (let localZ = 0; localZ < height; localZ += 1) {
    for (let localX = 0; localX < width; localX += 1) {
      const sample = samples[sampleIndex(
        localX + WATER_FIELD_HALO,
        localZ + WATER_FIELD_HALO,
        sampleWidth,
      )];
      const vertexIndex = localZ * width + localX;
      const index = vertexIndex * WATER_FIELD_CHANNELS;
      const flowIndex = vertexIndex * WATER_FLOW_CHANNELS;
      // Keep the dry side negative. Clamping each vertex to zero before
      // interpolation moved the contour to grid edges and widened foam bands.
      const depth = Number.isFinite(sample.bedHeight)
        ? surfaceHeights[vertexIndex] - sample.bedHeight
        : sample.depth;
      const flow = sample.coverage > 0
        ? { x: sample.flowX, z: sample.flowZ, fall: sample.fall, plunge: sample.plunge }
        : resolveDryFlow(samples, sampleWidth, localX, localZ);
      pixels[index] = floatToHalf(sample.coverage);
      pixels[index + 1] = floatToHalf(surfaceHeights[vertexIndex] - surfaceOrigin);
      pixels[index + 2] = floatToHalf(depth);
      pixels[index + 3] = floatToHalf(sample.shoreDistance);
      flowPixels[flowIndex] = encodeWaterFlowComponent(flow.x);
      flowPixels[flowIndex + 1] = encodeWaterFlowComponent(flow.z);
      flowPixels[flowIndex + 2] = encodeWaterUnit(flow.fall);
      flowPixels[flowIndex + 3] = encodeWaterUnit(flow.plunge);
      const kind = sample.coverage > 0 ? sample.kind ?? 0 : flow.kind;
      const appearance = kind ? appearanceAt(originX + localX, originZ + localZ, kind, sample.shoreDistance) : null;
      appearancePixels[index] = kind;
      appearancePixels[index + 1] = encodeWaterUnit(appearance?.organic ?? 0);
      appearancePixels[index + 2] = encodeWaterUnit(appearance?.cold ?? 0);
      appearancePixels[index + 3] = encodeWaterUnit(appearance?.exposure ?? 0);
    }
  }
  return Object.freeze({ pixels, flowPixels, appearancePixels, width, height, surfaceOrigin });
}

function resolveChunkSize(page) {
  const tileChunkSize = page.tiles ? Math.sqrt(page.tiles.length) : NaN;
  const heightChunkSize = page.heights ? Math.sqrt(page.heights.length) - 1 : NaN;
  const hasTiles = Number.isInteger(tileChunkSize) && tileChunkSize > 0;
  const hasHeights = Number.isInteger(heightChunkSize) && heightChunkSize > 0;
  if (hasTiles && hasHeights && tileChunkSize !== heightChunkSize) {
    throw new Error('Terrain page tile and height dimensions disagree.');
  }
  const chunkSize = hasTiles ? tileChunkSize : heightChunkSize;
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    throw new Error('Terrain page dimensions cannot resolve a square water field.');
  }
  return chunkSize;
}

export function enrichPageWaterField(page, sampleWater, sampleBiome) {
  const field = createWaterField({
    originX: page.originX,
    originZ: page.originZ,
    chunkSize: resolveChunkSize(page),
    sampleWater,
    sampleBiome,
  });
  page.waterFieldPixels = field.pixels;
  page.waterFieldWidth = field.width;
  page.waterFieldHeight = field.height;
  page.waterFieldSurfaceOrigin = field.surfaceOrigin;
  page.waterFlowPixels = field.flowPixels;
  page.waterFlowWidth = field.width;
  page.waterFlowHeight = field.height;
  page.waterAppearancePixels = field.appearancePixels;
  const previousRevision = Number.isSafeInteger(page.waterFieldRevision)
    ? page.waterFieldRevision
    : 0;
  page.waterFieldRevision = previousRevision + 1;
  return page;
}
