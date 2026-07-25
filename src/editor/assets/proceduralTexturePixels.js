/**
 * Dependency-free procedural surface synthesis.
 *
 * Every generator is deterministic and seamlessly tileable: the lattice noise
 * wraps on integer periods, so a texture drawn with repeat wrapping never shows
 * a seam. Nothing here imports three, which keeps the pixel math unit testable
 * under `node --test`.
 */

const DEFAULT_TEXTURE_SIZE = 256;
const WORLEY = new Float64Array(3);

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function lerp(from, to, ratio) {
  return from + (to - from) * ratio;
}

function fract(value) {
  return value - Math.floor(value);
}

function smoothstep(edge0, edge1, value) {
  const ratio = clamp01((value - edge0) / (edge1 - edge0));
  return ratio * ratio * (3 - 2 * ratio);
}

function toByte(value) {
  return Math.round(clamp01(value) * 255);
}

function rgb(hexColor) {
  const value = hexColor.replace('#', '');
  return Object.freeze([
    Number.parseInt(value.slice(0, 2), 16) / 255,
    Number.parseInt(value.slice(2, 4), 16) / 255,
    Number.parseInt(value.slice(4, 6), 16) / 255,
  ]);
}

function mixInto(out, from, to, ratio) {
  out[0] = lerp(from[0], to[0], ratio);
  out[1] = lerp(from[1], to[1], ratio);
  out[2] = lerp(from[2], to[2], ratio);
}

function scaleColor(out, factor) {
  out[0] *= factor;
  out[1] *= factor;
  out[2] *= factor;
}

function hashUnit(x, y, seed) {
  let hash = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1);
  hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

function wrapIndex(value, period) {
  return ((value % period) + period) % period;
}

/** Value noise on a lattice that wraps every `periodX` × `periodY` cells. */
function valueNoise(x, y, periodX, periodY, seed) {
  const xInteger = Math.floor(x);
  const yInteger = Math.floor(y);
  const xFraction = x - xInteger;
  const yFraction = y - yInteger;
  const xBlend = xFraction * xFraction * (3 - 2 * xFraction);
  const yBlend = yFraction * yFraction * (3 - 2 * yFraction);

  const x0 = wrapIndex(xInteger, periodX);
  const y0 = wrapIndex(yInteger, periodY);
  const x1 = wrapIndex(xInteger + 1, periodX);
  const y1 = wrapIndex(yInteger + 1, periodY);

  const bottom = lerp(hashUnit(x0, y0, seed), hashUnit(x1, y0, seed), xBlend);
  const top = lerp(hashUnit(x0, y1, seed), hashUnit(x1, y1, seed), xBlend);
  return lerp(bottom, top, yBlend);
}

/** Fractal value noise with independent horizontal and vertical frequencies. */
function fbm(u, v, frequencyX, frequencyY, octaves, seed) {
  let amplitude = 1;
  let total = 0;
  let normalization = 0;
  let periodX = frequencyX;
  let periodY = frequencyY;

  for (let octave = 0; octave < octaves; octave += 1) {
    total += amplitude * valueNoise(u * periodX, v * periodY, periodX, periodY, seed + octave * 131);
    normalization += amplitude;
    amplitude *= 0.5;
    periodX *= 2;
    periodY *= 2;
  }
  return total / normalization;
}

/** Cellular noise. Fills WORLEY with the nearest distance, the second, and a cell hash. */
function worley(u, v, cells, seed) {
  const x = u * cells;
  const y = v * cells;
  const xCell = Math.floor(x);
  const yCell = Math.floor(y);
  let nearest = Number.POSITIVE_INFINITY;
  let second = Number.POSITIVE_INFINITY;
  let nearestX = 0;
  let nearestY = 0;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const cellX = xCell + offsetX;
      const cellY = yCell + offsetY;
      const wrappedX = wrapIndex(cellX, cells);
      const wrappedY = wrapIndex(cellY, cells);
      const deltaX = cellX + hashUnit(wrappedX, wrappedY, seed) - x;
      const deltaY = cellY + hashUnit(wrappedX, wrappedY, seed + 7919) - y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      if (distance < nearest) {
        second = nearest;
        nearest = distance;
        nearestX = wrappedX;
        nearestY = wrappedY;
      } else if (distance < second) {
        second = distance;
      }
    }
  }

  WORLEY[0] = nearest;
  WORLEY[1] = second;
  WORLEY[2] = hashUnit(nearestX, nearestY, seed + 3331);
}

