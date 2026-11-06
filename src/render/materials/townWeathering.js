import { float, mix, mx_noise_float, smoothstep, vec3 } from 'three/tsl';

/**
 * The weather a town's buildings have stood in, shared by both town renderers
 * (SettlementView's workshop houses and the medieval kit), so a street reads
 * as one place whichever draws it.
 *
 * Weathered the way the terrain's boulders are (rockWeathering.js): moss where
 * rain settles, dust on what faces the sky, a soft damp foot, faint runs. The
 * dust is each surface's own colour bleached by the sun, not one shared tint,
 * so a rose-rendered town and a slate-and-granite one stay themselves.
 */

export const WEATHER_MOSS = Object.freeze([0.30, 0.39, 0.14]);
export const WEATHER_DAMP = Object.freeze([0.31, 0.27, 0.21]);
/** How far sun-bleached dust lifts a surface toward pale, and how much of its hue it keeps. */
const DUST_LIFT = 0.42;
const DUST_HUE_KEEP = 0.7;

/** Per material family: how much of each the surface takes. */
export const WEATHER_FAMILIES = Object.freeze({
  stone: Object.freeze({ moss: 0.48, streaks: 0.65, damp: 0.75, dust: 0.34 }),
  plaster: Object.freeze({ moss: 0.14, streaks: 0.5, damp: 0.65, dust: 0.28 }),
  mortar: Object.freeze({ moss: 0.26, streaks: 0.45, damp: 0.75, dust: 0.32 }),
  timber: Object.freeze({ moss: 0.18, streaks: 0.35, damp: 0.55, dust: 0.24 }),
  roof: Object.freeze({ moss: 0.38, streaks: 0, damp: 0, dust: 0.32 }),
});

/**
 * @param {import('three/tsl').Node} colour linear albedo (vec3)
 * @param {object} options
 * @param {import('three/tsl').Node} options.place position in metres, stable per building
 *   (not render space, which re-centres with the floating origin)
 * @param {import('three/tsl').Node} options.up world normal's y
 * @param {?import('three/tsl').Node} [options.height] metres above the building's ground,
 *   or null where it is not known (no damp band then)
 * @param {{ moss: number|Node, streaks: number|Node, damp: number|Node, dust?: number|Node }} options.family amounts, 0..1
 * @returns {import('three/tsl').Node} weathered albedo (vec3)
 */
export function weatherTownSurface(colour, { place, up, height = null, family }) {
  const patch = mx_noise_float(place.mul(0.6));
  const facing = smoothstep(0.35, 0.85, up);
  const moss = facing.mul(smoothstep(-0.15, 0.35, patch)).mul(family.moss);
  // Runs: noise stretched along the fall line, on faces that are near vertical.
  const run = mx_noise_float(vec3(place.x.mul(2.4), place.y.mul(0.16), place.z.mul(2.4)));
  const vertical = float(1).sub(up.abs()).clamp(0, 1);
  const streak = smoothstep(0.05, 0.55, run).mul(vertical).mul(family.streaks).mul(0.14);
  let weathered = colour.mul(float(1).sub(streak));
  if (height) {
    const foot = float(1).sub(smoothstep(0, 1.15, height)).pow(1.6);
    const damp = foot.mul(patch.mul(0.25).add(0.75)).mul(family.damp).mul(0.42);
    weathered = mix(weathered, vec3(...WEATHER_DAMP).mul(colour.dot(vec3(0.3, 0.55, 0.15)).mul(1.35).add(0.42)), damp);
  }
  const dustAmount = family.dust ?? 0.28;
  const dustMask = smoothstep(0.15, 0.88, up).mul(patch.mul(0.25).add(0.75)).mul(dustAmount);
  const luma = colour.dot(vec3(0.3, 0.55, 0.15));
  const bleached = mix(vec3(luma), colour, DUST_HUE_KEEP).mul(1 - DUST_LIFT).add(DUST_LIFT * 0.62);
  weathered = mix(weathered, bleached, dustMask.clamp(0, 0.45));
  return mix(weathered, vec3(...WEATHER_MOSS).mul(colour.dot(vec3(0.3, 0.55, 0.15)).mul(0.9).add(0.55)), moss.clamp(0, 0.72));
}

/** Trodden grime on paving: how dark a patch gets, and the earth it darkens toward. */
export const TREAD_GRIME = Object.freeze({ depth: 0.34, earth: [0.66, 0.59, 0.49], tone: 0.90 });

/**
 * A lived-in street's paving: never as pale as its photograph, and darkened
 * in broad patches where feet, carts and rain leave dirt. It also hides the
 * tile repeat. `coords` is a 2D position in metres (or texture tiles) that is
 * stable on the ground.
 */
export function treadPaving(colour, coords) {
  const grime = smoothstep(0.05, 0.65, mx_noise_float(vec3(coords.mul(0.27), 9.2))).mul(TREAD_GRIME.depth);
  const worn = colour.mul(TREAD_GRIME.tone);
  return mix(worn, worn.mul(vec3(...TREAD_GRIME.earth)), grime);
}
