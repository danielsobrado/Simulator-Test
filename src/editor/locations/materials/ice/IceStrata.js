import { float, mix, mx_fractal_noise_float, mx_noise_float, smoothstep, vec3 } from 'three/tsl';

/** How far the big folds reach, in noise units per metre: one fold every ~20 m. */
const FOLD_SCALE = 0.045;
/** Layer thickness rates along the strata coordinate: firn bands, their sub-layers, hairline laminae. */
const BROAD = 0.5, FINE = 2.7, HAIR = 9.5;

/**
 * Glacier foliation: the annual layers a glacier is built from, compressed,
 * tilted by flow and folded where it bends.
 *
 * Every layer is a function of one coordinate that runs across the strata, so
 * a band keeps its identity around a corner and through a pillar. Thicknesses
 * come from noise along that coordinate rather than a sine, because real
 * layers are never evenly spaced.
 *
 * @param {Node} point where the ice is sampled (inside the surface, so layers refract)
 * @param {{ frequency: number, dip: number, fold: number }} banding layers per metre, tilt, fold amplitude
 * @returns {{ white: Node, laminae: Node, ash: Node }} each 0..1: bubbly firn bands, hairline pale layers, dirt layers
 */
export function iceStrata(point, banding) {
  const fold = mx_fractal_noise_float(point.mul(FOLD_SCALE), 2, 2, 0.5).mul(banding.fold);
  const across = point.y.mul(banding.frequency).add(point.x.mul(banding.dip)).add(point.z.mul(banding.dip * 0.6)).add(fold);
  const layer = (rate, salt) => mx_noise_float(vec3(across.mul(rate), salt, salt * 1.7));
  const fine = layer(FINE, 7.3);
  // No band is uniform along its length: it thins, clears and thickens again.
  const along = mx_noise_float(vec3(point.x.mul(0.19), across.mul(0.6), point.z.mul(0.19))).mul(0.5).add(0.5);
  return {
    white: smoothstep(-0.05, 0.4, layer(BROAD, 1.7).add(fine.mul(0.4))).mul(mix(float(0.45), float(1), along)),
    laminae: smoothstep(0.2, 0.55, layer(HAIR, 2.9).add(fine.mul(0.5))),
    ash: smoothstep(0.36, 0.5, layer(1.15, 11.1)).mul(smoothstep(0.25, 0.7, along)),
  };
}
