/**
 * Per-level tables over the storm value S (docs/plans/storm-weather-plan-2026-11-08.md §2.1):
 * one value per level key clear 0, light 0.25, moderate 0.5, heavy 0.75, storm 1,
 * smoothstepped between neighbouring keys so no parameter kinks at a key. Pure.
 */
export const STORM_LEVEL_NAMES = Object.freeze(['clear', 'light', 'moderate', 'heavy', 'storm']);
const STEP = 1 / (STORM_LEVEL_NAMES.length - 1);

/** @param {number[]} values one per level @param {number} s storm channel 0..1 */
export function evaluateLevels(values, s) {
  const x = Math.max(0, Math.min(1, Number.isFinite(s) ? s : 0)) / STEP;
  const index = Math.min(values.length - 2, Math.floor(x));
  const t = x - index;
  return values[index] + (values[index + 1] - values[index]) * t * t * (3 - 2 * t);
}

/** World wind per level (§5.3): field intensity and the gust shape. */
export const STORM_WIND = Object.freeze({
  intensity: Object.freeze([1, 1.3, 1.7, 2.1, 2.4]),
  gustThreshold: Object.freeze([0.48, 0.45, 0.4, 0.35, 0.3]),
  gustPeak: Object.freeze([0.86, 0.88, 0.92, 0.96, 1]),
});
