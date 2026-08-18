import { floatToHalf } from './HalfFloat.js';

const DISTANCE_INFINITY = 1e9;
const SQRT_TWO = Math.SQRT2;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function smoothstep(edge0, edge1, value) {
  const span = Math.max(1e-9, edge1 - edge0);
  const t = clamp01((value - edge0) / span);
  return t * t * (3 - 2 * t);
}

function hashUnit(x, z, seed) {
  let value = Math.imul(x ^ seed, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16) ^ z, 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function valueNoise(worldX, worldZ, scale, seed) {
  const x = worldX / scale;
  const z = worldZ / scale;
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = hashUnit(x0, z0, seed);
  const b = hashUnit(x0 + 1, z0, seed);
  const c = hashUnit(x0, z0 + 1, seed);
  const d = hashUnit(x0 + 1, z0 + 1, seed);
  const ab = a + (b - a) * sx;
  const cd = c + (d - c) * sx;
  return ab + (cd - ab) * sz;
}

function outputToSource(index, resolution, chunkSize) {
  return clamp(Math.floor((index + 0.5) * chunkSize / resolution), 0, chunkSize - 1);
}

function cellHeight(heights, chunkSize, x, z) {
  const vertexSize = chunkSize + 1;
  const x0 = clamp(x, 0, chunkSize - 1);
  const z0 = clamp(z, 0, chunkSize - 1);
  const topLeft = heights[z0 * vertexSize + x0];
  const topRight = heights[z0 * vertexSize + x0 + 1];
  const bottomLeft = heights[(z0 + 1) * vertexSize + x0];
  const bottomRight = heights[(z0 + 1) * vertexSize + x0 + 1];
  return (topLeft + topRight + bottomLeft + bottomRight) * 0.25;
}

function terrainShape(heights, chunkSize, tileSize, x, z) {
  const vertexSize = chunkSize + 1;
  const topLeft = heights[z * vertexSize + x];
  const topRight = heights[z * vertexSize + x + 1];
  const bottomLeft = heights[(z + 1) * vertexSize + x];
  const bottomRight = heights[(z + 1) * vertexSize + x + 1];
  const center = (topLeft + topRight + bottomLeft + bottomRight) * 0.25;
  const dx = (topRight + bottomRight - topLeft - bottomLeft) / (2 * tileSize);
  const dz = (bottomLeft + bottomRight - topLeft - topRight) / (2 * tileSize);
  const slope = Math.hypot(dx, dz);
  let curvature = 0;
  if (x > 0 && x + 1 < chunkSize && z > 0 && z + 1 < chunkSize) {
    const left = cellHeight(heights, chunkSize, x - 1, z);
    const right = cellHeight(heights, chunkSize, x + 1, z);
    const near = cellHeight(heights, chunkSize, x, z - 1);
    const far = cellHeight(heights, chunkSize, x, z + 1);
    curvature = (left + right + near + far - center * 4) / (tileSize * tileSize);
  }
  return { center, dx, dz, slope, curvature };
}

function octNormal(dx, dz) {
  let x = -dx;
  let y = 1;
  let z = -dz;
  const length = Math.hypot(x, y, z) || 1;
  x /= length;
  y /= length;
  z /= length;
  const l1 = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  x /= l1;
  y /= l1;
  z /= l1;
  if (y < 0) {
    const oldX = x;
    x = (1 - Math.abs(z)) * Math.sign(oldX || 1);
    z = (1 - Math.abs(oldX)) * Math.sign(z || 1);
  }
  return [Math.round(clamp(x, -1, 1) * 127), Math.round(clamp(z, -1, 1) * 127)];
}

function distanceField(mask, size) {
  const distance = new Float32Array(size * size);
  for (let index = 0; index < distance.length; index += 1) {
    distance[index] = mask[index] > 0 ? 0 : DISTANCE_INFINITY;
  }
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = z * size + x;
      let value = distance[index];
      if (x > 0) value = Math.min(value, distance[index - 1] + 1);
      if (z > 0) value = Math.min(value, distance[index - size] + 1);
      if (x > 0 && z > 0) value = Math.min(value, distance[index - size - 1] + SQRT_TWO);
      if (x + 1 < size && z > 0) value = Math.min(value, distance[index - size + 1] + SQRT_TWO);
      distance[index] = value;
    }
  }
  for (let z = size - 1; z >= 0; z -= 1) {
    for (let x = size - 1; x >= 0; x -= 1) {
      const index = z * size + x;
      let value = distance[index];
      if (x + 1 < size) value = Math.min(value, distance[index + 1] + 1);
      if (z + 1 < size) value = Math.min(value, distance[index + size] + 1);
      if (x + 1 < size && z + 1 < size) value = Math.min(value, distance[index + size + 1] + SQRT_TWO);
      if (x > 0 && z + 1 < size) value = Math.min(value, distance[index + size - 1] + SQRT_TWO);
      distance[index] = value;
    }
  }
  return distance;
}