const PLASTER_LIGHT = rgb('#e9dfc8');
const PLASTER_DARK = rgb('#bda587');
const TIMBER_LIGHT = rgb('#7a5433');
const TIMBER_DARK = rgb('#3b2717');
const PLANK_LIGHT = rgb('#b08650');
const PLANK_DARK = rgb('#6a4626');
const THATCH_LIGHT = rgb('#dcb75f');
const THATCH_DARK = rgb('#7c5c26');
const TILE_LIGHT = rgb('#c4633c');
const TILE_DARK = rgb('#6e2f1e');
const SHINGLE_LIGHT = rgb('#8f7f6a');
const SHINGLE_DARK = rgb('#4a3d31');
const STONE_LIGHT = rgb('#b9b7ad');
const STONE_DARK = rgb('#77746c');
const MORTAR = rgb('#8d8a80');
const BARK_LIGHT = rgb('#8a6b45');
const BARK_DARK = rgb('#33241a');
const LEAF_LIGHT = rgb('#79ab3f');
const LEAF_DARK = rgb('#1f4225');
const NEEDLE_LIGHT = rgb('#4e8a4c');
const NEEDLE_DARK = rgb('#16301f');
const SOIL_LIGHT = rgb('#8d6a45');
const SOIL_DARK = rgb('#4a3524');
const CROP_LIGHT = rgb('#e0c25c');
const CROP_DARK = rgb('#8a6a24');
const IRON_LIGHT = rgb('#8e949b');
const IRON_DARK = rgb('#33383d');
const GLASS_LIGHT = rgb('#cfe8f4');
const GLASS_DARK = rgb('#6f9fb5');
const LEAD = rgb('#43474b');
const FABRIC_LIGHT = rgb('#e4d8bd');
const FABRIC_ACCENT = rgb('#a8402f');
const BRONZE_LIGHT = rgb('#c08c3e');
const BRONZE_DARK = rgb('#5d3f1c');
const VERDIGRIS = rgb('#4e9d81');
const WATER_DEEP = rgb('#1f6f8f');
const WATER_LIGHT = rgb('#7fd0e4');
const GRANITE_LIGHT = rgb('#a9a49c');
const GRANITE_DARK = rgb('#4f4b46');
const EMBER_HOT = rgb('#ffd47a');
const EMBER_COOL = rgb('#7e2110');

function generatePlaster(u, v, seed, out) {
  const grain = fbm(u, v, 6, 6, 4, seed);
  const fine = fbm(u, v, 24, 24, 3, seed + 13);
  const pit = smoothstep(0.66, 0.84, fbm(u, v, 14, 14, 3, seed + 29));

  mixInto(out, PLASTER_DARK, PLASTER_LIGHT, clamp01(grain * 0.7 + fine * 0.3));
  scaleColor(out, 0.86 + fine * 0.14 - pit * 0.22);
  out[3] = clamp01(grain * 0.5 + fine * 0.5 - pit * 0.7);
  out[4] = 0.85 + fine * 0.1;
}

