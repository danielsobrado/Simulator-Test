// Bakes authored grass blade silhouettes into a compact profile manifest.
//
// The authored grass GLBs are alpha cards: their meshes are plain parallel-sided
// ribbons and the blade shape lives entirely in the texture alpha. Drawing them as
// cards is not an option at the density the streamed field runs (144 blades/m²
// against alpha blending), so the shape is lifted out offline instead and the
// runtime rebuilds it on the same 5-triangle strip it already draws.
//
// A card is not always one blade — several of these textures are tufts — so the
// alpha mask is split into connected components and each blade-shaped component
// becomes its own profile. That is what turns a handful of assets into a pool of
// silhouettes worth mixing.
//
//   node scripts/extract-grass-blade-profiles.mjs [--preview]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'public/assets/ground/grass-blade-profiles.json');

// Height samples stored per profile. The runtime resamples this down to whatever
// its segment budget is (3 for the near band, 1 for the far one), so this only has
// to be fine enough to survive that — it is not a per-frame cost.
const SAMPLES = 17;
// Alpha at or above this counts as blade. The cards are authored with hard edges
// and a wide antialiased skirt; a low threshold pulls the skirt into the
// silhouette and fattens every blade.
const ALPHA_THRESHOLD = 110;
// A component has to be this many times taller than it is wide to be a blade.
// Below it the component is a seed head, a flower, or two blades that touch.
const MIN_ASPECT = 2.2;
// ...and this tall relative to the card, or it is debris at the base of a tuft.
const MIN_HEIGHT_FRACTION = 0.22;
// Two profiles closer than this in mean absolute half-width are the same blade.
const DEDUPE_EPSILON = 0.035;
// A sample wider than this multiple of its neighbours is another blade crossing
// this one, not a bulge in this one. See profileFromComponent.
const SPIKE_RATIO = 1.45;
// A grass blade carries its width low and tapers to a point. A silhouette that is
// widest near the top, or that never narrows, is a leaf, a seed head, or two blades
// the labeller could not separate — none of which should end up in the pool.
const MAX_PEAK_HEIGHT = 0.75;
const MAX_TIP_WIDTH = 0.45;

// Which authored assets to harvest. Uncompressed sources only: the runtime copies
// under public/ are meshopt-quantized and gltfpack rewrites the UV rects.
const SOURCES = [
  { id: 'stylized', file: 'assets/extracted/ground/stylized-grass/source-01.glb' },
  { id: 'meadow', file: 'assets/grass/game_ready_grass.glb' },
  { id: 'travushka', file: 'assets/grass/grass.glb' },
  { id: 'tuft', file: 'assets/grass/grass3.glb' },
  { id: 'field', file: 'assets/grass/realistics_grass_06.glb' },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

async function decodeAlpha(texture) {
  const { data, info } = await sharp(Buffer.from(texture.getImage()))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let min = 255;
  let max = 0;
  for (let i = 3; i < data.length; i += info.channels) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }
  return { data, info, hasAlpha: max - min > 40 };
}

/** UV rect of a primitive, plus whether v grows with world height. A card authored
 *  upside down in UV space would otherwise yield every profile tip-down. */
function primitiveUvRect(primitive) {
  const uv = primitive.getAttribute('TEXCOORD_0')?.getArray();
  const position = primitive.getAttribute('POSITION')?.getArray();
  if (!uv || !position) return null;
  const count = uv.length / 2;
  let u0 = Infinity; let u1 = -Infinity; let v0 = Infinity; let v1 = -Infinity;
  let sumY = 0; let sumV = 0;
  for (let i = 0; i < count; i += 1) {
    u0 = Math.min(u0, uv[i * 2]); u1 = Math.max(u1, uv[i * 2]);
    v0 = Math.min(v0, uv[i * 2 + 1]); v1 = Math.max(v1, uv[i * 2 + 1]);
    sumY += position[i * 3 + 1];
    sumV += uv[i * 2 + 1];
  }
  const meanY = sumY / count;
  const meanV = sumV / count;
  let covariance = 0;
  for (let i = 0; i < count; i += 1) {
    covariance += (position[i * 3 + 1] - meanY) * (uv[i * 2 + 1] - meanV);
  }
  return { u0, u1, v0, v1, vRisesWithHeight: covariance >= 0 };
}

/** 8-connected labelling of the thresholded alpha inside the crop. Iterative — a
 *  1024-tall blade would blow a recursive flood fill's stack. */
