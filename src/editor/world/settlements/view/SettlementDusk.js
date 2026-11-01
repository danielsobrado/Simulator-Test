import { attribute, color, fract, step } from 'three/tsl';
import { frameUniform as uniform } from '../../../../render/FrameUniforms.js';

import { glazeWindowRecess } from '../../../../render/materials/townGlass.js';

/**
 * How far into evening the world is, 0 in full day to 1 at night, as one
 * uniform every settlement material reads. Towns light up with it: windows and
 * lantern glass are emissive materials, not lights — a town is hundreds of
 * them, and a real light apiece would not scale.
 */
export const settlementDusk = uniform(0);

function smooth(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Dusk from the sky as it is drawn: the sun low on the horizon, or the key
 * light dimmed (a moonlit look keeps its "sun" high and turns it down).
 *
 * @param {?{ sunDirectionValue?: { y: number }, directional?: { intensity: number } }} skyView
 */
export function duskFromSky(skyView) {
  if (!skyView) return 0;
  const low = 1 - smooth(0.04, 0.3, skyView.sunDirectionValue?.y ?? 1);
  const dim = 1 - smooth(0.15, 0.7, skyView.directional?.intensity ?? 1);
  return Math.max(low, dim);
}

const LANTERN_GLOW = color('#ffae45');

/**
 * Light the workshop's emissive families from the dusk uniform. Window recesses
 * are leaded glass, faintly lit by day as the kit towns' are, and glow warm in
 * the evening — in most houses, not all: each instance's stable seed decides
 * whether anyone is home — and lantern glass, a faint ember by day, burns at
 * night.
 */
export function lightSettlementMaterials(materials) {
  if (materials.recess) {
    // The dithered instance material packs a stable per-instance seed in `instanceDither.y`.
    const home = step(0.3, fract(attribute('instanceDither', 'vec3').y.mul(7.31)));
    glazeWindowRecess(materials.recess, { dusk: settlementDusk, home });
  }
  if (materials.glow) materials.glow.emissiveNode = LANTERN_GLOW.mul(settlementDusk.mul(2.4).add(0.35));
}
