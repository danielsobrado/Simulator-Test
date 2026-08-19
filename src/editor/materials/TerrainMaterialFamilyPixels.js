import { TERRAIN_MATERIAL_FAMILIES } from './TerrainMaterialFamilyConstants.js';

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

function writeLayer(target, layer, resolution, profile, seed) {
  const layerOffset = layer * resolution * resolution * 4;
  const phase = hashUnit(layer, seed, seed ^ 0x51f15e);
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
      const directional = Math.sin(
        (u * profile.direction[0] + v * profile.direction[1] + phase)
        * Math.PI * 2 * profile.directionalFrequency,
      ) * 0.5;
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
