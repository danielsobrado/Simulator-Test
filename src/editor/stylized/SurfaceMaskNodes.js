import { clamp, oneMinus, smoothstep, step } from 'three/tsl';

export const SURFACE_CLASSIFICATION_THRESHOLD = 0.5;

/**
 * The water channel carries fractional occupancy from the water field, not a
 * marine-tile flag, so it can be read as a coverage ramp. Land cover fades out
 * across that ramp rather than snapping at a threshold: a hard cut would put
 * the last row of blades on a cell edge, a cell away from the waterline the
 * water surface draws itself against.
 */
export function createSurfaceClassNodes(surface) {
  const grass = step(SURFACE_CLASSIFICATION_THRESHOLD, surface.g);
  const waterCoverage = clamp(surface.b, 0, 1);
  const water = step(SURFACE_CLASSIFICATION_THRESHOLD, waterCoverage);
  return Object.freeze({
    grass,
    water,
    waterCoverage,
    landGrass: grass.mul(oneMinus(smoothstep(0.15, 0.6, waterCoverage))),
  });
}
