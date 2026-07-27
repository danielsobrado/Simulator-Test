/**
 * Prepare a generated image for use as an inventory UI asset.
 *
 * Generated art arrives as a large PNG that is rarely ready to ship: it may carry the
 * generator's watermark, and a texture asked to "tile seamlessly" almost never does. This
 * crops, optionally makes the result genuinely seamless, flattens contrast, resizes and
 * writes WebP.
 *
 * Usage:
 *   node scripts/prepare-inventory-art.mjs <input> --out public/assets/ui/inventory/stone-tile.webp \
 *     --size 256 --crop 1536 --seamless --contrast 0.75
 *
 *   --out <path>       destination (.webp)
 *   --size <n>         final square size in px
 *   --crop <n>         take an n x n square from the top left first (drops corner watermarks)
 *   --seamless         make the tile wrap perfectly (see makeSeamless below)
 *   --contrast <f>     scale deviation from mean; <1 flattens, 1 leaves alone
 *   --alpha            keep the alpha channel (item icons); omitted means flatten to opaque
 *   --quality <n>      WebP quality, default 90. Grain textures survive 70-78 fine; icons
 *                      with flat colour and clean edges want 88+.
 *   --report           print seam and luma statistics before and after
 */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';

function readArgument(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

/**
 * Four-way cosine blend against half-offset copies of the same image.
 *
 * Every output pixel mixes the source with copies shifted by half the width, half the
 * height, and both. The weights fall to zero exactly at the borders, so opposite edges
 * resolve to adjacent columns of the original and therefore match perfectly. The cost is
 * some softening toward the seams, which is invisible on a stochastic, low-contrast
 * surface like granite and unacceptable on anything with structure — do not use this on
 * the carved mouldings or on item icons.
 */
function makeSeamless(data, width, height, channels) {
  const output = Buffer.alloc(data.length);
  const weightX = new Float64Array(width);
  const weightY = new Float64Array(height);
  for (let x = 0; x < width; x += 1) weightX[x] = (1 - Math.cos((2 * Math.PI * x) / width)) / 2;
  for (let y = 0; y < height; y += 1) weightY[y] = (1 - Math.cos((2 * Math.PI * y) / height)) / 2;

  const halfWidth = width >> 1;
  const halfHeight = height >> 1;

  for (let y = 0; y < height; y += 1) {
    const yOffset = (y + halfHeight) % height;
    const wy = weightY[y];
    for (let x = 0; x < width; x += 1) {
      const xOffset = (x + halfWidth) % width;
      const wx = weightX[x];

      const base = (y * width + x) * channels;
      const shiftedX = (y * width + xOffset) * channels;
      const shiftedY = (yOffset * width + x) * channels;
      const shiftedBoth = (yOffset * width + xOffset) * channels;

      for (let c = 0; c < channels; c += 1) {
        output[base + c] = Math.round(
          data[base + c] * wx * wy
          + data[shiftedX + c] * (1 - wx) * wy
          + data[shiftedY + c] * wx * (1 - wy)
          + data[shiftedBoth + c] * (1 - wx) * (1 - wy),
        );
      }
    }
  }
  return output;
}

/** Pull deviation from the mean toward the mean, keeping average brightness fixed. */
function applyContrast(data, width, height, channels, factor, opaqueChannels) {
  const means = new Float64Array(opaqueChannels);
  const pixels = width * height;
  for (let i = 0; i < pixels; i += 1) {
    for (let c = 0; c < opaqueChannels; c += 1) means[c] += data[i * channels + c];
  }
  for (let c = 0; c < opaqueChannels; c += 1) means[c] /= pixels;

  for (let i = 0; i < pixels; i += 1) {
    for (let c = 0; c < opaqueChannels; c += 1) {
      const index = i * channels + c;
      const value = means[c] + (data[index] - means[c]) * factor;
      data[index] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  return data;
}

/** Seam and luma statistics, so "seamless" is a measurement rather than a claim. */
async function describe(buffer, label) {
  const { data, info } = await sharp(buffer).greyscale().raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const at = (x, y) => data[y * width + x];

  let edgeLeftRight = 0;
  let edgeTopBottom = 0;
  let interior = 0;
  for (let y = 0; y < height; y += 1) edgeLeftRight += Math.abs(at(width - 1, y) - at(0, y));
  for (let x = 0; x < width; x += 1) edgeTopBottom += Math.abs(at(x, height - 1) - at(x, 0));
  for (let y = 1; y < height; y += 1) interior += Math.abs(at(width >> 1, y) - at(width >> 1, y - 1));

  let min = 255;
  let max = 0;
  let sum = 0;
  for (const value of data) {
    if (value < min) min = value;
    if (value > max) max = value;
    sum += value;
  }

  console.log(`${label}: ${width}x${height}`
    + ` | seam L-R ${(edgeLeftRight / height).toFixed(2)}`
    + ` | seam T-B ${(edgeTopBottom / width).toFixed(2)}`
    + ` | interior ${(interior / (height - 1)).toFixed(2)}`
    + ` | luma ${min}/${(sum / data.length).toFixed(1)}/${max}`);
}

async function main() {
  const input = process.argv[2];
  const output = readArgument('out');
  if (!input || !output) {
    console.error('Usage: node scripts/prepare-inventory-art.mjs <input> --out <path.webp> [options]');
    process.exitCode = 1;
    return;
  }

  const size = Number(readArgument('size', '256'));
  const crop = readArgument('crop') ? Number(readArgument('crop')) : null;
  const contrast = Number(readArgument('contrast', '1'));
  const keepAlpha = hasFlag('alpha');
  const report = hasFlag('report');

  let pipeline = sharp(input);
  if (crop) pipeline = pipeline.extract({ left: 0, top: 0, width: crop, height: crop });
  if (!keepAlpha) pipeline = pipeline.removeAlpha();

  let working = await pipeline.png().toBuffer();
  if (report) await describe(working, 'source  ');

  if (hasFlag('seamless') || contrast !== 1) {
    const { data, info } = await sharp(working).raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    let pixels = data;
    if (hasFlag('seamless')) pixels = makeSeamless(pixels, width, height, channels);
    if (contrast !== 1) {
      pixels = applyContrast(pixels, width, height, channels, contrast, keepAlpha ? channels - 1 : channels);
    }
    working = await sharp(pixels, { raw: { width, height, channels } }).png().toBuffer();
    if (report) await describe(working, 'processed');
  }

  await mkdir(path.dirname(output), { recursive: true });
  await sharp(working)
    .resize(size, size, { fit: 'fill' })
    .webp({ quality: Number(readArgument('quality', '90')), alphaQuality: 100, effort: 6 })
    .toFile(output);

  if (report) await describe(await sharp(output).png().toBuffer(), 'final   ');
  const { size: bytes } = await sharp(output).metadata()
    .then(async () => ({ size: (await import('node:fs/promises')).stat(output) }))
    .then(async (r) => await r.size);
  console.log(`Wrote ${output} (${(bytes / 1024).toFixed(1)} KB)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
