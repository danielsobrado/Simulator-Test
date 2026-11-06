#!/usr/bin/env node
/**
 * Fetches the CC0 surface textures settlements are dressed in.
 *
 * Every set in `SETTLEMENT_SURFACE_SETS` comes from Poly Haven
 * (https://polyhaven.com, CC0 1.0 Universal): colour, OpenGL normal and the
 * packed AO/roughness/metalness map, taken at 1K. By default a set is reduced
 * to 512 px WebP and its colour softened by a median pass, to sit with the
 * painted grass. Sets a walker sees from a stride away — building surfaces and
 * street cobbles — keep 1K colour and normals (`size`), softened by a wider
 * median at that resolution (`median`); their packed map stays at 512 px, where
 * roughness and occlusion lose nothing. Outputs land in
 * `public/assets/textures/settlement/<set>-{color,normal,arm}.webp`; the
 * sources are listed in THIRD_PARTY_NOTICES.md.
 *
 * Usage: npm run fetch:settlement-textures [-- --out <dir>] [-- --only a,b]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { SETTLEMENT_SURFACE_SETS } from '../src/editor/world/settlements/surfaces/SettlementDressing.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 512;

const MAPS = Object.freeze({ color: 'Diffuse', normal: 'nor_gl', arm: 'arm' });
/** Window, in texels, of the median that flattens photographic grain in colour maps. */
const PAINTERLY_MEDIAN = 5;
/** Colour is pushed a little past the photograph, toward the saturated world round it. */
const PAINTERLY_SATURATION = 1.18;

function option(flag) {
  const index = process.argv.indexOf(flag);
  return index < 0 ? null : process.argv[index + 1];
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
}

async function fetchSurface(name, assetId, outDir, {
  neutralMean = 0, saturation = PAINTERLY_SATURATION, brightness = 1, contrast = 1, size = SIZE, median = PAINTERLY_MEDIAN,
} = {}) {
  const files = JSON.parse((await download(`https://api.polyhaven.com/files/${assetId}`)).toString('utf8'));
  for (const [suffix, map] of Object.entries(MAPS)) {
    const url = files[map]?.['1k']?.jpg?.url;
    if (!url) throw new Error(`Poly Haven asset ${assetId} has no 1K ${map} map.`);
    const output = path.join(outDir, `${name}-${suffix}.webp`);
    const side = suffix === 'arm' ? Math.min(size, SIZE) : size;
    let image = sharp(await download(url)).resize(side, side, { kernel: 'lanczos3' });
    // The world's grass and trees are painted, not photographed. A median pass
    // takes the camera grain out of a surface and keeps its shapes — stones stay
    // stones, the speckle between them goes — so paving sits in the same picture.
    if (suffix === 'color' && median > 0) image = image.median(median);
    // A surface its material tints is stored neutral at a fixed mean brightness,
    // so the tint lands as authored instead of a shade darker.
    if (suffix === 'color' && neutralMean > 0) {
      const { channels } = await image.clone().greyscale().stats();
      // `contrast` below 1 flattens the surface toward its mean: gain about the mean, not about black.
      const gain = neutralMean / channels[0].mean * contrast;
      image = image.greyscale().linear(gain, neutralMean * (1 - contrast)).toColourspace('srgb');
    } else if (suffix === 'color') {
      image = image.modulate({ saturation, brightness });
    }
    await image
      // Normals and packed data must not be chroma-smeared into their neighbours.
      .webp(suffix === 'color' ? { quality: 88 } : { quality: 92, smartSubsample: false })
      .toFile(output);
    console.log(`${path.relative(rootDir, output)}  ←  ${assetId} ${map}`);
  }
}

const outDir = path.resolve(rootDir, option('--out') ?? 'public/assets/textures/settlement');
const only = option('--only')?.split(',');
const extra = option('--asset');
fs.mkdirSync(outDir, { recursive: true });
const entries = extra
  ? extra.split(',').map((id) => [id, { source: id }])
  : Object.entries(SETTLEMENT_SURFACE_SETS).filter(([name, set]) => set.source && (!only || only.includes(name)));
for (const [name, set] of entries) await fetchSurface(name, set.source, outDir, set);