function localWaterMask(surfaceMaskPixels, chunkSize) {
  const water = new Uint8Array(chunkSize * chunkSize);
  for (let index = 0; index < water.length; index += 1) {
    water[index] = surfaceMaskPixels[index * 4 + 2];
  }
  return water;
}

function waterDistanceSource(source, chunkSize) {
  if (source.waterHaloPixels instanceof Uint8Array
      && Number.isInteger(source.waterHaloRadius)
      && source.waterHaloRadius >= 0
      && source.waterHaloSize === chunkSize + source.waterHaloRadius * 2
      && source.waterHaloPixels.length === source.waterHaloSize ** 2) {
    return {
      distance: distanceField(source.waterHaloPixels, source.waterHaloSize),
      size: source.waterHaloSize,
      radius: source.waterHaloRadius,
    };
  }
  return {
    distance: distanceField(localWaterMask(source.surfaceMaskPixels, chunkSize), chunkSize),
    size: chunkSize,
    radius: 0,
  };
}

function encodeWeights(target, offset, values) {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  const normalized = total > 1e-9
    ? values.map((value) => Math.max(0, value) / total * 255)
    : [0, 255, 0, 0];
  const floors = normalized.map(Math.floor);
  let remainder = 255 - floors.reduce((sum, value) => sum + value, 0);
  const order = normalized
    .map((value, index) => ({ index, fraction: value - floors[index] }))
    .sort((left, right) => right.fraction - left.fraction);
  for (let index = 0; index < order.length && remainder > 0; index += 1) {
    floors[order[index].index] += 1;
    remainder -= 1;
  }
  for (let index = 0; index < 4; index += 1) target[offset + index] = floors[index];
}

function sampleCanopy(source, x, z, resolution) {
  const pixels = source.canopyPixels;
  const size = source.canopySize;
  if (!pixels || !Number.isInteger(size) || size < 1) return 0;
  const sampleX = clamp(Math.floor((x + 0.5) * size / resolution), 0, size - 1);
  const sampleZ = clamp(Math.floor((z + 0.5) * size / resolution), 0, size - 1);
  return pixels[sampleZ * size + sampleX] / 255;
}

export function captureTerrainMaterialBakeSource({
  page,
  canopyPixels = null,
  canopySize = 0,
  waterHaloPixels = null,
  waterHaloSize = 0,
  waterHaloRadius = 0,
}) {
  if (!(page?.tilePixels instanceof Uint8Array)
      || !(page.surfaceMaskPixels instanceof Uint8Array)
      || !(page.heights instanceof Float32Array)) {
    throw new Error('Terrain material bake source requires committed tile, surface-mask and height arrays.');
  }
  return Object.freeze({
    originX: page.originX,
    originZ: page.originZ,
    tilePixels: page.tilePixels.slice(),
    surfaceMaskPixels: page.surfaceMaskPixels.slice(),
    heights: page.heights.slice(),
    canopyPixels: canopyPixels instanceof Uint8Array ? canopyPixels.slice() : null,
    canopySize: Number.isInteger(canopySize) ? canopySize : 0,
    waterHaloPixels: waterHaloPixels instanceof Uint8Array ? waterHaloPixels.slice() : null,
    waterHaloSize: Number.isInteger(waterHaloSize) ? waterHaloSize : 0,
    waterHaloRadius: Number.isInteger(waterHaloRadius) ? waterHaloRadius : 0,
  });
}

