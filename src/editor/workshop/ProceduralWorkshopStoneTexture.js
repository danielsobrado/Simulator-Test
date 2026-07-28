import { mixSeed } from './ProceduralRandom.js';

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

/**
 * Pure soft/legacy stone albedo pixel generation (no Three.js).
 *
 * @returns {{ size: number, data: Uint8Array }}
 */
export function createStoneTexturePixels({
  palette,
  surface,
  seed,
  weathering = 0,
  size = 256,
}) {
  if (!palette?.base) throw new Error('createStoneTexturePixels requires a palette.');
  if (!surface?.proceduralAlbedo) {
    throw new Error('createStoneTexturePixels requires a surface.proceduralAlbedo block.');
  }
  const albedo = surface.proceduralAlbedo;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const broad = (
        mixSeed(
          seed + Math.floor(y / albedo.broadCellSize),
          Math.floor(x / albedo.broadCellSize),
        ) & 255
      ) / 255;
      const grain = (mixSeed(seed + y * 131, x * 17) & 255) / 255;
      const damp = weathering * Math.max(0, 1 - y / 72);
      const value = (broad - 0.5) * albedo.broadVariation
        + (grain - 0.5) * albedo.grainVariation
        - damp * albedo.dampDarkening;
      const index = (y * size + x) * 4;
      data[index] = clampByte(palette.base[0] + value);
      data[index + 1] = clampByte(palette.base[1] + value + damp * albedo.dampGreenLift);
      data[index + 2] = clampByte(palette.base[2] + value);
      data[index + 3] = 255;
    }
  }
  return { size, data };
}

/** Channel-wise sample statistics for QA (chroma / stddev). */
export function summarizeStoneTexturePixels(pixels) {
  const { data, size } = pixels;
  const count = size * size;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumChroma = 0;
  let sumSq = 0;
  for (let pixel = 0; pixel < count; pixel += 1) {
    const offset = pixel * 4;
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    const mean = (r + g + b) / 3;
    sumSq += (r - mean) ** 2 + (g - mean) ** 2 + (b - mean) ** 2;
    sumChroma += Math.max(r, g, b) - Math.min(r, g, b);
  }
  const meanLuma = (sumR + sumG + sumB) / (3 * count);
  let varLuma = 0;
  for (let pixel = 0; pixel < count; pixel += 1) {
    const offset = pixel * 4;
    const luma = (data[offset] + data[offset + 1] + data[offset + 2]) / 3;
    varLuma += (luma - meanLuma) ** 2;
  }
  return {
    meanChroma: sumChroma / count,
    lumaStdDev: Math.sqrt(varLuma / count),
    channelStdDev: Math.sqrt(sumSq / (count * 3)),
  };
}
