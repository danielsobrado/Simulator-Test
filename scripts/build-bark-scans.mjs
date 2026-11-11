#!/usr/bin/env node
/**
 * Packs the scanned Poly Haven bark sets (npm run fetch:tree-sources) into the
 * two-texture layout the tree bark material reads, one pair per bark profile.
 *
 * The layout is the one `createProceduralBarkPixels` writes, so a scan is a
 * drop-in for the procedural texture:
 *   albedoHeight    RGB sqrt-encoded linear albedo, A height * 0.7 + 0.3
 *   normalRoughness R/G tangent normal XY, B roughness (floor 0.3), A height
 *
 * Outputs public/assets/textures/bark/scans/<profile>-{albedo-height,normal-roughness}.png
 * and a comparison sheet tmp/trees/bark-scans.png (procedural beside scan).
 *
 * Usage: npm run build:bark-scans [-- --size 256]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { BARK_PROFILES, createProceduralBarkPixels } from '../src/editor/stylized/forest/ProceduralBarkTextures.js';
import { barks, resolution } from './tree-sources.config.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cacheDir = path.join(rootDir, 'assets', 'source-cache', 'polyhaven');
const outDir = path.join(rootDir, 'public', 'assets', 'textures', 'bark', 'scans');
const sizeFlag = process.argv.indexOf('--size');
const SIZE = sizeFlag < 0 ? 512 : Number(process.argv[sizeFlag + 1]);
const SHEET_TILE = 256;
/** A wrap may differ from its interior neighbours by this factor before it reads as a seam. */
const SEAM_TOLERANCE = 1.5;

