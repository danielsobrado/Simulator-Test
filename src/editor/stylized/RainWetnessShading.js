import { float, min, mix, oneMinus } from 'three/tsl';

import { surfaceWetnessUniform } from '../weather/surfaceWetness.js';

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
    apply(color, roughness) {
      return {
        color: color.mul(float(1).sub(wet.mul(config.darkening))),
        roughness: min(roughness, mix(roughness, float(config.wetRoughness), wet)),
      };
    },
  };
}