function labelComponents(mask, width, height) {
  const labels = new Int32Array(width * height).fill(-1);
  const components = [];
  const stack = [];
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || labels[seed] !== -1) continue;
    const id = components.length;
    const pixels = [];
    labels[seed] = id;
    stack.push(seed);
    while (stack.length) {
      const at = stack.pop();
      pixels.push(at);
      const x = at % width;
      const y = (at - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!mask[next] || labels[next] !== -1) continue;
          labels[next] = id;
          stack.push(next);
        }
      }
    }
    components.push(pixels);
  }
  return components;
}

/**
 * Turns one connected component into a normalized blade profile.
 *
 * `halfWidth` is scaled so its maximum is 1 — actual blade width stays under
 * `stylizedSurface.grass.minWidth/maxWidth`, exactly as it was for the generated
 * taper, so swapping profiles changes shape and nothing else. `curve` is the
 * centreline's drift from the base, in units of blade length, which is the part
 * the generated strip has no way to express.
 */
function profileFromComponent(pixels, width, tipAtHigherY) {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const at of pixels) {
    const x = at % width;
    const y = (at - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const bladeHeight = maxY - minY + 1;
  const bladeWidth = maxX - minX + 1;
  if (bladeHeight / bladeWidth < MIN_ASPECT) return null;

  const spans = new Map();
  for (const at of pixels) {
    const x = at % width;
    const y = (at - x) / width;
    const span = spans.get(y);
    if (!span) spans.set(y, { lo: x, hi: x });
    else { span.lo = Math.min(span.lo, x); span.hi = Math.max(span.hi, x); }
  }

  const halfWidth = [];
  const centre = [];
  for (let i = 0; i < SAMPLES; i += 1) {
    const t = i / (SAMPLES - 1);
    // t = 0 is the base. Which pixel row that is depends on how the card is laid
    // out in UV space.
    const row = Math.round(tipAtHigherY ? minY + t * (bladeHeight - 1) : maxY - t * (bladeHeight - 1));
    let span = spans.get(row);
    if (!span) {
      // A hairline tip can miss a sampled row. Borrow the nearest occupied row
      // rather than punching a zero-width hole into the middle of the blade.
      for (let radius = 1; radius <= bladeHeight && !span; radius += 1) {
        span = spans.get(row - radius) ?? spans.get(row + radius);
      }
      if (!span) return null;
    }
    halfWidth.push((span.hi - span.lo + 1) / 2);
    centre.push((span.hi + span.lo) / 2);
  }

  const peak = Math.max(...halfWidth);
  if (peak <= 0) return null;
  if (halfWidth.indexOf(peak) / (SAMPLES - 1) > MAX_PEAK_HEIGHT) return null;
  if (halfWidth[SAMPLES - 1] / peak > MAX_TIP_WIDTH) return null;

  // Several of these cards are tufts whose blades cross, so one connected
  // component can span three blades and the crossing shows up as a single row
  // several times wider than the blade around it. A real blade tapers smoothly, so
  // reject any silhouette that spikes against its own neighbours rather than
  // baking a T-shaped "blade".
  for (let i = 1; i < SAMPLES - 1; i += 1) {
    const neighbours = Math.max(halfWidth[i - 1], halfWidth[i + 1]);
    if (halfWidth[i] > neighbours * SPIKE_RATIO) return null;
  }

  const baseCentre = centre[0];
  return {
    halfWidth: halfWidth.map((value) => round(value / peak)),
    curve: centre.map((value) => round((value - baseCentre) / bladeHeight)),
    aspect: round((peak * 2) / bladeHeight),
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function isDuplicate(profile, accepted) {
  return accepted.some((other) => {
    let error = 0;
    for (let i = 0; i < SAMPLES; i += 1) {
      error += Math.abs(profile.halfWidth[i] - other.halfWidth[i])
        + Math.abs(profile.curve[i] - other.curve[i]);
    }
    return error / SAMPLES < DEDUPE_EPSILON;
  });
}

/** ASCII silhouette for eyeballing an extraction. `halfWidth` is in units of the
 *  blade's own peak half-width and `curve` is in units of blade length, so both are
 *  converted to blade lengths before drawing or the arc reads far too strong. */
function previewProfile(profile) {
  const columns = 40;
  const half = profile.halfWidth.map((value) => (value * profile.aspect) / 2);
  const extent = Math.max(...half.map((h, i) => Math.abs(profile.curve[i]) + h));
  const scale = columns / Math.max(extent * 2.2, 0.001);
  const lines = [];
  for (let i = SAMPLES - 1; i >= 0; i -= 1) {
    const centre = columns / 2 + profile.curve[i] * scale;
    const lo = Math.round(centre - half[i] * scale);
    const hi = Math.round(centre + half[i] * scale);
    lines.push(`    t=${(i / (SAMPLES - 1)).toFixed(2)} ${' '.repeat(Math.max(0, lo))}${'#'.repeat(Math.max(1, hi - lo))}`);
  }
  return lines.join('\n');
}

async function extractSource(source, preview) {
  const file = path.join(ROOT, source.file);
  if (!fs.existsSync(file)) throw new Error(`Missing grass source ${source.file}`);
  const document = await io.read(file);
  const root = document.getRoot();

  const alphaByTexture = new Map();
  for (const texture of root.listTextures()) {
    alphaByTexture.set(texture, await decodeAlpha(texture));
  }

  const profiles = [];
  const seenRects = new Set();
  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const rect = primitiveUvRect(primitive);
      if (!rect) continue;
      const rectKey = [rect.u0, rect.u1, rect.v0, rect.v1].map((v) => v.toFixed(4)).join(',');
      if (seenRects.has(rectKey)) continue;
      seenRects.add(rectKey);

      const texture = primitive.getMaterial()?.getBaseColorTexture();
      // The base colour map is often fully opaque and the silhouette lives on a
      // second image, so fall back to whichever texture actually carries alpha.
      const candidates = [texture, ...root.listTextures()].filter(Boolean);
      const alpha = candidates.map((t) => alphaByTexture.get(t)).find((a) => a?.hasAlpha);
      if (!alpha) continue;

      const { data, info } = alpha;
      const x0 = Math.max(0, Math.floor(rect.u0 * info.width));
      const x1 = Math.min(info.width - 1, Math.ceil(rect.u1 * info.width));
      const y0 = Math.max(0, Math.floor(rect.v0 * info.height));
      const y1 = Math.min(info.height - 1, Math.ceil(rect.v1 * info.height));
      const width = x1 - x0 + 1;
      const height = y1 - y0 + 1;
      if (width < 4 || height < 16) continue;

      const mask = new Uint8Array(width * height);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const at = ((y0 + y) * info.width + (x0 + x)) * info.channels + 3;
          mask[y * width + x] = data[at] >= ALPHA_THRESHOLD ? 1 : 0;
        }
      }

      // glTF v grows downward in image space: v = 0 is pixel row 0. So a card whose
      // v rises with world height has its base at the top of the crop and its tip
      // at the bottom — the higher pixel row.
      const tipAtHigherY = rect.vRisesWithHeight;
      for (const pixels of labelComponents(mask, width, height)) {
        let minY = Infinity; let maxY = -Infinity;
        for (const at of pixels) {
          const y = Math.floor(at / width);
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        if ((maxY - minY + 1) / height < MIN_HEIGHT_FRACTION) continue;
        const profile = profileFromComponent(pixels, width, tipAtHigherY);
        if (!profile || isDuplicate(profile, profiles)) continue;
        profiles.push({
          id: `${source.id}-${String(profiles.length + 1).padStart(2, '0')}`,
          source: source.file,
          mesh: mesh.getName(),
          ...profile,
        });
      }
    }
  }
  if (preview) {
    for (const profile of profiles) {
      console.log(`\n  ${profile.id}  (${profile.mesh}) aspect=${profile.aspect}`);
      console.log(previewProfile(profile));
    }
  }
  return profiles;
}

const preview = process.argv.includes('--preview');
const profiles = [];
for (const source of SOURCES) {
  const extracted = await extractSource(source, preview);
  console.log(`${source.file} -> ${extracted.length} profile(s)`);
  profiles.push(...extracted);
}

if (profiles.length === 0) throw new Error('No grass blade profiles were extracted.');

fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, `${JSON.stringify({
  version: 1,
  generatedBy: 'scripts/extract-grass-blade-profiles.mjs',
  samples: SAMPLES,
  profiles,
}, null, 2)}\n`);
console.log(`\nWrote ${profiles.length} profiles to ${path.relative(ROOT, OUTPUT)}`);