function generateTimber(u, v, seed, out) {
  const warp = fbm(u, v, 2, 6, 3, seed) - 0.5;
  const rings = fract(v * 9 + warp * 2.4);
  const band = Math.abs(rings - 0.5) * 2;
  const fibre = fbm(u, v, 40, 5, 3, seed + 31);
  worley(u, v, 3, seed + 51);
  const knot = 1 - smoothstep(0.05, 0.19, WORLEY[0]);

  mixInto(out, TIMBER_DARK, TIMBER_LIGHT, clamp01(band * 0.6 + fibre * 0.4));
  scaleColor(out, 0.82 + fibre * 0.2 - knot * 0.35);
  out[3] = clamp01(band * 0.45 + fibre * 0.35 - knot * 0.6);
  out[4] = 0.7 + fibre * 0.14;
}

function generatePlank(u, v, seed, out) {
  const boards = 5;
  const row = v * boards;
  const index = wrapIndex(Math.floor(row), boards);
  const rowFraction = fract(row);
  const seam = smoothstep(0, 0.04, rowFraction) * smoothstep(1, 0.96, rowFraction);
  const tint = hashUnit(index, 3, seed);
  const warp = fbm(u, v, 3, 8, 3, seed + index * 17);
  const rings = Math.abs(fract(v * boards * 3 + warp * 1.6) - 0.5) * 2;
  const fibre = fbm(u, v, 48, 6, 3, seed + index * 29);

  mixInto(out, PLANK_DARK, PLANK_LIGHT, clamp01(rings * 0.5 + fibre * 0.3 + tint * 0.2));
  scaleColor(out, (0.78 + tint * 0.22) * (0.4 + seam * 0.6));
  out[3] = clamp01(seam * 0.72 + rings * 0.18 + fibre * 0.1);
  out[4] = 0.76 + fibre * 0.14;
}

function generateThatch(u, v, seed, out) {
  const bundles = 6;
  const row = v * bundles;
  const index = wrapIndex(Math.floor(row), bundles);
  const rowFraction = fract(row);
  const warp = fbm(u, v, 5, 3, 3, seed);
  const strand = Math.abs(fract(u * 70 + warp * 4 + index * 0.37) - 0.5) * 2;
  const overlap = smoothstep(0, 0.26, rowFraction);
  const fuzz = fbm(u, v, 60, 24, 3, seed + 11);

  mixInto(out, THATCH_DARK, THATCH_LIGHT, clamp01(strand * 0.55 + fuzz * 0.45));
  scaleColor(out, 0.58 + overlap * 0.42);
  out[3] = clamp01(strand * 0.42 + overlap * 0.42 + fuzz * 0.16);
  out[4] = 0.92 + fuzz * 0.06;
}

function generateRoofTile(u, v, seed, out) {
  const rows = 8;
  const columns = 9;
  const row = v * rows;
  const rowIndex = wrapIndex(Math.floor(row), rows);
  const rowFraction = fract(row);
  const stagger = (rowIndex % 2) * 0.5;
  const column = u * columns + stagger;
  const columnIndex = wrapIndex(Math.floor(column), columns);
  const columnFraction = fract(column);

  const barrel = Math.sin(columnFraction * Math.PI);
  const gap = smoothstep(0, 0.05, columnFraction) * smoothstep(1, 0.95, columnFraction);
  const lip = smoothstep(0, 0.18, rowFraction);
  const tint = hashUnit(columnIndex, rowIndex, seed);
  const grit = fbm(u, v, 40, 40, 3, seed + 5);

  mixInto(out, TILE_DARK, TILE_LIGHT, clamp01(barrel * 0.55 + tint * 0.3 + grit * 0.15));
  scaleColor(out, (0.86 + tint * 0.14) * (0.52 + lip * 0.48));
  out[3] = clamp01(barrel * gap * 0.62 + lip * 0.28 + grit * 0.1);
  out[4] = 0.8 + grit * 0.12;
}

