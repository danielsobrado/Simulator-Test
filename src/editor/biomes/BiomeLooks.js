/**
 * Each biome's look (config/biome-looks.yaml): one row per terrain tile id that
 * the grass, terrain, trees, sky and ambient layers all read their column from,
 * so a biome's palette and weather are tuned in one place.
 *
 * Tile ids are Azgaar's standard biome ids 0–12 or custom ids 32–254. Columns
 * resolve to dense `Float32Array(256)` tables so a per-instance or per-sample
 * lookup is an index, not a map read.
 */
export const BIOME_SNOW_COLUMNS = Object.freeze(['ground', 'canopy', 'grass', 'air', 'fall']);
/** Bare ground the terrain dresses as rippled sand or frost-broken mineral (AridSubstrateNodes.js). */
export const BIOME_ARID_KINDS = Object.freeze(['sand', 'mineral']);

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
  const snow = Object.fromEntries(BIOME_SNOW_COLUMNS.map((column) => [column, new Float32Array(256)]));
  for (const [key, row] of Object.entries(source.byTileId ?? {})) {
    const path = `${PATH}.byTileId.${key}`;
    const id = tileId(key, `${PATH}.byTileId`);
    if (!isRecord(row)) fail(path, 'must be an object');
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
  });
}

/** A snow column as `{ [tileId]: value }`, listing only biomes that carry it. */
export function biomeSnowCover(looks, column) {
  const table = looks.snow[column];
  const cover = {};
  for (let id = 0; id < table.length; id += 1) if (table[id] > 0) cover[id] = table[id];
  return cover;
}
