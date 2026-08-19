import { TERRAIN_MATERIAL_FAMILIES } from './TerrainMaterialFamilyConstants.js';

const TAU = Math.PI * 2;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smooth(value) {
  return value * value * (3 - 2 * value);
}

function hashUnit(x, y, seed) {
  let value = Math.imul((x | 0) ^ seed, 0x45d9f3b);
  value = Math.imul(value ^ (value >>> 16) ^ (y | 0), 0x45d9f3b);
  value ^= value >>> 16;
  return (value >>> 0) / 0xffffffff;
}

function periodicValueNoise(x, y, frequency, seed) {
  const period = Math.max(1, Math.round(frequency));
  const scaledX = x * period;
  const scaledY = y * period;
  const x0 = Math.floor(scaledX);
  const y0 = Math.floor(scaledY);
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const wrappedX0 = ((x0 % period) + period) % period;
  const wrappedY0 = ((y0 % period) + period) % period;
  const tx = smooth(scaledX - Math.floor(scaledX));
  const ty = smooth(scaledY - Math.floor(scaledY));
  const a = hashUnit(wrappedX0, wrappedY0, seed);
  const b = hashUnit(x1, wrappedY0, seed);
  const c = hashUnit(wrappedX0, y1, seed);
  const d = hashUnit(x1, y1, seed);
  const ab = a + (b - a) * tx;
  const cd = c + (d - c) * tx;
  return ab + (cd - ab) * ty;
}

function channelVariation(base, fine, ridge, directional, profile, channelBias) {
  const value = (base - 0.5)
    + (fine - 0.5) * profile.fineStrength
    + (ridge - 0.5) * profile.ridgeStrength
    + directional * profile.directionalStrength;
  return clamp01(0.5 + value * profile.contrast + channelBias);
}

function directionalCycles(profile) {
  let x = Math.round(profile.direction[0] * profile.directionalFrequency);
  let y = Math.round(profile.direction[1] * profile.directionalFrequency);
  if (x === 0 && y === 0) {
    if (Math.abs(profile.direction[0]) >= Math.abs(profile.direction[1])) x = 1;
    else y = 1;
  }
  return [x, y];
}

function orientedPhaseDetail(u, v, cyclesX, cyclesY, phase, seed, frequency) {
  const warpFrequency = Math.max(2, Math.round(frequency * 0.5));
  const warp = (periodicValueNoise(u, v, warpFrequency, seed + 211) - 0.5) * 0.85;
  const phaseA = phase + warp;
  const phaseB = phase * 1.71 - warp * 0.55;
  const phaseC = phase * 2.37 + warp * 0.35;
  const waveA = Math.sin((u * cyclesX + v * cyclesY + phaseA) * TAU);
  const waveB = Math.sin((
    u * (cyclesX + cyclesY) + v * (cyclesY - cyclesX) + phaseB
  ) * TAU);
  const waveC = Math.sin((
    u * (cyclesX * 2 - cyclesY) + v * (cyclesX + cyclesY * 2) + phaseC
  ) * TAU);
  return (waveA * 0.52 + waveB * 0.31 + waveC * 0.17) * 0.5;
}

function writeLayer(target, layer, resolution, profile, seed) {
  const layerOffset = layer * resolution * resolution * 4;
  const phase = hashUnit(layer, seed, seed ^ 0x51f15e);
  const [directionCyclesX, directionCyclesY] = directionalCycles(profile);
  const redBias = (hashUnit(seed, layer, 0x125f3) - 0.5) * profile.colorSpread;
  const greenBias = (hashUnit(seed, layer, 0x33d17) - 0.5) * profile.colorSpread;
  const blueBias = (hashUnit(seed, layer, 0x71a93) - 0.5) * profile.colorSpread;

  for (let y = 0; y < resolution; y += 1) {
    const v = y / resolution;
    for (let x = 0; x < resolution; x += 1) {
      const u = x / resolution;
      const base = periodicValueNoise(u, v, profile.coarseFrequency, seed);
      const fine = periodicValueNoise(u, v, profile.fineFrequency, seed + 29);
      const ridgeNoise = periodicValueNoise(u, v, profile.ridgeFrequency, seed + 71);
      const ridge = 1 - Math.abs(ridgeNoise * 2 - 1);
      const directional = orientedPhaseDetail(
        u,
        v,
        directionCyclesX,
        directionCyclesY,
        phase,
        seed,
        profile.directionalFrequency,
      );
      const offset = layerOffset + (y * resolution + x) * 4;
      target[offset] = Math.round(channelVariation(
        base, fine, ridge, directional, profile, redBias,
      ) * 255);
      target[offset + 1] = Math.round(channelVariation(
        base, fine, ridge, directional, profile, greenBias,
      ) * 255);
      target[offset + 2] = Math.round(channelVariation(
        base, fine, ridge, directional, profile, blueBias,
      ) * 255);
      target[offset + 3] = 255;
    }
  }
}

export function generateTerrainMaterialFamilyPixels(config) {
  const familyConfig = config.families;
  const { resolution, variantsPerFamily, seed, profiles } = familyConfig;
  const depth = TERRAIN_MATERIAL_FAMILIES.length * variantsPerFamily;
  const pixels = new Uint8Array(resolution * resolution * depth * 4);

  TERRAIN_MATERIAL_FAMILIES.forEach((family, familyIndex) => {
    const profile = profiles[family];
    for (let variant = 0; variant < variantsPerFamily; variant += 1) {
      const layer = familyIndex * variantsPerFamily + variant;
      const layerSeed = (seed + familyIndex * 4099 + variant * 8191) | 0;
      writeLayer(pixels, layer, resolution, profile, layerSeed);
    }
  });

  return Object.freeze({ pixels, resolution, depth });
}
