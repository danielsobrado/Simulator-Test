import { classifyProceduralBiome } from './proceduralBiomeClassification.js';
import { createBiomeBoundaryWarp } from './BiomeBoundaryWarp.js';
import {
  WORLD_DEFAULT_HEIGHT_SCALE,
  WORLD_DEFAULT_SEED,
  WORLD_GENERATOR_VERSION,
} from './worldConstants.js';
import {
  getRuntimeWaterDomainConfig,
  resolveWaterDomainConfig,
  serializeWaterDomainConfig,
} from '../water/WaterConfig.js';
import { WaterTerrainModel } from '../water/WaterTerrainModel.js';

/** The warp's coarsest wavelength is 1.5 of these: ~48 m, reaching ~25 m. */
const PROCEDURAL_BIOME_WARP_CELLS = 16;

function fade(value) {
  return value * value * (3 - 2 * value);
}

function lerp(left, right, amount) {
  return left + (right - left) * amount;
}

function hash2d(x, z, seed) {
  let value = Math.imul(x | 0, 0x1f123bb5) ^ Math.imul(z | 0, 0x5f356495) ^ (seed | 0);
  value = Math.imul(value ^ (value >>> 15), 0x2c1b3c6d);
  value = Math.imul(value ^ (value >>> 12), 0x297a2d39);
  value ^= value >>> 15;
  return (value >>> 0) / 0xffffffff;
}

function valueNoise(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const tz = fade(z - z0);
  const north = lerp(hash2d(x0, z0, seed), hash2d(x0 + 1, z0, seed), tx);
  const south = lerp(hash2d(x0, z0 + 1, seed), hash2d(x0 + 1, z0 + 1, seed), tx);
  return lerp(north, south, tz) * 2 - 1;
}

function fractalNoise(x, z, seed) {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < 5; octave += 1) {
    total += valueNoise(x * frequency, z * frequency, seed + octave * 1013) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return total / weight;
}


export class ProceduralWorldGenerator {
  constructor({
    seed = WORLD_DEFAULT_SEED,
    version = WORLD_GENERATOR_VERSION,
    heightScale = WORLD_DEFAULT_HEIGHT_SCALE,
    seaLevel = -1.5,
    waterDomain = getRuntimeWaterDomainConfig(),
  } = {}) {
    if (!Number.isSafeInteger(seed)) {
      throw new Error('World generator seed must be a safe integer.');
    }
    if (version !== WORLD_GENERATOR_VERSION) {
      throw new Error(`Unsupported world generator version: ${version}.`);
    }
    if (!Number.isFinite(heightScale) || heightScale <= 0 || !Number.isFinite(seaLevel)) {
      throw new Error('World generator height settings are invalid.');
    }
    this.seed = seed;
    this.version = version;
    this.heightScale = heightScale;
    this.seaLevel = seaLevel;
    this.waterDomain = resolveWaterDomainConfig(waterDomain);
    this.waterTerrainModel = new WaterTerrainModel({
      seed,
      seaLevel,
      config: this.waterDomain,
      sampleBaseHeight: (cellX, cellZ) => this.sampleBaseHeight(cellX, cellZ),
      sampleBaseTile: (cellX, cellZ) => this.sampleBaseTile(cellX, cellZ),
    });
  }

  sampleBaseHeight(vertexX, vertexZ) {
    const continental = fractalNoise(vertexX / 420, vertexZ / 420, this.seed + 11);
    const hills = fractalNoise(vertexX / 96, vertexZ / 96, this.seed + 29);
    const detail = fractalNoise(vertexX / 28, vertexZ / 28, this.seed + 47);
    return continental * this.heightScale
      + hills * this.heightScale * 0.34
      + detail * this.heightScale * 0.08;
  }

  sampleHeight(vertexX, vertexZ) {
    return this.waterTerrainModel.sampleHeight(vertexX, vertexZ);
  }

  sampleClimate(cellX, cellZ) {
    const temperature = fractalNoise(cellX / 360, cellZ / 360, this.seed + 503)
      - Math.min(0.55, Math.abs(cellZ) / 12000);
    const moisture = fractalNoise(cellX / 240, cellZ / 240, this.seed + 907);
    return Object.freeze({ temperature, moisture });
  }

  sampleBaseTile(cellX, cellZ) {
    const height = (
      this.sampleBaseHeight(cellX, cellZ)
      + this.sampleBaseHeight(cellX + 1, cellZ)
      + this.sampleBaseHeight(cellX, cellZ + 1)
      + this.sampleBaseHeight(cellX + 1, cellZ + 1)
    ) * 0.25;
    // Climate is read through a short fractal warp: its own noise is smooth
    // below ~30 m, so without it a biome border is a clean curve rather than
    // the ragged, lobed edge of a real ecotone. Height is read in place.
    this.biomeWarp ??= createBiomeBoundaryWarp({ seed: this.seed, cellsPerTexel: PROCEDURAL_BIOME_WARP_CELLS });
    const offset = this.biomeWarp(cellX + 0.5, cellZ + 0.5, this.biomeWarpScratch ??= { x: 0, z: 0 });
    const { temperature, moisture } = this.sampleClimate(cellX + offset.x, cellZ + offset.z);

    return classifyProceduralBiome({height,temperature,moisture,
      heightScale:this.heightScale,seaLevel:this.seaLevel});
  }

  sampleTile(cellX, cellZ) {
    return this.sampleBaseTile(cellX, cellZ);
  }

  sampleWater(cellX, cellZ) {
    return this.waterTerrainModel.sampleWater(cellX, cellZ);
  }

  prepareWaterSample(cellX, cellZ, shouldYield = null) {
    return this.waterTerrainModel.prepareWaterSample(cellX, cellZ, shouldYield);
  }

  sampleWaterSurface(cellX, cellZ) {
    return this.waterTerrainModel.sampleWaterSurface(cellX, cellZ);
  }

  toMetadata() {
    return Object.freeze({
      seed: this.seed,
      version: this.version,
      heightScale: this.heightScale,
      seaLevel: this.seaLevel,
      waterDomainVersion: this.waterDomain.version,
      waterDomain: serializeWaterDomainConfig(this.waterDomain),
    });
  }
}
