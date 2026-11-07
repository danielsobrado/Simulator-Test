import { ridgedField, ridgeFineHeight, ridgeHeight } from './MountainRidges.js';

/**
 * Snow mountains for the cold biomes. Azgaar paints tundra and glacier wherever
 * it is cold, not where it is high, so that country imported as low rolling
 * ground. Here it is lifted into a range: a broad uplift, a massif of the
 * ridged field stretched to kilometre wavelengths, and the usual ridged crests,
 * couloirs and notched summits on top (MountainRidges.js).
 *
 * The weight is a per-texel mask of the cold biomes, blurred over a few
 * kilometres once at load, so the range climbs out of the lowland and the
 * coast instead of standing up as a wall at the biome border.
 *
 * Lakes are lifted with the range, not buried by it: around a lake the crests
 * calm to the plain uplift, and the lake's level rises by that same uplift
 * (`alpineLakeLift`), so a frozen tarn sits on a shelf among the peaks.
 */

/** Azgaar's standard Tundra and Glacier biome ids (engine terrain ids 10, 11). */
export const ALPINE_SOURCE_BIOMES = Object.freeze([10, 11]);
/** Distance over which the range rises from its border, metres. */
const RAMP_METERS = 2500;
/** Mean lift of the range, metres; the massif and crests are centred on it. */
const UPLIFT_METERS = 250;
/**
 * The massif: the ridged field at MASSIF_STRETCH times its scale (main ridges
 * ~4.6 km apart), so peaks stand as mountains, not as a field of steep spikes.
 */
const MASSIF_STRETCH = 6;
const MASSIF_METERS = 600;
const MASSIF_SEED = 4421;
/** How far from a lake the crests stay calmed, metres. */
const LAKE_CALM_METERS = 900;
/** Ridges at full strength wherever the mask is: the cold biome itself is the gate. */
const ALPINE_RIDGES = Object.freeze({
  heightMeters: 150,
  startRelief: 0,
  fullRelief: 1e-6,
  couloirMeters: 20,
  notchMeters: 18,
  fineMeters: 5,
});

/** Separable box blur, run twice (a tent), over a width × height Float32Array in place. */
function blur(values, width, height, radius) {
  const scratch = new Float32Array(values.length);
  const pass = (from, to, length, count, stride, step) => {
    for (let line = 0; line < count; line += 1) {
      const start = line * stride;
      let sum = 0;
      for (let k = -radius; k <= radius; k += 1) sum += from[start + Math.max(0, Math.min(length - 1, k)) * step];
      for (let i = 0; i < length; i += 1) {
        to[start + i * step] = sum / (radius * 2 + 1);
        sum += from[start + Math.min(length - 1, i + radius + 1) * step]
          - from[start + Math.max(0, i - radius) * step];
      }
    }
  };
  for (let repeat = 0; repeat < 2; repeat += 1) {
    pass(values, scratch, width, height, width, 1);
    pass(scratch, values, height, width, 1, width);
  }
  return values;
}

/** Blur, then steepen the tent by `gain` so its middle saturates at 1. */
function spread(values, width, height, meters, metersPerTexel, gain) {
  // Two box passes reach twice the radius, so half the distance each.
  blur(values, width, height, Math.max(1, Math.round(meters / 2 / metersPerTexel)));
  for (let index = 0; index < values.length; index += 1) {
    const t = Math.min(1, values[index] * gain);
    values[index] = t * t * (3 - 2 * t);
  }
  return values;
}

/** 1 within `meters` of any set texel, easing to 0 over the next `meters`; a one-texel lake counts fully. */
function softenedReach(values, width, height, meters, metersPerTexel) {
  const radius = Math.max(1, Math.round(meters / 2 / metersPerTexel));
  blur(values, width, height, radius);
  for (let index = 0; index < values.length; index += 1) values[index] = values[index] > 1e-4 ? 1 : 0;
  return blur(values, width, height, radius);
}

/**
 * Per atlas texel: `weight`, the blurred 0..1 alpine weight, and `calm`, 0..1
 * near a lake. Null when the world has no cold biome on land, so other worlds
 * pay nothing.
 */
export function createAlpineMask({ biomes, heights, features, lakeIds, width, height, metersPerTexel, landHeight }) {
  const alpine = new Set(ALPINE_SOURCE_BIOMES);
  const weight = new Float32Array(width * height);
  const calm = new Float32Array(width * height);
  let any = false;
  for (let index = 0; index < weight.length; index += 1) {
    if (features && lakeIds.has(features[index])) calm[index] = 1;
    if (!alpine.has(biomes[index]) || heights[index] < landHeight) continue;
    weight[index] = 1;
    any = true;
  }
  if (!any) return null;
  return {
    weight: spread(weight, width, height, RAMP_METERS, metersPerTexel, 1.6),
    calm: softenedReach(calm, width, height, LAKE_CALM_METERS, metersPerTexel),
  };
}

/**
 * Metres of alpine relief at a vertex for weight 0..1 and lake calm 0..1;
 * `fine` adds near-ground crags.
 */
export function alpineHeight(x, z, seed, weight, calm = 0, fine = false) {
  if (weight <= 0) return 0;
  let crests = (ridgedField(x / MASSIF_STRETCH, z / MASSIF_STRETCH, seed + MASSIF_SEED) - 0.35) * MASSIF_METERS
    + ridgeHeight(x, z, seed, 1, ALPINE_RIDGES);
  if (fine) crests += ridgeFineHeight(x, z, seed, 1, ALPINE_RIDGES);
  return (UPLIFT_METERS + crests * (1 - calm)) * weight;
}

/** How far a lake at this alpine weight is lifted, metres: the calmed ground around it. */
export function alpineLakeLift(weight) {
  return UPLIFT_METERS * weight;
}