export async function yieldTerrainMaterialBake() {
  if (typeof globalThis.scheduler?.yield === 'function') {
    await globalThis.scheduler.yield();
    return;
  }
  if (typeof globalThis.setImmediate === 'function') {
    await new Promise((resolve) => globalThis.setImmediate(resolve));
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

export async function bakeTerrainMaterialPage({
  source,
  descriptor,
  config,
  chunkSize,
  tileSize,
  worldSeed = 0,
  yieldControl = yieldTerrainMaterialBake,
}) {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const resolution = config.qualityTiers[descriptor.quality].resolution;
  const texelCount = resolution * resolution;
  const macroTint = new Uint8Array(texelCount * 4);
  const terrainShapePixels = new Uint16Array(texelCount * 2);
  const materialWeights = new Uint8Array(texelCount * 4);
  const wetnessShoreline = new Uint8Array(texelCount * 2);
  const farColor = new Uint8Array(texelCount * 4);
  const farNormal = new Int8Array(texelCount * 2);
  const canopyWater = new Uint8Array(texelCount * 2);
  const heights = new Float32Array(texelCount);
  const slopes = new Float32Array(texelCount);
  const sourceIndices = new Uint32Array(texelCount);
  const waterSource = waterDistanceSource(source, chunkSize);
  const rowsPerYield = config.build.rowsPerYield;

  for (let z = 0; z < resolution; z += 1) {
    const sourceZ = outputToSource(z, resolution, chunkSize);
    for (let x = 0; x < resolution; x += 1) {
      const sourceX = outputToSource(x, resolution, chunkSize);
      const index = z * resolution + x;
      const sourceIndex = sourceZ * chunkSize + sourceX;
      const shape = terrainShape(source.heights, chunkSize, tileSize, sourceX, sourceZ);
      sourceIndices[index] = sourceIndex;
      heights[index] = shape.center;
      slopes[index] = shape.slope;
      terrainShapePixels[index * 2] = floatToHalf(shape.slope);
      terrainShapePixels[index * 2 + 1] = floatToHalf(shape.curvature);
      const [normalX, normalZ] = octNormal(shape.dx, shape.dz);
      farNormal[index * 2] = normalX;
      farNormal[index * 2 + 1] = normalZ;
    }
    if ((z + 1) % rowsPerYield === 0 && z + 1 < resolution) await yieldControl();
  }

  const classification = config.classification;
  const macro = config.macro;
  const macroSeed = (macro.seedOffset ^ (Number.isSafeInteger(worldSeed) ? worldSeed : 0)) | 0;

  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const index = z * resolution + x;
      const sourceIndex = sourceIndices[index];
      const sourceX = sourceIndex % chunkSize;
      const sourceZ = Math.floor(sourceIndex / chunkSize);
      const sourceOffset = sourceIndex * 4;
      const path = source.surfaceMaskPixels[sourceOffset] / 255;
      const grassCoverage = source.surfaceMaskPixels[sourceOffset + 1] / 255;
      const waterByte = source.surfaceMaskPixels[sourceOffset + 2];
      const waterCoverage = waterByte / 255;
      const slope = slopes[index];
      const height = heights[index];
      const land = 1 - waterCoverage;
      const rock = smoothstep(classification.rockSlopeStart, classification.rockSlopeFull, slope) * land;
      const snowAltitude = smoothstep(
        classification.snowLine,
        classification.snowLine + classification.snowFade,
        height,
      );
      const snowHold = 1 - smoothstep(
        classification.snowSlopeMax * 0.7,
        classification.snowSlopeMax,
        slope,
      );
      const snow = snowAltitude * snowHold * land;
      const grass = grassCoverage * (1 - path) * (1 - rock) * (1 - snow) * land;
      const dirt = Math.max(path, (1 - grassCoverage) * land) * (1 - rock) * (1 - snow);
      encodeWeights(materialWeights, index * 4, [grass, dirt, rock, snow]);

      const waterIndex = (sourceZ + waterSource.radius) * waterSource.size
        + sourceX + waterSource.radius;
      const waterDistanceCells = waterSource.distance[waterIndex];
      const shoreline = clamp01(1 - waterDistanceCells / classification.shorelineRadiusCells);
      const wetness = Math.max(
        waterCoverage,
        clamp01(1 - waterDistanceCells / classification.wetnessRadiusCells),
      );
      wetnessShoreline[index * 2] = Math.round(wetness * 255);
      wetnessShoreline[index * 2 + 1] = Math.round(shoreline * 255);
      canopyWater[index * 2] = Math.round(sampleCanopy(source, x, z, resolution) * 255);
      canopyWater[index * 2 + 1] = waterByte;

      const worldX = (source.originX + (x + 0.5) * chunkSize / resolution) * tileSize;
      const worldZ = -(source.originZ + (z + 0.5) * chunkSize / resolution) * tileSize;
      const macroBase = valueNoise(worldX, worldZ, macro.scaleMeters, macroSeed) * 2 - 1;
      const macroR = 1 + macroBase * macro.strength;
      const macroG = 1 + (valueNoise(worldX, worldZ, macro.scaleMeters, macroSeed + 17) * 2 - 1)
        * macro.strength * 0.72;
      const macroB = 1 + (valueNoise(worldX, worldZ, macro.scaleMeters, macroSeed + 31) * 2 - 1)
        * macro.strength * 0.55;
      macroTint[index * 4] = Math.round(clamp01(macroR * 0.5) * 255);
      macroTint[index * 4 + 1] = Math.round(clamp01(macroG * 0.5) * 255);
      macroTint[index * 4 + 2] = Math.round(clamp01(macroB * 0.5) * 255);
      macroTint[index * 4 + 3] = 255;

      const heightShade = clamp(
        1 + height * macro.heightShadeScale,
        macro.minHeightShade,
        macro.maxHeightShade,
      );
      const wetShade = 1 - wetness * macro.wetDarkening;
      farColor[index * 4] = Math.round(clamp(
        source.tilePixels[sourceOffset] * macroR * heightShade * wetShade,
        0,
        255,
      ));
      farColor[index * 4 + 1] = Math.round(clamp(
        source.tilePixels[sourceOffset + 1] * macroG * heightShade * wetShade,
        0,
        255,
      ));
      farColor[index * 4 + 2] = Math.round(clamp(
        source.tilePixels[sourceOffset + 2] * macroB * heightShade * wetShade,
        0,
        255,
      ));
      farColor[index * 4 + 3] = 255;
    }
    if ((z + 1) % rowsPerYield === 0 && z + 1 < resolution) await yieldControl();
  }

  const channels = Object.freeze({
    macroTint,
    terrainShape: terrainShapePixels,
    materialWeights,
    wetnessShoreline,
    farColor,
    farNormal,
    canopyWater,
  });
  const byteLength = Object.values(channels).reduce(
    (total, pixels) => total + pixels.byteLength,
    0,
  );
  const finishedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return Object.freeze({
    value: Object.freeze({
      descriptor,
      resolution,
      channels,
      durationMs: Math.max(0, finishedAt - startedAt),
    }),
    byteLength,
  });
}
