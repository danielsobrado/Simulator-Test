/**
 * Each biome's look (config/biome-looks.yaml): one row per terrain tile id that
 * the grass, terrain, trees, sky and ambient layers all read their column from,
 * so a biome's palette and weather are tuned in one place.
 *
 * Tile ids are Azgaar's standard biome ids 0–12 or custom ids 32–254. Columns
 * resolve to dense `Float32Array(256)` tables so a per-instance or per-sample
 * lookup is an index, not a map read.
 */
import { resolveBiomeSurfaceLooks } from './BiomeSurfaceLooks.js';

export const BIOME_SNOW_COLUMNS = Object.freeze(['ground', 'canopy', 'grass', 'air', 'fall']);
/** Bare ground the terrain dresses as rippled sand or frost-broken mineral (AridSubstrateNodes.js). */
export const BIOME_ARID_KINDS = Object.freeze(['sand', 'mineral']);

/**
 * A packed look `[r, g, b, w]` (per-instance `instanceBiomeLook`): rgb multiplies
 * the albedo; w is the moss scale on rocks and the saturation on understory.
 * Neutral is the authored colour with the configured moss and full saturation.
 */
export const NEUTRAL_BIOME_LOOK = Object.freeze([1, 1, 1, 1]);
/** Look columns, the key each packs into w and that key's range. */
const LOOK_COLUMNS = Object.freeze({
  rock: Object.freeze({ w: 'moss', range: Object.freeze([0, 2]) }),
  understory: Object.freeze({ w: 'saturation', range: Object.freeze([0, 1.5]) }),
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const PATH = 'biomeLooks';

function fail(path, message) {
  throw new Error(`Invalid biome look configuration: ${path} ${message}.`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hex(value, path) {
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) fail(path, 'must be a #rrggbb colour');
  return value;
}

function inRange(value, path, min, max) {
  if (!Number.isFinite(value) || value < min || value > max) fail(path, `must be within [${min}, ${max}]`);
  return value;
}

/** `{ tint, tone, <w> }` as one packed rgb multiplier plus the column's w. */
function packLook(row, path, { w, range }) {
  if (!isRecord(row)) fail(path, 'must be an object');
  const keys = ['tint', 'tone', w];
  for (const key of Object.keys(row)) if (!keys.includes(key)) fail(`${path}.${key}`, `is not one of ${keys.join(', ')}`);
  const tint = row.tint === undefined ? 0xffffff : parseInt(hex(row.tint, `${path}.tint`).slice(1), 16);
  const tone = row.tone === undefined ? 1 : inRange(row.tone, `${path}.tone`, 0.25, 2);
  const last = row[w] === undefined ? 1 : inRange(row[w], `${path}.${w}`, range[0], range[1]);
  return [(tint >> 16 & 255) / 255 * tone, (tint >> 8 & 255) / 255 * tone, (tint & 255) / 255 * tone, last];
}

function unit(value, path) {
  if (value === undefined) return 0;
  if (!Number.isFinite(value) || value < 0 || value > 1) fail(path, 'must be within [0, 1]');
  return value;
}

/** Azgaar's standard ids, or the range custom biomes allocate from. */
function tileId(key, path) {
  const id = Number(key);
  const standard = Number.isInteger(id) && id >= 0 && id <= 12;
  const custom = Number.isInteger(id) && id >= 32 && id <= 254;
  if (!/^\d+$/.test(key) || !(standard || custom)) fail(`${path}.${key}`, 'is not a terrain tile id (0–12 or 32–254)');
  return id;
}

/**
 * @param {object} source the `biomeLooks` block
 * @param {object} [options]
 * @param {boolean} [options.snow] false leaves every snow column at 0 — the
 *   `?biomeSnow=0` A/B control, which draws the biomes without biome snow
 * @returns {Readonly<{
 *   snowColor: string, frostColor: string,
 *   names: Readonly<Record<number, string>>,
 *   canopy: Readonly<Record<number, string>>,
 *   soil: Readonly<Record<number, string>>,
 *   snow: Readonly<Record<string, Float32Array>>,
 *   arid: Readonly<Record<string, readonly number[]>>,
 *   crags: Uint8Array,
 *   rock: Float32Array,
 *   understory: Float32Array,
 *   surface: ReturnType<typeof resolveBiomeSurfaceLooks>,
 * }>}
 */
export function resolveBiomeLooks(source, { snow: withSnow = true } = {}) {
  if (!isRecord(source)) fail(PATH, 'must be an object');
  const snowColor = hex(source.snow?.color, `${PATH}.snow.color`);
  const frostColor = hex(source.snow?.frost, `${PATH}.snow.frost`);
  const names = {};
  const canopy = {};
  const soil = {};
  const arid = Object.fromEntries(BIOME_ARID_KINDS.map((kind) => [kind, []]));
  const crags = new Uint8Array(256);
  // Four floats per tile id and look column (NEUTRAL_BIOME_LOOK).
  const looks = Object.fromEntries(Object.keys(LOOK_COLUMNS).map((column) => {
    const table = new Float32Array(256 * 4);
    for (let id = 0; id < 256; id += 1) table.set(NEUTRAL_BIOME_LOOK, id * 4);
    return [column, table];
  }));
  const snow = Object.fromEntries(BIOME_SNOW_COLUMNS.map((column) => [column, new Float32Array(256)]));
  const surfaceRows = [];
  for (const [key, row] of Object.entries(source.byTileId ?? {})) {
    const path = `${PATH}.byTileId.${key}`;
    const id = tileId(key, `${PATH}.byTileId`);
    if (!isRecord(row)) fail(path, 'must be an object');
    surfaceRows.push([id, row, path]);
    if (row.name !== undefined) names[id] = String(row.name);
    if (row.canopy !== undefined) canopy[id] = hex(row.canopy, `${path}.canopy`);
    if (row.soil !== undefined) soil[id] = hex(row.soil, `${path}.soil`);
    if (row.arid !== undefined) {
      if (!BIOME_ARID_KINDS.includes(row.arid)) fail(`${path}.arid`, `is not one of ${BIOME_ARID_KINDS.join(', ')}`);
      arid[row.arid].push(id);
    }
    if (row.crags !== undefined) {
      if (typeof row.crags !== 'boolean') fail(`${path}.crags`, 'must be true or false');
      crags[id] = row.crags ? 1 : 0;
    }
    for (const [column, spec] of Object.entries(LOOK_COLUMNS)) {
      if (row[column] !== undefined) looks[column].set(packLook(row[column], `${path}.${column}`, spec), id * 4);
    }
    if (row.snow !== undefined && !isRecord(row.snow)) fail(`${path}.snow`, 'must be an object');
    for (const column of Object.keys(row.snow ?? {})) {
      if (!BIOME_SNOW_COLUMNS.includes(column)) fail(`${path}.snow.${column}`, `is not one of ${BIOME_SNOW_COLUMNS.join(', ')}`);
      const value = unit(row.snow[column], `${path}.snow.${column}`);
      if (withSnow) snow[column][id] = value;
    }
  }
  return Object.freeze({
    snowColor,
    frostColor,
    names: Object.freeze(names),
    canopy: Object.freeze(canopy),
    soil: Object.freeze(soil),
    snow: Object.freeze(snow),
    arid: Object.freeze(Object.fromEntries(Object.entries(arid).map(([kind, ids]) => [kind, Object.freeze(ids)]))),
    crags,
    ...looks,
    surface: resolveBiomeSurfaceLooks(source.surface, surfaceRows),
  });
}

/** A tile id's packed look in `column` (`rock`, `understory`); neutral when unlisted or absent. */
export function biomeLook(looks, column, tileId) {
  const table = looks?.[column];
  if (!table || !(tileId >= 0 && tileId < 256)) return NEUTRAL_BIOME_LOOK;
  return table.subarray(tileId * 4, tileId * 4 + 4);
}

/**
 * The tile under a placement. Manifest placements carry their tile id; coast,
 * riverbank, seabed and strand placements are looked up where they stand.
 */
export function placementTileId(terrainView, placement) {
  if (placement.tileId !== undefined) return placement.tileId;
  const tileSize = terrainView.worldStore?.tileSize;
  return tileSize ? terrainView.tileMap?.get(Math.floor(placement.x / tileSize), Math.floor(-placement.z / tileSize)) : undefined;
}

/** A snow column as `{ [tileId]: value }`, listing only biomes that carry it. */
export function biomeSnowCover(looks, column) {
  const table = looks.snow[column];
  const cover = {};
  for (let id = 0; id < table.length; id += 1) if (table[id] > 0) cover[id] = table[id];
  return cover;
}
