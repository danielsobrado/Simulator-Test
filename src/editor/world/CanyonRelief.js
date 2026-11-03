import { valueNoise } from './valueNoise2d.js';

/**
 * Canyon country for regional biomes imported with `relief: canyon`
 * (import/AzgaarRegionalBiomes.js): flat-topped mesas stepping down in sheer
 * risers, flat-bottomed canyons cut through them, and wind-ribbed dunes on the
 * low floors. In canonical cells (2 m) and deterministic, like the landforms,
 * so chunk borders stay continuous. The caller scales it by the biome's weight.
 */
const SEED = 0x5ca70e1;
const WARP_CELLS = 150;
const WARP_REACH_CELLS = 40;
/** Mesas: a broad field cut into STEPS terraces, each rim a cliff over RISER of its step. */
const MESA_CELLS = 220;
const MESA_DETAIL_CELLS = 70;
const RIM_CELLS = 23;
/** Fins and buttresses down each cliff, near terrain only: the far mesh's spacing would alias them. */
const FIN_CELLS = 9;
const FIN_REACH = 0.05;
const STEPS = 3;
// At 0.2 a 25 m step rose over ~80 m, a 30° grassy bank rather than a cliff.
const RISER = 0.06;
const MESA_METERS = 75;
/** Level the mesa field is centred on, so the land keeps about the height Azgaar gave it. */
const MESA_CENTRE = 0.45;
/** Canyons: the low folds of a ridged field, cut flat-bottomed through the terraces. */
const CANYON_CELLS = 180;
const CANYON_METERS = 32;
/** Dunes: crests across a fixed wind, steep lee faces, gathered into dune fields. */
const DUNE_CELLS = 28;
const DUNE_METERS = 3.5;
const DUNE_FIELD_CELLS = 260;
const WIND_COS = 0.8;
const WIND_SIN = 0.6;
/** Where along a dune's wavelength its crest sits: a long windward ramp, a short slip face. */
const DUNE_CREST = 0.78;

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** 0 on the canyon floors … 1 on the highest mesa top. */
export function mesaLevel(x, z, s, fins = false) {
  // Value noise seldom nears ±1, so the sum is stretched: unstretched, the top terrace hardly showed.
  const field = 0.5 + (valueNoise(x / MESA_CELLS, z / MESA_CELLS, s + 1) * 0.8
    + valueNoise(x / MESA_DETAIL_CELLS, z / MESA_DETAIL_CELLS, s + 2) * 0.3) * 0.9;
  // The rim noise breaks each cliff line so terraces do not trace smooth contours.
  const t = Math.max(0, Math.min(STEPS - 1e-6, field * STEPS
    + valueNoise(x / RIM_CELLS, z / RIM_CELLS, s + 3) * 0.12
    // Folded, so the rim breaks into sharp fins rather than soft scallops.
    + (fins ? (0.5 - Math.abs(valueNoise(x / FIN_CELLS, z / FIN_CELLS, s + 10))) * FIN_REACH : 0)));
  const step = Math.floor(t);
  return (step + smoothstep(1 - RISER, 1, t - step)) / STEPS;
}

/** 0 off the canyon … 1 on its floor; walls take the narrow band between. */
function canyonCut(x, z, s) {
  return smoothstep(0.9, 0.93, 1 - Math.abs(valueNoise(x / CANYON_CELLS, z / CANYON_CELLS, s + 4)));
}

function duneRelief(x, z, s, lowland) {
  const field = smoothstep(-0.1, 0.4, valueNoise(x / DUNE_FIELD_CELLS, z / DUNE_FIELD_CELLS, s + 5));
  const amount = field * lowland;
  if (amount <= 0) return 0;
  const phase = (x * WIND_COS + z * WIND_SIN) / DUNE_CELLS
    + valueNoise(x / 90, z / 90, s + 6) * 1.5;
  const along = phase - Math.floor(phase);
  const profile = along < DUNE_CREST
    ? smoothstep(0, DUNE_CREST, along)
    : 1 - smoothstep(DUNE_CREST, 1, along);
  // Crests rise and fall along their length instead of running as ruled lines.
  const crest = 0.6 + 0.4 * valueNoise(x / 40, z / 40, s + 7);
  return (profile - 0.5) * DUNE_METERS * crest * amount;
}

/**
 * Metres of canyon relief at a canonical vertex, roughly −45 … +45. `near`
 * false leaves the dunes and cliff fins off for the far mesh, whose spacing
 * would alias them.
 */
export function canyonRelief(x, z, seed = 0, near = true) {
  const s = seed ^ SEED;
  const wx = x + valueNoise(x / WARP_CELLS, z / WARP_CELLS, s + 8) * WARP_REACH_CELLS;
  const wz = z + valueNoise(x / WARP_CELLS, z / WARP_CELLS, s + 9) * WARP_REACH_CELLS;
  const level = mesaLevel(wx, wz, s, near);
  const cut = canyonCut(wx, wz, s);
  let relief = (level - MESA_CENTRE) * MESA_METERS - cut * CANYON_METERS * smoothstep(0.1, 0.5, level);
  if (near) relief += duneRelief(x, z, s, Math.max(1 - smoothstep(0.1, 0.4, level), cut));
  return relief;
}
