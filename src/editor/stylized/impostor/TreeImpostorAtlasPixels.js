const ALPHA_OFFSET = 3;
const CHANNELS = 4;

function sourceOffset(sourceSize, x, y) {
  return ((sourceSize - y - 1) * sourceSize + x) * CHANNELS;
}

function nearestCoveredPixel(coveragePixels, sourceSize, centerX, centerY, radius) {
  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  const minimumX = Math.max(0, centerX - radius);
  const maximumX = Math.min(sourceSize - 1, centerX + radius);
  const minimumY = Math.max(0, centerY - radius);
  const maximumY = Math.min(sourceSize - 1, centerY + radius);

  for (let y = minimumY; y <= maximumY; y += 1) {
    for (let x = minimumX; x <= maximumX; x += 1) {
      const offset = sourceOffset(sourceSize, x, y);
      if (coveragePixels[offset + ALPHA_OFFSET] === 0) continue;
      const distance = (x - centerX) ** 2 + (y - centerY) ** 2;
      if (distance >= closestDistance) continue;
      closestDistance = distance;
      closest = offset;
    }
  }
  return closest;
}

/**
 * Dilates RGB into the atlas gutter while preserving the source alpha channel.
 * `coveragePixels` can differ from `pixels`, which lets the normal atlas use
 * albedo coverage while reserving normal alpha for the foliage mask.
 */
export function createDilatedAtlasTile(
  pixels,
  sourceSize,
  tileSize,
  gutter,
  { coveragePixels = pixels, alphaPixels = pixels } = {},
) {
  const result = new Uint8ClampedArray(tileSize * tileSize * CHANNELS);
  const dilationRadius = Math.max(1, gutter);
  for (let y = 0; y < tileSize; y += 1) {
    const rawSourceY = y - gutter;
    const sourceY = Math.max(0, Math.min(sourceSize - 1, rawSourceY));
    for (let x = 0; x < tileSize; x += 1) {
      const rawSourceX = x - gutter;
      const sourceX = Math.max(0, Math.min(sourceSize - 1, rawSourceX));
      const directOffset = sourceOffset(sourceSize, sourceX, sourceY);
      const targetOffset = (y * tileSize + x) * CHANNELS;
      const insideSource = rawSourceX >= 0
        && rawSourceX < sourceSize
        && rawSourceY >= 0
        && rawSourceY < sourceSize;
      const coverage = insideSource ? coveragePixels[directOffset + ALPHA_OFFSET] : 0;
      const colorOffset = coverage > 0
        ? directOffset
        : nearestCoveredPixel(
          coveragePixels,
          sourceSize,
          sourceX,
          sourceY,
          dilationRadius,
        );

      if (colorOffset !== null) {
        result[targetOffset] = pixels[colorOffset];
        result[targetOffset + 1] = pixels[colorOffset + 1];
        result[targetOffset + 2] = pixels[colorOffset + 2];
      }
      result[targetOffset + ALPHA_OFFSET] = insideSource
        ? alphaPixels[directOffset + ALPHA_OFFSET]
        : 0;
    }
  }
  return result;
}
