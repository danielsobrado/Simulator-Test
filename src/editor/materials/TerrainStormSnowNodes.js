import { clamp, max, oneMinus, smoothstep, vec4 } from 'three/tsl';

import { stormSnowCoverUniform } from '../weather/storm/stormGroundUniforms.js';

/**
 * The baked material weights with a storm's snow laid over them
 * (storm plan §5.2): `snow = max(baked, cover × upFacing × open ground)`, and the
 * other families give way in proportion, so the bake's own snow colour,
 * roughness and every snow shader downstream apply unchanged. Hollows fill
 * first and ridges last, broken by the macro tint, so the cover creeps in
 * rather than fading up. At no cover the weights pass through exactly.
 *
 * @param {Node} weights normalized vec4 grass, dirt, rock, snow
 * @param {object} samples the bake samples (terrainShape, canopyWater, macroTint)
 */
export function withStormSnow(weights, samples) {
  // terrainShape.r is the gradient (tan): snow slides off past ~35°.
  const upFacing = oneMinus(smoothstep(0.55, 1, samples.terrainShape.r));
  const open = oneMinus(samples.canopyWater.g).mul(oneMinus(samples.canopyWater.r.mul(0.6)));
  const ridge = clamp(samples.terrainShape.g.mul(-8).add(0.5), 0, 1);
  const lateness = clamp(ridge.mul(0.6).add(samples.macroTint.g.mul(0.8)).sub(0.2), 0, 1).mul(0.6);
  const cover = smoothstep(lateness, lateness.add(0.4), stormSnowCoverUniform).mul(upFacing).mul(open);
  const snow = max(weights.a, cover);
  const rest = oneMinus(snow).div(max(oneMinus(weights.a), 1e-4));
  return vec4(weights.rgb.mul(rest), snow);
}
