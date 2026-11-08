/**
 * How much of each ambient bed and call the listener should hear, 0..1 each,
 * from the ground and water around them (terrain tiles are the Azgaar biome
 * ids), the weather, the time of day and how deep in snow country they are.
 */

const FOREST = new Set([6, 8, 9]);
const JUNGLE = new Set([5, 7]);
const OPEN = new Set([1, 2, 3, 4, 10, 11, 13, 14]);
const WETLAND = 12;

/** Water kinds, as WaterConstants numbers them. */
export const WATER_NONE = 0;
export const WATER_OCEAN = 1;
export const WATER_LAKE = 2;
export const WATER_RIVER = 3;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function share(values, predicate) {
  if (!values.length) return 0;
  let count = 0;
  for (const value of values) if (predicate(value)) count += 1;
  return count / values.length;
}

export const SILENT_WEIGHTS = Object.freeze({
  meadow: 0, alpine: 0, forest: 0, wetland: 0, jungleDay: 0, jungleNight: 0,
  surf: 0, stream: 0, lake: 0, nightCrickets: 0,
  rainLight: 0, rainMedium: 0, rainHeavy: 0, canopy: 0,
  birds: 0, crows: 0, crickets: 0, frogs: 0, mosquitoes: 0,
  seagulls: 0, waves: 0, jungleCalls: 0, cicadas: 0,
});

/**
 * @param {object} surroundings
 * @param {number[]} surroundings.tiles tile ids sampled around the listener
 * @param {number[]} [surroundings.water] water kinds at the same points
 * @param {number} surroundings.heightAboveSea metres
 * @param {number} surroundings.rain 0..1
 * @param {number} surroundings.wind 0..1 relative wind strength
 * @param {number} [surroundings.snow] 0..1 falling snow (the storm's snow channel)
 * @param {number} [surroundings.snowCountry] 0..1 (SnowCountryWeight)
 * @param {boolean} surroundings.night
 * @param {boolean} surroundings.underwater
 */
export function soundscapeWeights({
  tiles, water = [], heightAboveSea, rain, wind, snow: snowfall = 0, snowCountry = 0, night, underwater,
}) {
  if (underwater) return { ...SILENT_WEIGHTS };
  const forest = share(tiles, (tile) => FOREST.has(tile));
  const jungle = share(tiles, (tile) => JUNGLE.has(tile));
  const wetland = share(tiles, (tile) => tile === WETLAND);
  const open = share(tiles, (tile) => OPEN.has(tile));
  const ocean = share(water, (kind) => kind === WATER_OCEAN);
  const lake = share(water, (kind) => kind === WATER_LAKE);
  const river = share(water, (kind) => kind === WATER_RIVER);
  const snow = clamp01(snowCountry);
  const rainAmount = clamp01(rain);
  // Rain, a blizzard or a gale all send the wildlife to cover.
  const hush = clamp01(Math.max(rainAmount, snowfall, wind - 0.5));
  const dry = 1 - hush;
  // Open ground and height both expose you to the wind; snow country has its own.
  const exposure = clamp01(open + clamp01((heightAboveSea - 300) / 900)) * (1 - snow);
  const gust = 0.45 + clamp01(wind) * 0.55;
  // Any sea in reach is heard; most when it surrounds you. Close to it on low
  // ground, the waves and gulls come in too.
  const surf = clamp01(Math.sqrt(ocean) * 1.3);
  const beach = surf * clamp01(1 - (heightAboveSea - 4) / 20);
  const lowland = 1 - snow;
  return {
    meadow: clamp01(exposure * gust),
    alpine: clamp01(snow * gust * 1.1),
    forest: clamp01(forest * 1.4) * lowland,
    wetland: clamp01(wetland * 1.6),
    jungleDay: night ? 0 : clamp01(jungle * 1.5),
    jungleNight: night ? clamp01(jungle * 1.5) : 0,
    surf,
    stream: clamp01(Math.sqrt(river) * 1.4),
    lake: clamp01(Math.sqrt(lake) * 1.2),
    nightCrickets: night ? clamp01((open + forest * 0.4) * dry * lowland) : 0,
    rainLight: rainAmount > 0 ? clamp01(1 - Math.abs(rainAmount - 0.25) / 0.3) : 0,
    rainMedium: clamp01(1 - Math.abs(rainAmount - 0.6) / 0.3),
    rainHeavy: clamp01((rainAmount - 0.65) / 0.3),
    // Calls. Birds by day in trees and meadows, fewer in rain and none on the
    // snowfields; crows over open ground; gulls and single waves at the beach.
    birds: night ? 0 : clamp01((forest + open * 0.5) * dry * lowland),
    crows: night ? 0 : clamp01(open * 0.6 * (1 - hush * 0.7) * lowland),
    crickets: night ? clamp01((open + forest * 0.5) * dry * lowland) : 0,
    frogs: clamp01((wetland + jungle * 0.5) * (night ? 1 : 0.35) + lake * 0.3),
    mosquitoes: clamp01(wetland * (night ? 0.8 : 0.3) * dry),
    seagulls: night ? 0 : clamp01(beach * (1 - hush * 0.5)),
    waves: clamp01(beach * 1.2),
    jungleCalls: night ? 0 : clamp01(jungle * 1.3 * (1 - hush * 0.6)),
    cicadas: night ? 0 : clamp01((jungle + open * 0.25) * dry * (1 - snow)),
    // Not a bed: how much tree cover dulls the weather (weather sub-bus).
    canopy: clamp01(forest + jungle),
  };
}

/**
 * Bearing (x, z unit vector, canonical) toward the sea from ring samples, or
 * null when none is in reach. Waves are panned toward it.
 */
export function seaBearing(points, water) {
  let x = 0;
  let z = 0;
  for (let index = 0; index < points.length; index += 1) {
    if (water[index] !== WATER_OCEAN) continue;
    x += points[index].dx;
    z += points[index].dz;
  }
  const length = Math.hypot(x, z);
  return length > 1e-6 ? { x: x / length, z: z / length } : null;
}
