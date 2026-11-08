/**
 * Per-level tables over the storm value S (docs/plans/storm-weather-plan-2026-11-08.md §2.1):
 * one value per level key clear 0, light 0.25, moderate 0.5, heavy 0.75, storm 1,
 * smoothstepped between neighbouring keys so no parameter kinks at a key. Pure.
 */
export const STORM_LEVEL_NAMES = Object.freeze(['clear', 'light', 'moderate', 'heavy', 'storm']);
const STEP = 1 / (STORM_LEVEL_NAMES.length - 1);

const LEVEL_KEYS = Object.freeze(STORM_LEVEL_NAMES.map((_, index) => index * STEP));

/**
 * @param {number[]} values one per level
 * @param {number} s channel value
 * @param {number[]} [keys] the channel's value at each level (ascending); default the storm keys 0, 0.25 … 1
 */
export function evaluateLevels(values, s, keys = LEVEL_KEYS) {
  const x = Math.max(keys[0], Math.min(keys.at(-1), Number.isFinite(s) ? s : 0));
  let index = 0;
  while (index < keys.length - 2 && x > keys[index + 1]) index += 1;
  const t = (x - keys[index]) / (keys[index + 1] - keys[index]);
  return values[index] + (values[index + 1] - values[index]) * t * t * (3 - 2 * t);
}

/** Nothing falls until the storm passes this (StormState: precip = smoothstep(PRECIP_START, 1, S)). */
export const PRECIP_START = 0.12;
const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/**
 * The precipitation channel's value at each level: the rain/snow tables are keyed
 * on it, so `light` counts appear when S reaches light, not when precip reaches 0.25.
 */
export const PRECIP_LEVEL_KEYS = Object.freeze(LEVEL_KEYS.map((s) => smoothstep(PRECIP_START, 1, s)));

/** World wind per level (§5.3): field intensity and the gust shape. */
export const STORM_WIND = Object.freeze({
  intensity: Object.freeze([1, 1.3, 1.7, 2.1, 2.4]),
  gustThreshold: Object.freeze([0.48, 0.45, 0.4, 0.35, 0.3]),
  gustPeak: Object.freeze([0.86, 0.88, 0.92, 0.96, 1]),
});