function generateShingle(u, v, seed, out) {
  const rows = 10;
  const columns = 7;
  const row = v * rows;
  const rowIndex = wrapIndex(Math.floor(row), rows);
  const rowFraction = fract(row);
  const stagger = (rowIndex % 2) * 0.5;
  const column = u * columns + stagger;
  const columnIndex = wrapIndex(Math.floor(column), columns);
  const columnFraction = fract(column);

  const gap = smoothstep(0, 0.035, columnFraction) * smoothstep(1, 0.965, columnFraction);
  const lip = smoothstep(0, 0.22, rowFraction);
  const tint = hashUnit(columnIndex, rowIndex, seed);
  const fibre = fbm(u, v, 46, 12, 3, seed + 19);

  mixInto(out, SHINGLE_DARK, SHINGLE_LIGHT, clamp01(tint * 0.55 + fibre * 0.45));
  scaleColor(out, (0.78 + tint * 0.22) * (0.5 + lip * 0.5) * (0.55 + gap * 0.45));
  out[3] = clamp01(gap * lip * 0.7 + fibre * 0.16);
  out[4] = 0.82 + fibre * 0.12;
}

function generateStoneBlock(u, v, seed, out) {
  const courses = 6;
  const blocks = 4;
  const course = v * courses;
  const courseIndex = wrapIndex(Math.floor(course), courses);
  const courseFraction = fract(course);
  const stagger = (courseIndex % 2) * 0.5;
  const block = u * blocks + stagger;
  const blockIndex = wrapIndex(Math.floor(block), blocks);
  const blockFraction = fract(block);

  const jointX = smoothstep(0, 0.045, blockFraction) * smoothstep(1, 0.955, blockFraction);
  const jointY = smoothstep(0, 0.06, courseFraction) * smoothstep(1, 0.94, courseFraction);
  const face = jointX * jointY;
  const tint = hashUnit(blockIndex, courseIndex, seed);
  const speckle = fbm(u, v, 48, 48, 3, seed + 17);
  const wear = fbm(u, v, 8, 8, 4, seed + 23);

  mixInto(out, STONE_DARK, STONE_LIGHT, clamp01(tint * 0.6 + wear * 0.4));
  mixInto(out, MORTAR, out, face);
  scaleColor(out, 0.82 + speckle * 0.2 - wear * 0.08);
  out[3] = clamp01(face * (0.72 + wear * 0.22) + speckle * 0.08);
  out[4] = lerp(0.95, 0.85 + speckle * 0.1, face);
}

function generateRubble(u, v, seed, out) {
  worley(u, v, 6, seed);
  const edge = smoothstep(0.015, 0.1, WORLEY[1] - WORLEY[0]);
  const dome = 1 - smoothstep(0.14, 0.62, WORLEY[0]);
  const cell = WORLEY[2];
  const grit = fbm(u, v, 36, 36, 3, seed + 9);

  mixInto(out, STONE_DARK, STONE_LIGHT, clamp01(cell * 0.7 + grit * 0.3));
  mixInto(out, MORTAR, out, edge);
  scaleColor(out, 0.72 + dome * 0.22 + grit * 0.12);
  out[3] = clamp01(edge * (0.32 + dome * 0.56) + grit * 0.1);
  out[4] = lerp(0.96, 0.86 + grit * 0.08, edge);
}

function generateBark(u, v, seed, out) {
  const ridge = 1 - Math.abs(fbm(u, v, 9, 2, 4, seed) * 2 - 1);
  const fine = fbm(u, v, 48, 8, 3, seed + 19);
  const crack = smoothstep(0.42, 0, ridge);

  mixInto(out, BARK_DARK, BARK_LIGHT, clamp01(ridge * 0.7 + fine * 0.3));
  scaleColor(out, 0.78 + fine * 0.22 - crack * 0.34);
  out[3] = clamp01(ridge * 0.72 + fine * 0.16 - crack * 0.4);
  out[4] = 0.88 + fine * 0.1;
}

