import { float, min, mix, oneMinus } from 'three/tsl';

import { surfaceWetnessUniform } from '../weather/surfaceWetness.js';

/**
 * Share of its albedo soaked ground keeps, rain film and standing water
 * together. Stacked on the bog's peat and the shore's damp band, the uncapped
 * product took wetland and wet sand to near black.
 */
export const WET_ALBEDO_FLOOR = 0.6;
/** Extra darkening of standing water over the rain film, before the floor. */
const PUDDLE_DARKENING = 0.25;

/**
 * Rain-soaked ground: darker, and smoother so the sun glints off it. Snow
 * stays as it is and a canopy shelters what lies under it. Roughness only
 * falls, so already-wet shores keep their baked sheen.
 *
 * @param {object} options
 * @param {Node} options.snow 0..1 snow cover
 * @param {Node} options.canopy 0..1 canopy over the ground
 * @param {object} options.config resolved stylizedSurface.wetness
 */
export function createRainWetnessShading({ snow, canopy, config }) {
  const exposure = oneMinus(snow).mul(oneMinus(canopy.mul(config.canopyShelter)));
  const wet = surfaceWetnessUniform.mul(exposure);
  return {
    wet,
    /** 0..1 open to the rain: not snowed over, not under a canopy. */
    exposure,
    /** @param {Node} [puddle] 0..1 standing water, which darkens a little further */
    apply(color, roughness, puddle = float(0)) {
      const albedo = float(1).sub(wet.mul(config.darkening)).sub(puddle.mul(PUDDLE_DARKENING)).max(WET_ALBEDO_FLOOR);
      return {
        color: color.mul(albedo),
        roughness: min(roughness, mix(roughness, float(config.wetRoughness), wet)),
      };
    },
  };
}
