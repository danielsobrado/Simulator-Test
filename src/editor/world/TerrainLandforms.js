import { valueNoise } from './valueNoise2d.js';

/**
 * Landforms laid over a world's macro height: rolling swells, shallow gullies
 * and small knolls, gathered into districts so plains stay open beside hill
 * country. Everything is in canonical cells (2 m) and deterministic, so chunk
 * borders and the water model, which reads the finished height, stay continuous.
 */
const SEED = 0x3b91e7;
/** Share of the relief a plain keeps; a hill district reaches 1. */
const PLAIN_SHARE = 0.45;
const DISTRICT_CELLS = 380;
const WARP_CELLS = 120;
const WARP_REACH_CELLS = 36;
/** Wavelengths in cells, heights in metres. */
const SWELL_CELLS = 88;
const SWELL_DETAIL_CELLS = 37;
const SWELL_METERS = 9;
const GULLY_CELLS = 64;
const GULLY_METERS = 3.5;
/** Mean of the gully crease, kept out so gullies cut without lowering the land. */
const GULLY_MEAN = 0.2;
const KNOLL_CELLS = 15;
const KNOLL_METERS = 1;

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Metres of relief at a canonical vertex; roughly ±12, about half that on plains. */
export function landformRelief(cellX, cellZ, seed = 0) {
  const s = seed ^ SEED;
  const x = cellX + valueNoise(cellX / WARP_CELLS, cellZ / WARP_CELLS, s + 1) * WARP_REACH_CELLS;
  const z = cellZ + valueNoise(cellX / WARP_CELLS, cellZ / WARP_CELLS, s + 2) * WARP_REACH_CELLS;
  const district = PLAIN_SHARE + (1 - PLAIN_SHARE)
    * smoothstep(-0.3, 0.3, valueNoise(cellX / DISTRICT_CELLS, cellZ / DISTRICT_CELLS, s + 3));
  const swell = valueNoise(x / SWELL_CELLS, z / SWELL_CELLS, s + 4) * 0.72
    + valueNoise(x / SWELL_DETAIL_CELLS, z / SWELL_DETAIL_CELLS, s + 5) * 0.28;
  const crease = (1 - Math.abs(valueNoise(x / GULLY_CELLS, z / GULLY_CELLS, s + 6))) ** 4;
  return district * (swell * SWELL_METERS - (crease - GULLY_MEAN) * GULLY_METERS)
    + valueNoise(x / KNOLL_CELLS, z / KNOLL_CELLS, s + 7) * KNOLL_METERS;
}

/** 0 at the waterline, 1 a few metres above it: coasts and low wetlands keep their height. */
export function landformShoreFade(metersAboveSea) {
  return smoothstep(1, 8, metersAboveSea);
}
