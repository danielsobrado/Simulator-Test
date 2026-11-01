import { frameUniform as uniform } from '../../../render/FrameUniforms.js';

/**
 * Gust fronts sweeping a meadow, after grass-test's grass gust sheen: where a
 * gust bends the tips over they turn their paler, glossier side up and catch the
 * light, so the wind is *seen* crossing the field as travelling bright bands.
 *
 * The ambient layer writes `weight` once a frame — the meadow region weight ×
 * preset × strength, eased like every other surface term — and the meadow grass
 * material reads it. At zero the material adds nothing visible.
 */
export const grassGustSheenUniforms = Object.freeze({
  weight: uniform(0),
});
