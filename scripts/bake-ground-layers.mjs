// node scripts/bake-ground-layers.mjs <folder of downloaded 1K diffuse JPGs>
// Rewrites public/assets/ground/layers/: tiling scans whose mean is neutral, so the
// terrain multiplies them over its own palette (terrainGroundLayers.js). Sources: docs/licenses/ground-layers.md.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const SIZE = 1024;
/** Linear mean each channel is scaled to; the shader divides by the same value. */
const TARGET_MEAN = 0.3;
const OUT = 'public/assets/ground/layers';
const decode = v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encode = v => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

async function neutralize(source, name, repeats = 1) {
  const cell = Math.floor(SIZE / repeats);
  const tile = await sharp(source).removeAlpha().resize(cell, cell).raw().toBuffer();
  const data = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE * 3; x++) data[y * SIZE * 3 + x] = tile[(y % cell) * cell * 3 + (Math.floor(x / 3) % cell) * 3 + x % 3];
  }
  const info = { width: SIZE, height: SIZE, channels: 3 };
  const linear = Float32Array.from(data, v => decode(v / 255));
  const mean = [0, 1, 2].map(c => {
    let sum = 0;
    for (let i = c; i < linear.length; i += 3) sum += linear[i];
    return sum / (linear.length / 3);
  });
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < linear.length; i++) {
    out[i] = Math.round(255 * encode(Math.min(1, linear[i] * TARGET_MEAN / mean[i % 3])));
  }
  await sharp(out, { raw: info }).webp({ quality: 88 }).toFile(path.join(OUT, `${name}.webp`));
  console.log(name, mean.map(v => v.toFixed(3)).join(' '));
}

const raw = process.argv[2];
if (!raw) throw new Error('Usage: bake-ground-layers.mjs <folder>');
await mkdir(OUT, { recursive: true });
await neutralize('public/assets/ground/path/ground_0109_color_roughness_1k.webp', 'grit');
// Repeats put each scan near its real size on the terrain's 5–8 m tile.
for (const [file, name, repeats] of [['Grass004', 'grass', 2], ['Ground037', 'mossy', 1], ['dry_decay_leaves', 'litter', 3], ['dry_ground_01', 'cracked', 2]]) {
  await neutralize(path.join(raw, `${file}.jpg`), name, repeats);
}
