const WATER_FIELD_CHANNELS = 4;
const WATER_FLOW_CHANNELS = 2;
const WATER_FIELD_HALO = 1;
const DIAGONAL_WEIGHT = Math.SQRT1_2;

const conversionBuffer = new ArrayBuffer(4);
const conversionFloat = new Float32Array(conversionBuffer);
const conversionBits = new Uint32Array(conversionBuffer);

function floatToHalf(value) {
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

function resolveDryFlow(samples, sampleWidth, localX, localZ) {
  let weightedX = 0;
  let weightedZ = 0;
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
      weightedX += (Number.isFinite(neighbor.flowX) ? neighbor.flowX : 0) * weight;
      weightedZ += (Number.isFinite(neighbor.flowZ) ? neighbor.flowZ : 0) * weight;
      totalWeight += weight;
    }
  }
  if (totalWeight <= 0) return { x: 0, z: 0 };
  const x = weightedX / totalWeight;
  const z = weightedZ / totalWeight;
  const length = Math.hypot(x, z);
  return length > 1e-8 ? { x: x / length, z: z / length } : { x: 0, z: 0 };
}

export function createWaterField({
  originX,
  originZ,
  chunkSize,
  sampleWater,
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
      const depth = sample.coverage > 0 || !Number.isFinite(sample.bedHeight)
        ? sample.depth
        : Math.max(0, surfaceHeights[vertexIndex] - sample.bedHeight);
      const flow = sample.coverage > 0
        ? { x: sample.flowX, z: sample.flowZ }
        : resolveDryFlow(samples, sampleWidth, localX, localZ);
      pixels[index] = floatToHalf(sample.coverage);
      pixels[index + 1] = floatToHalf(surfaceHeights[vertexIndex] - surfaceOrigin);
      pixels[index + 2] = floatToHalf(depth);
      pixels[index + 3] = floatToHalf(sample.shoreDistance);
      flowPixels[flowIndex] = encodeWaterFlowComponent(flow.x);
      flowPixels[flowIndex + 1] = encodeWaterFlowComponent(flow.z);
    }
  }
  return Object.freeze({ pixels, flowPixels, width, height, surfaceOrigin });
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

export function enrichPageWaterField(page, sampleWater) {
  const field = createWaterField({
    originX: page.originX,
    originZ: page.originZ,
    chunkSize: resolveChunkSize(page),
    sampleWater,
  });
  page.waterFieldPixels = field.pixels;
  page.waterFieldWidth = field.width;
  page.waterFieldHeight = field.height;
  page.waterFieldSurfaceOrigin = field.surfaceOrigin;
  page.waterFlowPixels = field.flowPixels;
  page.waterFlowWidth = field.width;
  page.waterFlowHeight = field.height;
  const previousRevision = Number.isSafeInteger(page.waterFieldRevision)
    ? page.waterFieldRevision
    : 0;
  page.waterFieldRevision = previousRevision + 1;
  return page;
}