function generateFoliage(u, v, seed, out) {
  worley(u, v, 9, seed);
  const leaf = 1 - smoothstep(0.12, 0.6, WORLEY[0]);
  const cell = WORLEY[2];
  const cluster = fbm(u, v, 5, 5, 3, seed + 3);
  const speckle = fbm(u, v, 40, 40, 2, seed + 27);

  mixInto(out, LEAF_DARK, LEAF_LIGHT, clamp01(leaf * 0.5 + cell * 0.3 + cluster * 0.2));
  scaleColor(out, 0.66 + leaf * 0.24 + speckle * 0.14);
  out[3] = clamp01(leaf * 0.7 + speckle * 0.16);
  out[4] = 0.84 + speckle * 0.1;
}

function generateNeedles(u, v, seed, out) {
  const warp = fbm(u, v, 4, 4, 3, seed);
  const lines = Math.abs(fract(u * 64 + warp * 5) - 0.5) * 2;
  const rows = Math.abs(fract(v * 26 + warp * 2) - 0.5) * 2;
  const speckle = fbm(u, v, 56, 28, 3, seed + 13);

  mixInto(out, NEEDLE_DARK, NEEDLE_LIGHT, clamp01(lines * 0.45 + rows * 0.25 + speckle * 0.3));
  scaleColor(out, 0.7 + lines * 0.2 + speckle * 0.14);
  out[3] = clamp01(lines * 0.5 + rows * 0.3 + speckle * 0.2);
  out[4] = 0.86 + speckle * 0.08;
}

function generateSoil(u, v, seed, out) {
  worley(u, v, 10, seed);
  const clod = 1 - smoothstep(0.1, 0.55, WORLEY[0]);
  const cell = WORLEY[2];
  const grain = fbm(u, v, 26, 26, 4, seed + 7);
  const damp = smoothstep(0.42, 0.72, fbm(u, v, 6, 6, 3, seed + 37));

  mixInto(out, SOIL_DARK, SOIL_LIGHT, clamp01(cell * 0.45 + grain * 0.55));
  scaleColor(out, 0.74 + clod * 0.2 + grain * 0.14 - damp * 0.18);
  out[3] = clamp01(clod * 0.6 + grain * 0.3);
  out[4] = 0.93 + grain * 0.06;
}

function generateCrop(u, v, seed, out) {
  const rows = 10;
  const row = v * rows;
  const rowFraction = fract(row);
  const furrow = Math.abs(rowFraction - 0.5) * 2;
  const warp = fbm(u, v, 4, 4, 2, seed);
  const stalk = Math.abs(fract(u * 72 + warp * 4) - 0.5) * 2;
  const dry = fbm(u, v, 12, 12, 3, seed + 7);

  mixInto(out, CROP_DARK, CROP_LIGHT, clamp01(stalk * 0.45 + furrow * 0.25 + dry * 0.3));
  scaleColor(out, 0.72 + furrow * 0.22 + stalk * 0.14);
  out[3] = clamp01(furrow * 0.42 + stalk * 0.34 + dry * 0.12);
  out[4] = 0.9 + dry * 0.08;
}

function generateIron(u, v, seed, out) {
  worley(u, v, 14, seed);
  const pit = 1 - smoothstep(0, 0.22, WORLEY[0]);
  const grime = fbm(u, v, 20, 20, 4, seed + 3);
  const scratch = Math.abs(fract(u * 30 + fbm(u, v, 3, 3, 2, seed) * 3) - 0.5) * 2;

  mixInto(out, IRON_DARK, IRON_LIGHT, clamp01(grime * 0.6 + scratch * 0.4));
  scaleColor(out, 0.72 + grime * 0.24 - pit * 0.28);
  out[3] = clamp01(0.55 + grime * 0.3 - pit * 0.6);
  out[4] = 0.38 + grime * 0.24 + pit * 0.24;
}

function generateWindow(u, v, seed, out) {
  const panes = 3;
  const paneX = fract(u * panes);
  const paneY = fract(v * panes);
  const inside = smoothstep(0, 0.09, paneX) * smoothstep(1, 0.91, paneX)
    * smoothstep(0, 0.09, paneY) * smoothstep(1, 0.91, paneY);
  const ripple = fbm(u, v, 10, 10, 3, seed);

  mixInto(out, GLASS_DARK, GLASS_LIGHT, clamp01(ripple * 0.6 + 0.3));
  mixInto(out, LEAD, out, inside);
  scaleColor(out, 0.85 + ripple * 0.2);
  out[3] = clamp01((1 - inside) * 0.6 + ripple * 0.12);
  out[4] = lerp(0.72, 0.08 + ripple * 0.08, inside);
}

