import { frameUniform as uniform } from '../../render/FrameUniforms.js';

/** One clock for ground swash, the water sheet and CPU surface queries. */
export const waterVisualClock = uniform(0);
let override = null;
export function setWaterTimeOverride(seconds = null) {
  if (seconds !== null && (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400)) throw new Error('Water QA time must be null or 0–86400 seconds.');
  override = seconds;
  if (override !== null) waterVisualClock.value = override;
}
export function updateWaterVisualClock(seconds) {
  waterVisualClock.value = override ?? seconds;
  return waterVisualClock.value;
}
