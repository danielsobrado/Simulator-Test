import { terrainWetlandWetness } from './TerrainWetlandWetness.js';
import { sampleSurfaceMaskChannel } from '../world/SurfaceMaskSampling.js';
import { floatToHalf } from './HalfFloat.js';
import {
  createTerrainMaterialFarStyle,
  encodeTerrainMaterialFarColor,
} from './TerrainMaterialBakeFarColor.js';
import { encodeTerrainMaterialWeights } from './TerrainMaterialBakePacking.js';
import { snowAtPoint } from './SnowAccumulation.js';
import { terrainBakeMacroSeed, terrainBakeValueNoise as valueNoise } from './TerrainBakeNoise.js';

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

function sampleCanopy(source, x, z, resolution) {
  const pixels = source.canopyPixels;
  const size = source.canopySize;
  if (!pixels || !Number.isInteger(size) || size < 1) return 0;
  const sampleX = clamp(Math.floor((x + 0.5) * size / resolution), 0, size - 1);
  const sampleZ = clamp(Math.floor((z + 0.5) * size / resolution), 0, size - 1);
  // Four bytes a texel: R is the canopy, G the contact shade the streamed ground
  // also reads (see `StylizedSurfaceViewBase.paintContactShade`). The stride is the
  // whole contract between the two — a one-byte stride here would read the canopy
  // out of the alpha bytes and shade a forest by nothing.
  return pixels[(sampleZ * size + sampleX) * 4] / 255;
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
    // Tile ids are the Azgaar biome ids: snow cover follows glacier and tundra.
    tiles: page.tiles ? Uint8Array.from(page.tiles) : null,
    snowBiomeCover: page.snowBiomeCover instanceof Uint8Array ? page.snowBiomeCover.slice() : null,
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
  materialStyle = null,
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
  const gradientsX = new Float32Array(texelCount);
  const gradientsZ = new Float32Array(texelCount);
  const curvatures = new Float32Array(texelCount);
  const sourceIndices = new Uint32Array(texelCount);
  const waterSource = waterDistanceSource(source, chunkSize);
  const rowsPerYield = config.build.rowsPerYield;
  const farStyle = createTerrainMaterialFarStyle(materialStyle, config.render, config.families?.substrates,
    config.classification?.glacierCover);

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
      gradientsX[index] = shape.dx;
      gradientsZ[index] = shape.dz;
      curvatures[index] = shape.curvature;
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
  const macroSeed = terrainBakeMacroSeed(macro.seedOffset, worldSeed);

  for (let z = 0; z < resolution; z += 1) {
    for (let x = 0; x < resolution; x += 1) {
      const index = z * resolution + x;
      const sourceIndex = sourceIndices[index];
      const sourceX = sourceIndex % chunkSize;
      const sourceZ = Math.floor(sourceIndex / chunkSize);
      const sourceOffset = sourceIndex * 4;
      const path = source.surfaceMaskPixels[sourceOffset] / 255;
      const grassCoverage = sampleSurfaceMaskChannel(source.surfaceMaskPixels,chunkSize,chunkSize,
        (x+.5)*chunkSize/resolution,(z+.5)*chunkSize/resolution,1);
      const waterByte = source.surfaceMaskPixels[sourceOffset + 2];
      const waterCoverage = waterByte / 255;
      const slope = slopes[index];
      const height = heights[index];
      const land = 1 - waterCoverage;
      const rock = smoothstep(classification.rockSlopeStart, classification.rockSlopeFull, slope) * land;
      const worldX = (source.originX + (x + 0.5) * chunkSize / resolution) * tileSize;
      const worldZ = -(source.originZ + (z + 0.5) * chunkSize / resolution) * tileSize;
      const snow = snowAtPoint({
        height,
        slope,
        dx: gradientsX[index],
        dz: gradientsZ[index],
        curvature: curvatures[index],
        tileId: source.tiles ? source.tiles[sourceIndex] : -1,
        biomeCover: source.snowBiomeCover ? source.snowBiomeCover[sourceIndex] / 255 : undefined,
        worldX,
        worldZ,
        // The mask's continuous dry share, not the binary water class: cut by
        // that, snow ended at every shore along the cell staircase.
      }, classification, macroSeed) * smoothstep(0.25, 0.85, source.surfaceMaskPixels[sourceOffset + 3] / 255);
      const grass = grassCoverage * (1 - path) * (1 - rock) * (1 - snow) * land;
      // Bare bed under water as well as bare land: with snow no longer cut by the
      // water class, a wet cell must still weigh dirt against it.
      const dirt = Math.max(path, 1 - grassCoverage) * (1 - rock) * (1 - snow);
      const weightTotal = grass + dirt + rock + snow;
      const inverseWeightTotal = weightTotal > 1e-9 ? 1 / weightTotal : 0;
      const grassWeight = weightTotal > 1e-9 ? grass * inverseWeightTotal : 0;
      const dirtWeight = weightTotal > 1e-9 ? dirt * inverseWeightTotal : 1;
      const rockWeight = weightTotal > 1e-9 ? rock * inverseWeightTotal : 0;
      const snowWeight = weightTotal > 1e-9 ? snow * inverseWeightTotal : 0;
      encodeTerrainMaterialWeights(
        materialWeights,
        index * 4,
        grassWeight,
        dirtWeight,
        rockWeight,
        snowWeight,
      );

      const waterIndex = (sourceZ + waterSource.radius) * waterSource.size
        + sourceX + waterSource.radius;
      const waterDistanceCells = waterSource.distance[waterIndex];
      const shoreline = clamp01(1 - waterDistanceCells / classification.shorelineRadiusCells);
      const wetness = terrainWetlandWetness(Math.max(
        waterCoverage,
        clamp01(1 - waterDistanceCells / classification.wetnessRadiusCells),
      ), source.tilePixels[sourceOffset + 3], slope);
      const canopy = sampleCanopy(source, x, z, resolution);
      wetnessShoreline[index * 2] = Math.round(wetness * 255);
      wetnessShoreline[index * 2 + 1] = Math.round(shoreline * 255);
      canopyWater[index * 2] = Math.round(canopy * 255);
      canopyWater[index * 2 + 1] = waterByte;

      const macroBase = valueNoise(worldX, worldZ, macro.scaleMeters, macroSeed) * 2 - 1;
      const macroRed = 1 + macroBase * macro.strength;
      const macroGreen = 1
        + (valueNoise(worldX, worldZ, macro.scaleMeters, macroSeed + 17) * 2 - 1)
          * macro.strength * 0.72;
      const macroBlue = 1
        + (valueNoise(worldX, worldZ, macro.scaleMeters, macroSeed + 31) * 2 - 1)
          * macro.strength * 0.55;
      macroTint[index * 4] = Math.round(clamp01(macroRed * 0.5) * 255);
      macroTint[index * 4 + 1] = Math.round(clamp01(macroGreen * 0.5) * 255);
      macroTint[index * 4 + 2] = Math.round(clamp01(macroBlue * 0.5) * 255);
      macroTint[index * 4 + 3] = 255;

      const heightShade = clamp(
        1 + height * macro.heightShadeScale,
        macro.minHeightShade,
        macro.maxHeightShade,
      );
      if (farStyle) {
        encodeTerrainMaterialFarColor(
          farColor,
          index * 4,
          source.tilePixels,
          sourceOffset,
          farStyle,
          grassWeight,
          dirtWeight,
          rockWeight,
          snowWeight,
          macroRed,
          macroGreen,
          macroBlue,
          shoreline,
          wetness,
          canopy,
          heightShade,
          path,
        );
      } else {
        const wetShade = 1 - wetness * macro.wetDarkening;
        farColor[index * 4] = Math.round(clamp(
          source.tilePixels[sourceOffset] * macroRed * heightShade * wetShade,
          0,
          255,
        ));
        farColor[index * 4 + 1] = Math.round(clamp(
          source.tilePixels[sourceOffset + 1] * macroGreen * heightShade * wetShade,
          0,
          255,
        ));
        farColor[index * 4 + 2] = Math.round(clamp(
          source.tilePixels[sourceOffset + 2] * macroBlue * heightShade * wetShade,
          0,
          255,
        ));
        farColor[index * 4 + 3] = 255;
      }
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
