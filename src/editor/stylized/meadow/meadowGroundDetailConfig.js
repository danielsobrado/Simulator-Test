import { GROUND_LAYERS } from '../path/groundLayerIds.js';
import { linearColor } from './meadowColorSpace.js';

/**
 * What the ground between meadow stems is made of (`grass.meadow.groundDetail`).
 *
 * A sparse stand shows its floor, and a smooth painted turf there reads as a
 * lawn under a few stray blades. Each biome names its litter — flattened thatch,
 * needle duff, lichen — and how much moss, bare soil and fallen-blade streaks
 * break it up. The shader reads them per tile id from the meadow pigment map's
 * extra rows, so there is no biome branch and no new sampler.
 */
export const MEADOW_GROUND_DETAIL_DEFAULTS = Object.freeze({
  enabled: true,
  /** Metres: where the 0.2–1 m structure starts and finishes fading to the plain turf. */
  fadeStart: 14,
  fadeEnd: 34,
  /** Metres: where the centimetre streaks have faded, before they shimmer. */
  fineEnd: 10,
  /** Overall weight, 0..1. */
  strength: 1,
  default: Object.freeze({ litter: '#9a9156', litterAmount: 0.5, moss: 0.25, soil: 0.3, streaks: 0.6, floor: Object.freeze(['grass', 'mossy']) }),
  byTileId: Object.freeze({}),
});

const AMOUNTS = ['litterAmount', 'moss', 'soil', 'streaks'];

function amount(value, path) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid editor configuration: ${path} must be a number in [0, 1].`);
  }
  return value;
}

function entry(source, fallback, path) {
  const merged = { ...fallback, ...source };
  if (typeof merged.litter !== 'string' || !/^#[0-9a-f]{6}$/i.test(merged.litter)) {
    throw new Error(`Invalid editor configuration: ${path}.litter must be a #rrggbb colour.`);
  }
  for (const key of AMOUNTS) amount(merged[key], `${path}.${key}`);
  if (!Array.isArray(merged.floor) || merged.floor.length !== 2 || merged.floor.some(name => !GROUND_LAYERS[name])) {
    throw new Error(`Invalid editor configuration: ${path}.floor must name two of ${Object.keys(GROUND_LAYERS).join(', ')}.`);
  }
  return merged;
}

/**
 * @param {object | undefined} source `grass.meadow.groundDetail`
 * @returns {null | { fadeStart, fadeEnd, fineEnd, strength, litter: Float32Array, amounts: Float32Array, floors: Float32Array }}
 *   per tile id: linear litter colour + amount, (moss, soil, streaks, 0), and the
 *   floor scans' array layers (settled ground, dry or worn ground, 0, 0)
 */
export function resolveMeadowGroundDetail(source) {
  const d = MEADOW_GROUND_DETAIL_DEFAULTS;
  if (source?.enabled === false) return null;
  const path = 'stylizedSurface.grass.meadow.groundDetail';
  const fadeStart = source?.fadeStart ?? d.fadeStart;
  const fadeEnd = source?.fadeEnd ?? d.fadeEnd;
  const fineEnd = source?.fineEnd ?? d.fineEnd;
  if (!(fadeStart >= 0 && fadeEnd > fadeStart && fineEnd > 0 && fineEnd <= fadeEnd)) {
    throw new Error(`Invalid editor configuration: ${path} needs 0 <= fadeStart < fadeEnd and 0 < fineEnd <= fadeEnd.`);
  }
  const strength = amount(source?.strength ?? d.strength, `${path}.strength`);
  const base = entry(source?.default, d.default, `${path}.default`);
  const byId = new Map();
  for (const [key, value] of Object.entries(source?.byTileId ?? {})) {
    const id = Number(key);
    if (!Number.isInteger(id) || id < 0 || id > 255) {
      throw new Error(`Invalid editor configuration: ${path}.byTileId.${key} is not a terrain ID.`);
    }
    byId.set(id, entry(value, base, `${path}.byTileId.${key}`));
  }
  const litter = new Float32Array(256 * 4);
  const amounts = new Float32Array(256 * 4);
  const floors = new Float32Array(256 * 4);
  for (let id = 0; id < 256; id += 1) {
    const e = byId.get(id) ?? base;
    litter.set([...linearColor(e.litter), e.litterAmount], id * 4);
    amounts.set([e.moss, e.soil, e.streaks, 0], id * 4);
    floors.set([GROUND_LAYERS[e.floor[0]], GROUND_LAYERS[e.floor[1]], 0, 0], id * 4);
  }
  return { fadeStart, fadeEnd, fineEnd, strength, litter, amounts, floors };
}
