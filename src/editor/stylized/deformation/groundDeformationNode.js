import {
  abs,
  float,
  floor,
  fract,
  smoothstep,
  step,
  texture,
  vec2,
} from 'three/tsl';
import {
  DEFORMATION_WINDOW_METRES,
  groundDeformationTexture,
  groundDeformationUniforms,
  TIME_PERIOD,
  WINDOW_ID_PERIOD,
} from './groundDeformationState.js';

/** Floored modulo, whatever the sign: WGSL's float % truncates toward zero. */
function floorMod(value, period) {
  return value.sub(floor(value.div(period)).mul(period));
}

/**
 * Footprint depth 0..1 at a terrain fragment, from the ground deformation
 * field. Positions arrive as a chunk's whole-metre origin plus a local offset,
 * both on cell axes (+x, and +z = −canonical z), and every step stays exact in
 * float32 at planet scale: a whole number modulo the (power-of-two) window is
 * exact, and so is floor(origin / window) mod 256.
 *
 * @param {object} originMeters vec2: chunk origin corner, whole metres, cell axes
 * @param {object} localMeters vec2: metres from that corner, cell axes
 */
export function groundDeformationNode(originMeters, localMeters) {
  const window = DEFORMATION_WINDOW_METRES;
  // Canonical z runs against cell z; the field is addressed in canonical axes.
  const originCanonical = vec2(originMeters.x, originMeters.y.negate());
  const localCanonical = vec2(localMeters.x, localMeters.y.negate());
  const inWindow = floorMod(originCanonical, window).add(localCanonical);
  const uv = fract(inWindow.div(window));
  const texel = texture(groundDeformationTexture, uv);
  const windowId = floorMod(
    floor(originCanonical.div(window)).add(floor(inWindow.div(window))),
    WINDOW_ID_PERIOD,
  );
  const sameWindow = step(abs(texel.b.sub(windowId.x)), 0.5).mul(step(abs(texel.a.sub(windowId.y)), 0.5));
  const age = floorMod(groundDeformationUniforms.time.sub(texel.g), TIME_PERIOD);
  const lifetime = groundDeformationUniforms.lifetime;
  const fade = float(1).sub(smoothstep(lifetime.mul(0.4), lifetime, age));
  return texel.r.mul(fade).mul(sameWindow);
}
