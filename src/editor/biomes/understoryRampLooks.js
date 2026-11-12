import { resolveFoliagePalette } from '../stylized/forest/foliagePalette.js';
import { biomeLook } from './BiomeLooks.js';

/**
 * How far one channel may be pushed, in linear light. Wide on purpose: wood green
 * to savanna straw is 2.3x in red, and a tighter bound clamps one channel and
 * skews the hue. The bound only stops a near-black palette zeroing a plant.
 */
const RATIO_MIN = 0.4;
const RATIO_MAX = 2.5;

/** Per look table: the ramp's mid colour by tile id, and one shifted table per home tile. */
const cache = new WeakMap();

function entryFor(config) {
  const looks = config.biomeLooks;
  let entry = cache.get(looks);
  if (!entry) {
    const mids = new Float32Array(256 * 3);
    for (let id = 0; id < 256; id += 1) {
      const { base, tip } = resolveFoliagePalette(config, id);
      base.lerp(tip, 0.5).toArray(mids, id * 3);
    }
    entry = { mids, byHome: new Map() };
    cache.set(looks, entry);
  }
  return entry;
}

function shiftedTable(looks, mids, homeTile) {
  const table = Float32Array.from(looks.understory);
  for (let id = 0; id < 256; id += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      const ratio = mids[id * 3 + channel] / Math.max(1e-4, mids[homeTile * 3 + channel]);
      table[id * 4 + channel] *= Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio));
    }
  }
  return table;
}

/**
 * The understory look of a plant standing on `tileId` whose colour ramp was
 * built for `homeTile` (its variant's `paletteTileId ?? tileIds[0]`).
 *
 * A material's ramp is constant, so a shrub shared by several biomes wore its
 * home biome's green in all of them. The look's rgb already multiplies the
 * albedo per instance; this folds in the ratio of the standing biome's ramp to
 * the home one, so the same shrub reads as the local grass family. No shader
 * change and no extra attribute: one 1 KB table per distinct home tile.
 *
 * @param {object} config `stylizedSurface`, with its resolved `biomeLooks`
 * @returns {Float32Array | readonly number[]} packed `[r, g, b, w]`
 */
export function understoryLookAt(config, homeTile, tileId) {
  const looks = config?.biomeLooks;
  const known = (id) => Number.isInteger(id) && id >= 0 && id < 256;
  if (!looks?.understory || !known(homeTile) || !known(tileId) || homeTile === tileId) {
    return biomeLook(looks, 'understory', tileId);
  }
  const { mids, byHome } = entryFor(config);
  let table = byHome.get(homeTile);
  if (!table) byHome.set(homeTile, table = shiftedTable(looks, mids, homeTile));
  return table.subarray(tileId * 4, tileId * 4 + 4);
}