const srgbToLinear = (byte) => {
  const v = byte / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toByte = (value) => Math.round(Math.min(1, Math.max(0, value)) * 255);

/**
 * One map as raw bytes at SIZE x SIZE. `mirror` makes a scan that does not tile
 * along the trunk seamless: the top half is the map at half height, the bottom
 * half its reflection (with the normal's Y turned over when `flipGreen`).
 */
async function readMap(id, map, channels, { mirror = false, flipGreen = false } = {}) {
  const file = path.join(cacheDir, id, `${id}_${map}_${resolution}.jpg`);
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}; run npm run fetch:tree-sources.`);
  let image = sharp(file).resize(SIZE, mirror ? SIZE / 2 : SIZE, { kernel: 'lanczos3', fit: 'fill' });
  image = channels === 1 ? image.greyscale() : image.removeAlpha();
  const half = await image.raw().toBuffer();
  if (!mirror) return half;
  const row = SIZE * channels;
  const out = Buffer.alloc(row * SIZE);
  half.copy(out);
  for (let y = 0; y < SIZE / 2; y += 1) {
    half.copy(out, (SIZE - 1 - y) * row, y * row, (y + 1) * row);
  }
  if (flipGreen) {
    for (let i = (SIZE / 2) * row + 1; i < out.length; i += channels) out[i] = 255 - out[i];
  }
  return out;
}

function percentile(values, share) {
  const sorted = Uint8Array.from(values).sort();
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

/** Fails when a wrap edge differs from its neighbours more than interior rows and columns do. */
function assertTileable(grey, label) {
  const at = (x, y) => grey[y * SIZE + x];
  const diff = (ax, ay, bx, by, vertical) => {
    let sum = 0;
    for (let i = 0; i < SIZE; i += 1) sum += Math.abs(vertical ? at(i, ay) - at(i, by) : at(ax, i) - at(bx, i));
    return sum / SIZE;
  };
  let interiorRows = 0;
  let interiorColumns = 0;
  for (let i = 1; i < SIZE - 1; i += 1) {
    interiorRows += diff(0, i, 0, i + 1, true);
    interiorColumns += diff(i, 0, i + 1, 0, false);
  }
  interiorRows /= SIZE - 2;
  interiorColumns /= SIZE - 2;
  const wrapRows = diff(0, SIZE - 1, 0, 0, true);
  const wrapColumns = diff(SIZE - 1, 0, 0, 0, false);
  if (wrapRows > interiorRows * SEAM_TOLERANCE || wrapColumns > interiorColumns * SEAM_TOLERANCE) {
    throw new Error(`${label} does not tile: wrap differences ${wrapRows.toFixed(2)} / ${wrapColumns.toFixed(2)} `
      + `against interior ${interiorRows.toFixed(2)} / ${interiorColumns.toFixed(2)}.`);
  }
}

async function packBark({ id, profile: profileId, mirror = false }) {
  const profile = BARK_PROFILES[profileId];
  if (!profile) throw new Error(`Unknown bark profile ${profileId} for ${id}.`);
  const [diffuse, normal, rough, displacement] = await Promise.all([
    readMap(id, 'Diffuse', 3, { mirror }), readMap(id, 'nor_gl', 3, { mirror, flipGreen: true }),
    readMap(id, 'Rough', 1, { mirror }), readMap(id, 'Displacement', 1, { mirror }),
  ]);
  const pixels = SIZE * SIZE;
  assertTileable(displacement, `${id} displacement`);

  // Tone: the scan's mean linear albedo is moved onto the profile's own, so the
  // bark grade and weathering keep the balance they were tuned against.
  const mean = [0, 0, 0];
  const linear = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels * 3; i += 1) {
    linear[i] = srgbToLinear(diffuse[i]);
    mean[i % 3] += linear[i] / pixels;
  }
  const gain = mean.map((value, channel) => (profile.deep[channel] + profile.high[channel]) / 2 / Math.max(value, 1e-4));
  const low = percentile(displacement, 0.05);
  const high = Math.max(low + 1, percentile(displacement, 0.95));

  const albedoHeight = Buffer.alloc(pixels * 4);
  const normalRoughness = Buffer.alloc(pixels * 4);
  for (let i = 0; i < pixels; i += 1) {
    const height = Math.min(1, Math.max(0, (displacement[i] - low) / (high - low)));
    for (let channel = 0; channel < 3; channel += 1) {
      albedoHeight[i * 4 + channel] = toByte(Math.sqrt(Math.min(1, linear[i * 3 + channel] * gain[channel])));
    }
    albedoHeight[i * 4 + 3] = toByte(height * 0.7 + 0.3);
    normalRoughness[i * 4] = normal[i * 3];
    normalRoughness[i * 4 + 1] = normal[i * 3 + 1];
    normalRoughness[i * 4 + 2] = toByte(Math.max(0.3, rough[i] / 255));
    normalRoughness[i * 4 + 3] = toByte(height);
  }
  const raw = { raw: { width: SIZE, height: SIZE, channels: 4 } };
  await sharp(albedoHeight, raw).png().toFile(path.join(outDir, `${profileId}-albedo-height.png`));
  await sharp(normalRoughness, raw).png().toFile(path.join(outDir, `${profileId}-normal-roughness.png`));
  return albedoHeight;
}

/** The sqrt-encoded albedo is close enough to display encoding to compare by eye. */
function sheetTile(rgba, size) {
  return sharp(Buffer.from(rgba), { raw: { width: size, height: size, channels: 4 } })
    .removeAlpha().resize(SHEET_TILE, SHEET_TILE, { kernel: 'nearest' }).png().toBuffer();
}

async function main() {
  if (!Number.isInteger(SIZE) || SIZE < 64 || SIZE % 2) throw new Error('--size must be an even integer of at least 64.');
  fs.mkdirSync(outDir, { recursive: true });
  const tiles = [];
  for (const [row, bark] of barks.entries()) {
    const scan = await packBark(bark);
    const procedural = createProceduralBarkPixels({ profile: bark.profile });
    tiles.push(
      { input: await sheetTile(procedural.albedoHeight, procedural.resolution), left: 0, top: row * SHEET_TILE },
      { input: await sheetTile(scan, SIZE), left: SHEET_TILE, top: row * SHEET_TILE },
    );
    console.log(`${bark.profile}: ${bark.id} packed at ${SIZE} px.`);
  }
  const sheet = path.join(rootDir, 'tmp', 'trees', 'bark-scans.png');
  fs.mkdirSync(path.dirname(sheet), { recursive: true });
  await sharp({ create: { width: SHEET_TILE * 2, height: SHEET_TILE * barks.length, channels: 3, background: '#000' } })
    .composite(tiles).png().toFile(sheet);
  console.log(`Comparison sheet (procedural | scan): ${path.relative(rootDir, sheet)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
