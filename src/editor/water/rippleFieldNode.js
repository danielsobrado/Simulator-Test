import { floor, fract, oneMinus, positionWorld, smoothstep, texture, vec2 } from 'three/tsl';
import {
  RIPPLE_REACH_METRES, RIPPLE_TEXEL_METRES, RIPPLE_TEXELS, RIPPLE_WINDOW_METRES, rippleFieldTexture, rippleFieldUniforms,
} from './RippleField.js';

/** Floored modulo, whatever the sign: WGSL's float % truncates toward zero. */
function floorMod(value, period) {
  return value.sub(floor(value.div(period)).mul(period));
}

/**
 * The ripple field's surface slope (dh/dx, dh/dz, canonical axes) at a water
 * fragment, 0 beyond the player's reach. Positions arrive as a chunk's
 * whole-metre origin plus a local offset on cell axes, as for footprints
 * (groundDeformationNode), so the lookup stays exact at planet scale.
 *
 * @param {object} originMeters vec2: chunk origin corner, whole metres, cell axes
 * @param {object} localMeters vec2: metres from that corner, cell axes
 */
export function rippleFieldSlope(originMeters, localMeters) {
  const originCanonical = vec2(originMeters.x, originMeters.y.negate());
  const localCanonical = vec2(localMeters.x, localMeters.y.negate());
  const uv = fract(floorMod(originCanonical, RIPPLE_WINDOW_METRES).add(localCanonical).div(RIPPLE_WINDOW_METRES));
  const step = 1 / RIPPLE_TEXELS;
  const height = (dx, dz) => texture(rippleFieldTexture, uv.add(vec2(dx * step, dz * step))).r;
  const slope = vec2(height(1, 0).sub(height(-1, 0)), height(0, 1).sub(height(0, -1)))
    .div(2 * RIPPLE_TEXEL_METRES);
  const reach = oneMinus(smoothstep(RIPPLE_REACH_METRES[0], RIPPLE_REACH_METRES[1],
    positionWorld.xz.sub(rippleFieldUniforms.player).length()));
  // The field has no mips: once a texel is smaller than a pixel the rings
  // alias into dotted whorls in the reflections. Measured on the unwrapped
  // local coordinate, so the window's wrap cannot flash a seam.
  const texelsPerPixel = localCanonical.fwidth().length().div(RIPPLE_TEXEL_METRES);
  const resolved = oneMinus(smoothstep(0.35, 1, texelsPerPixel));
  return slope.mul(reach.mul(resolved).mul(rippleFieldUniforms.strength));
}
