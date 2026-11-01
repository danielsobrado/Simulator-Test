import { attribute, cos, positionLocal, sin, vec3 } from 'three/tsl';
import { frameUniform as uniform } from '../../render/FrameUniforms.js';

/**
 * Water-plant sway, after grass-test's `plantMaterial`.
 *
 * The donor bows every underwater species with the water clock — 0.18 for
 * seagrass, 0.3 for kelp, 0.1 for the algae tufts — and that is most of what makes
 * a bed of the stuff read as alive rather than as a scatter of green cards.
 *
 * Two things make it cheap here. The displacement is a vertex-only expression, so
 * it costs nothing per pixel and nothing to turn off. And the per-instance phase
 * comes free from `instanceDither.y`, the stable seed the lod runtime already
 * writes for every instanced detail, so a bed does not sway in lockstep without a
 * single extra buffer or attribute.
 *
 * The blades are authored one metre tall, so `positionLocal.y` is the height
 * fraction directly: the root stays planted and only the upper part travels, which
 * is what keeps a clump from sliding across the bed as it sways.
 */

const TWO_PI = Math.PI * 2;

/** Shared clock for every swaying plant, advanced once a frame by the surface view. */
export const plantSwayTime = uniform(0);

/**
 * Adds sway to a material's vertex position.
 *
 * @param {object} material a node material whose `positionNode` is free
 * @param {object} options
 * @param {number} options.amount metres of travel at the tip, the donor's per-species sway
 * @param {number} [options.frequency] waves per metre of height
 * @param {number} [options.speed] radians a second
 */
export function applyPlantSway(material, { amount, frequency = 2.4, speed = 1.6 }) {
  if (!(amount > 0)) return material;
  const seedPhase = attribute('instanceDither', 'vec3').y.mul(TWO_PI * 3);
  const height = positionLocal.y.clamp(0, 1);
  // The root holds and the tip travels, which is what a stalk in moving water does;
  // a linear falloff would slide the whole plant sideways.
  const travel = height.mul(height);
  const wave = sin(plantSwayTime.mul(speed).add(seedPhase).add(height.mul(frequency)))
    .mul(amount)
    .mul(travel);
  // Along its own x and a quarter-turn off it on z, so the tip traces an ellipse
  // rather than oscillating along one line.
  material.positionNode = vec3(
    positionLocal.x.add(wave),
    positionLocal.y,
    positionLocal.z.add(cos(plantSwayTime.mul(speed * 0.73).add(seedPhase)).mul(amount * 0.6).mul(travel)),
  );
  return material;
}

/** The clock the sway reads, advanced from the frame loop. */
export function advancePlantSway(timestamp) {
  plantSwayTime.value = (Number(timestamp) || 0) / 1000;
}