function generateFabric(u, v, seed, out) {
  const threads = 24;
  const threadX = fract(u * threads);
  const threadY = fract(v * threads);
  const over = (Math.floor(u * threads) + Math.floor(v * threads)) % 2 === 0;
  const weave = over
    ? 1 - Math.abs(threadX - 0.5) * 2
    : 1 - Math.abs(threadY - 0.5) * 2;
  const stripe = Math.floor(u * 6) % 2 === 0 ? 0 : 1;
  const fuzz = fbm(u, v, 60, 60, 2, seed);

  mixInto(out, FABRIC_LIGHT, FABRIC_ACCENT, stripe);
  scaleColor(out, 0.74 + weave * 0.24 + fuzz * 0.12);
  out[3] = clamp01(weave * 0.55 + fuzz * 0.14);
  out[4] = 0.9 + fuzz * 0.08;
}

function generateBronze(u, v, seed, out) {
  const patina = smoothstep(0.48, 0.78, fbm(u, v, 7, 7, 4, seed));
  const grime = fbm(u, v, 26, 26, 3, seed + 11);

  mixInto(out, BRONZE_DARK, BRONZE_LIGHT, clamp01(grime * 0.7 + 0.2));
  mixInto(out, out, VERDIGRIS, patina * 0.78);
  scaleColor(out, 0.8 + grime * 0.24);
  out[3] = clamp01(patina * 0.3 + grime * 0.2);
  out[4] = 0.3 + patina * 0.46 + grime * 0.12;
}

function generateWater(u, v, seed, out) {
  const swell = fbm(u, v, 5, 5, 4, seed);
  const detail = fbm(u + swell * 0.2, v - swell * 0.15, 9, 9, 3, seed + 5);
  const ripple = Math.abs(fract((swell * 2 + detail * 3) * 2) - 0.5) * 2;

  mixInto(out, WATER_DEEP, WATER_LIGHT, clamp01(ripple * 0.55 + detail * 0.35));
  scaleColor(out, 0.82 + ripple * 0.22);
  out[3] = clamp01(ripple * 0.4 + detail * 0.24);
  out[4] = 0.08 + ripple * 0.08;
}

function generateGranite(u, v, seed, out) {
  const speckle = fbm(u, v, 64, 64, 2, seed);
  const feldspar = smoothstep(0.56, 0.72, fbm(u, v, 30, 30, 3, seed + 9));
  const vein = smoothstep(0.47, 0.53, fbm(u, v, 6, 6, 4, seed + 21));
  worley(u, v, 8, seed + 3);
  const chip = 1 - smoothstep(0.1, 0.42, WORLEY[0]);

  mixInto(out, GRANITE_DARK, GRANITE_LIGHT, clamp01(speckle * 0.55 + vein * 0.3 + feldspar * 0.35));
  scaleColor(out, 0.78 + speckle * 0.24 + feldspar * 0.14);
  out[3] = clamp01(speckle * 0.34 + chip * 0.42 + vein * 0.14);
  out[4] = 0.84 + speckle * 0.12;
}

function generateEmber(u, v, seed, out) {
  const flame = fbm(u, v, 6, 10, 4, seed);
  const hot = smoothstep(0.34, 0.76, flame);
  const flicker = fbm(u, v, 22, 30, 3, seed + 15);

  mixInto(out, EMBER_COOL, EMBER_HOT, clamp01(hot * 0.75 + flicker * 0.25));
  scaleColor(out, 0.7 + hot * 0.34);
  out[3] = clamp01(flame * 0.4 + flicker * 0.2);
  out[4] = 0.58 + flicker * 0.16;
}

