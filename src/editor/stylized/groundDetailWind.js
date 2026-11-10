import { frameUniform } from '../../render/FrameUniforms.js';
import {
  abs,
  attribute,
  cos,
  float,
  modelWorldMatrix,
  positionGeometry,
  positionLocal,
  sin,
  vec3,
  vec4,
} from 'three/tsl';

import { canonicalFromRender, sampleWorldWind, windWaveCoordinates } from '../weather/wind/worldWindState.js';
import { plantSwayTime } from './plantSway.js';

/** Share of a gust a tuft takes relative to a meadow blade: a clump is stiffer. */
const TUFT_GIVE = 0.7;
/** How far a stem's own phase may run from its neighbours', in radians. */
const PHASE_SPREAD = 0.9;

/**
 * The meadow's wind on an authored ground detail — grass tufts, jungle grasses,
 * flowers from the packs.
 *
 * Authored tufts were drawn rigid, and because their density is weighted per
 * chunk and per regional district, whole patches of the sward stood still while
 * the procedural blades round them swayed: the wind looked different by chunk.
 * This bends a tuft with the same travelling wave, clock and world field as the
 * meadow blades (meadowBladeShape's primary wave), rooted at its base and
 * growing toward its top, so a gust front crosses tufts and blades together.
 *
 * `positionLocal` here is already placed by the instance matrix (the renderer
 * applies instancing before `positionNode`), so the tuft's own height comes from
 * `positionGeometry`.
 *
 * @param {object} wind `stylizedSurface.wind` (strength, speed, frequency, lean)
 * @param {number} height metres from the prototype's base to its top
 * @returns {object} a position node
 */
export function groundDetailWindPosition(wind, height) {
  // A uniform, not a constant: baked in, each prototype's height would make its
  // shader text unique and every tuft would compile a pipeline of its own.
  const top = frameUniform(Math.max(0.05, height));
  const r = positionGeometry.y.div(top).clamp(0, 1);
  const bend = r.mul(r);
  const world = modelWorldMatrix.mul(vec4(positionLocal, 1)).xz;
  const field = sampleWorldWind(world);
  const { along } = windWaveCoordinates(canonicalFromRender(world));
  const seed = attribute('instanceDither', 'vec3').y.mul(PHASE_SPREAD);
  const wave = sin(along.mul(wind.frequency ?? 0.47)
    .add(plantSwayTime.mul(wind.speed ?? 1.3))
    .add(seed));
  const angle = float(wind.lean ?? 0.05).add(wave.mul(wind.strength ?? 0.1))
    .mul(field.envelope.clamp(0.35, 3.5)).mul(2 * TUFT_GIVE).clamp(-1.1, 1.1)
    .mul(bend);
  const reach = sin(angle).mul(top).mul(r);
  return positionLocal.add(vec3(
    field.direction.x.mul(reach),
    abs(cos(angle).sub(1)).mul(top).mul(r).negate(),
    field.direction.y.mul(reach),
  ));
}
