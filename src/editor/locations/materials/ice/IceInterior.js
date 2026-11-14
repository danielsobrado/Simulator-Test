import { abs, exp, length, mx_noise_float, pow, smoothstep, vec3 } from 'three/tsl';
import { triplanarSample } from '../LocationShading.js';

/** Metres below the surface at which the interior is sampled, nearest first. */
const LAYER_DEPTHS = [0.1, 0.4, 1.1, 2.4];
/** Texture repeats per metre for each layer: crystal boundaries near the surface, block fractures deeper. */
const CRACK_SCALE = [0.5, 0.27, 0.14, 0.08];
/** Layers that also get bubbles; deeper ones are too dim to pay for them. */
const DETAILED_LAYERS = 2;

/**
 * What can be seen inside the ice: cracks, fracture faces and bubbles, sampled
 * at several depths along the refracted view ray and dimmed by the absorption
 * of the ice in front of them. Because each depth is a different point in the
 * world, the layers slide over one another as the camera moves and the deep
 * ones arrive bluer — which is what separates a crack in the ice from a line
 * drawn on it.
 *
 * Crack lines are the slope of a photographed crack network's normal map: thin
 * and connected, where thresholding its colour gives white plates.
 *
 * @param {object} options
 * @param {Node} options.point surface point, world space
 * @param {Node} options.into refracted view direction, pointing into the ice
 * @param {Node} options.weights triplanar weights
 * @param {{ normal: Texture }} options.cracks the crack network set
 * @param {Node} options.absorption per-metre rgb extinction
 * @param {number} options.layers how many depths to sample (quality)
 * @param {number} options.crackGain
 * @param {Node} options.fracture 0..1
 * @param {Node} options.bubbles 0..1
 * @returns {Node} rgb light scattered back toward the eye, before the profile's scatter colour
 */
export function iceInterior({ point, into, weights, cracks, absorption, layers, crackGain, fracture, bubbles }) {
  const count = Math.min(layers, LAYER_DEPTHS.length);
  let glow = vec3(0);
  for (let index = 0; index < count; index += 1) {
    const depth = LAYER_DEPTHS[index];
    // Each layer is shifted so the same crack is never stacked above itself.
    const inside = point.add(into.mul(depth)).add(index * 3.71);
    const slope = length(triplanarSample(cracks.normal, inside, weights, CRACK_SCALE[index]).xy.mul(2).sub(1));
    // Cracks gather into fractured zones and leave clear ice between them.
    const zone = smoothstep(-0.1, 0.35, mx_noise_float(inside.mul(0.14))).mul(0.3).add(fracture.mul(1.5));
    let light = smoothstep(0.035, 0.16, slope).mul(zone);
    // Fracture planes seen edge-on: the zero set of a slow noise is a few curved sheets.
    const sheet = pow(abs(mx_noise_float(inside.mul(0.2 + index * 0.08))).oneMinus(), 40)
      .mul(smoothstep(0, 0.4, mx_noise_float(inside.mul(0.09).add(31.7))));
    light = light.add(sheet.mul(fracture.mul(1.5).add(0.05))).mul(crackGain);
    if (index < DETAILED_LAYERS) {
      // Bubbles string out along the vertical, the way they rose before the ice closed on them.
      const cluster = smoothstep(0, 0.45, mx_noise_float(inside.mul(0.9)));
      const dots = smoothstep(0.42, 0.68, mx_noise_float(inside.mul(vec3(24, 7, 24))));
      light = light.add(dots.mul(cluster).mul(bubbles).mul(1.2));
    }
    // In to the feature and back out again.
    glow = glow.add(exp(absorption.mul(-2 * depth)).mul(light));
  }
  return glow.div(count);
}