const GENERATORS = Object.freeze({
  plaster: generatePlaster,
  timber: generateTimber,
  plank: generatePlank,
  thatch: generateThatch,
  roofTile: generateRoofTile,
  shingle: generateShingle,
  stoneBlock: generateStoneBlock,
  rubble: generateRubble,
  bark: generateBark,
  foliage: generateFoliage,
  needles: generateNeedles,
  soil: generateSoil,
  crop: generateCrop,
  iron: generateIron,
  window: generateWindow,
  fabric: generateFabric,
  bronze: generateBronze,
  water: generateWater,
  granite: generateGranite,
  ember: generateEmber,
});

/**
 * Per-surface shading metadata.
 *
 * `density` is texture repeats per world unit, so a part scales its UVs by its
 * own size and every object keeps a consistent texel density. `relief` drives
 * how strongly the baked height field bends the generated normal map.
 */
export const SURFACE_PROPERTIES = Object.freeze({
  plaster: Object.freeze({ color: '#e0d3b8', metalness: 0, normalStrength: 0.8, relief: 2.2, density: 0.5, seed: 11 }),
  timber: Object.freeze({ color: '#6d4a2c', metalness: 0, normalStrength: 1, relief: 2.6, density: 0.7, seed: 23 }),
  plank: Object.freeze({ color: '#9c7748', metalness: 0, normalStrength: 1, relief: 2.8, density: 0.6, seed: 37 }),
  thatch: Object.freeze({ color: '#c9a253', metalness: 0, normalStrength: 1.35, relief: 3.4, density: 0.55, seed: 41 }),
  roofTile: Object.freeze({ color: '#b0553a', metalness: 0, normalStrength: 1.2, relief: 3, density: 0.5, seed: 53 }),
  shingle: Object.freeze({ color: '#7d6d5a', metalness: 0, normalStrength: 1.15, relief: 3, density: 0.6, seed: 59 }),
  stoneBlock: Object.freeze({ color: '#a8a69c', metalness: 0, normalStrength: 1.25, relief: 3.2, density: 0.35, seed: 67 }),
  rubble: Object.freeze({ color: '#9d9a90', metalness: 0, normalStrength: 1.3, relief: 3.4, density: 0.45, seed: 71 }),
  bark: Object.freeze({ color: '#6b4a30', metalness: 0, normalStrength: 1.3, relief: 3.2, density: 0.8, seed: 83 }),
  foliage: Object.freeze({ color: '#4f8438', metalness: 0, normalStrength: 1, relief: 2.6, density: 0.7, seed: 89 }),
  needles: Object.freeze({ color: '#2f6b3d', metalness: 0, normalStrength: 0.9, relief: 2.4, density: 0.9, seed: 97 }),
  soil: Object.freeze({ color: '#6f523a', metalness: 0, normalStrength: 1.1, relief: 2.8, density: 0.4, seed: 101 }),
  crop: Object.freeze({ color: '#c9a747', metalness: 0, normalStrength: 1, relief: 2.6, density: 0.5, seed: 103 }),
  iron: Object.freeze({ color: '#6f757c', metalness: 0.82, normalStrength: 0.7, relief: 2, density: 1.2, seed: 107 }),
  window: Object.freeze({
    color: '#cfe6f2',
    metalness: 0,
    normalStrength: 0.5,
    relief: 1.6,
    density: 1,
    seed: 109,
    emissive: '#ffb45c',
    emissiveIntensity: 0.5,
  }),
  fabric: Object.freeze({ color: '#d9cbaf', metalness: 0, normalStrength: 0.75, relief: 2, density: 0.8, seed: 113 }),
  bronze: Object.freeze({ color: '#a8792f', metalness: 0.85, normalStrength: 0.8, relief: 2.2, density: 0.8, seed: 127 }),
  water: Object.freeze({ color: '#4fa8c8', metalness: 0.15, normalStrength: 0.6, relief: 1.8, density: 0.5, seed: 131 }),
  granite: Object.freeze({ color: '#8f8b83', metalness: 0, normalStrength: 1.2, relief: 3, density: 0.7, seed: 137 }),
  ember: Object.freeze({
    color: '#ff9a3c',
    metalness: 0,
    normalStrength: 0.6,
    relief: 1.6,
    density: 1.5,
    seed: 139,
    emissive: '#ff6a1e',
    emissiveIntensity: 2.4,
  }),
});

export const SURFACE_KINDS = Object.freeze(Object.keys(GENERATORS));

/**
 * Evaluates one surface sample as `[red, green, blue, height, roughness]`.
 *
 * Exposed so tests can assert the generators are exactly periodic over one UV
 * tile, which is what makes the baked textures seam free under repeat wrapping.
 */
export function sampleSurface(kind, u, v, seed) {
  const generate = GENERATORS[kind];
  if (!generate) {
    throw new Error(`Unknown procedural surface kind: ${kind}.`);
  }
  const sample = new Float64Array(5);
  generate(u, v, seed ?? SURFACE_PROPERTIES[kind].seed, sample);
  return Array.from(sample);
}

function createNormalPixels(heights, size, relief) {
  const normal = new Uint8Array(size * size * 4);
  const scale = relief * (size / 128);

  for (let y = 0; y < size; y += 1) {
    const north = wrapIndex(y - 1, size) * size;
    const south = wrapIndex(y + 1, size) * size;
    const row = y * size;
    for (let x = 0; x < size; x += 1) {
      const west = wrapIndex(x - 1, size);
      const east = wrapIndex(x + 1, size);
      const gradientX = (heights[row + east] - heights[row + west]) * scale;
      const gradientY = (heights[south + x] - heights[north + x]) * scale;
      const length = Math.sqrt(gradientX * gradientX + gradientY * gradientY + 1);
      const offset = (row + x) * 4;
      normal[offset] = toByte((-gradientX / length) * 0.5 + 0.5);
      normal[offset + 1] = toByte((-gradientY / length) * 0.5 + 0.5);
      normal[offset + 2] = toByte((1 / length) * 0.5 + 0.5);
      normal[offset + 3] = 255;
    }
  }
  return normal;
}

/**
 * Synthesizes the colour, tangent-space normal, and roughness pixels for a
 * surface kind. Roughness is baked absolutely, so materials keep `roughness: 1`
 * and let the map drive the response.
 */
export function createSurfaceTexturePixels(kind, options = {}) {
  const generate = GENERATORS[kind];
  if (!generate) {
    throw new Error(`Unknown procedural surface kind: ${kind}.`);
  }

  const size = options.size ?? DEFAULT_TEXTURE_SIZE;
  if (!Number.isInteger(size) || size < 4) {
    throw new Error(`Procedural surface size must be an integer of at least 4, received ${size}.`);
  }
  const properties = SURFACE_PROPERTIES[kind];
  const seed = options.seed ?? properties.seed;

  const color = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);
  const heights = new Float32Array(size * size);
  const sample = new Float64Array(5);

  for (let y = 0; y < size; y += 1) {
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x += 1) {
      const u = (x + 0.5) / size;
      generate(u, v, seed, sample);

      const index = y * size + x;
      const offset = index * 4;
      color[offset] = toByte(sample[0]);
      color[offset + 1] = toByte(sample[1]);
      color[offset + 2] = toByte(sample[2]);
      color[offset + 3] = 255;

      heights[index] = clamp01(sample[3]);
      const roughnessByte = toByte(sample[4]);
      roughness[offset] = roughnessByte;
      roughness[offset + 1] = roughnessByte;
      roughness[offset + 2] = roughnessByte;
      roughness[offset + 3] = 255;
    }
  }

  return Object.freeze({
    kind,
    size,
    color,
    normal: createNormalPixels(heights, size, properties.relief),
    roughness,
  });
}
