/**
 * The world wind as materials see it: one small texture of the gust field
 * around the camera, plus the prevailing wind that stands in beyond it.
 *
 * `WorldWindPass` fills the texture each frame. Materials only ever call
 * `sampleWorldWind`, which costs one texture fetch per vertex however complex
 * the field is — the field itself is evaluated once per texel, not once per
 * grass vertex.
 *
 * Module state, like the other shared shader inputs, because the materials that
 * read it are built long before the pass exists.
 *
 * Texel layout (RGBA16F): RG wind vector (direction × strength), B gust (0..1),
 * A strength.
 */

import * as THREE from 'three';
import { dot, float, max, mix, smoothstep, texture, vec2 } from 'three/tsl';
import { frameUniform as uniform } from '../../../render/FrameUniforms.js';

export const WIND_TEXTURE_SIZE = 128;
/** Metres the texture spans. At 128 texels that is 3 m per texel. */
export const WIND_WINDOW_METRES = 384;
/** Share of the half-window over which the field fades to the prevailing wind. */
const EDGE_FADE_START = 0.42;

export const worldWindTarget = new THREE.RenderTarget(WIND_TEXTURE_SIZE, WIND_TEXTURE_SIZE, {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  wrapS: THREE.ClampToEdgeWrapping,
  wrapT: THREE.ClampToEdgeWrapping,
  depthBuffer: false,
  generateMipmaps: false,
});
worldWindTarget.texture.name = 'world-wind-field';

export const worldWindUniforms = Object.freeze({
  /** Render-space centre of the texture window. */
  windowCenter: uniform(new THREE.Vector2(0, 0)),
  /**
   * The same centre in canonical space, for materials that only know canonical
   * positions (grass and flowers place blades from the chunk's canonical centre).
   * Whole texels of a 384 m window, so float32 holds it to well under a texel.
   */
  windowCenterCanonical: uniform(new THREE.Vector2(0, 0)),
  windowSize: uniform(WIND_WINDOW_METRES),
  /** Prevailing direction (unit) and strength, used beyond the window. */
  prevailing: uniform(new THREE.Vector2(1, 0)),
  prevailingStrength: uniform(0.18),
  /** The calm strength the materials' tuning was authored against. */
  referenceStrength: uniform(0.18),
});

/**
 * @param {object} worldXZ TSL vec2, render-space position
 * @returns {{ direction: object, strength: object, gust: object, envelope: object }}
 *   TSL nodes: unit direction, absolute strength, gust 0..1, and strength
 *   relative to the calm reference (1 in still air, several in a gust)
 */
export function sampleWorldWind(worldXZ) {
  return sampleWindWindow(worldXZ.sub(worldWindUniforms.windowCenter));
}

/**
 * As `sampleWorldWind`, for a canonical-space position. Passing a canonical
 * position to `sampleWorldWind` misses the window by the floating-origin offset,
 * and everything then sways to the flat prevailing wind with no gusts.
 *
 * @param {object} canonicalXZ TSL vec2, canonical position
 */
export function sampleWorldWindCanonical(canonicalXZ) {
  return sampleWindWindow(canonicalXZ.sub(worldWindUniforms.windowCenterCanonical));
}

/**
 * A render-space position in canonical metres, from the two window centres the
 * wind pass keeps in step — for materials that only know render space.
 *
 * @param {object} renderXZ TSL vec2
 */
export function canonicalFromRender(renderXZ) {
  return renderXZ.add(worldWindUniforms.windowCenterCanonical.sub(worldWindUniforms.windowCenter));
}

/**
 * Where a canonical point sits in the travelling wind waves: metres along and
 * across the PREVAILING direction.
 *
 * A wave's phase must not be taken against the local field direction. That
 * direction curls from texel to texel, and on a planet-scale map a canonical
 * position is hundreds of kilometres long, so a thousandth of a radian of curl
 * moves `dot(position, direction)` by hundreds of metres: neighbouring patches
 * fall onto unrelated phases and the sward breaks into swaths that sway apart.
 * The prevailing direction is one value for the whole world, so every stem
 * shares one wave; the local field still sets which way a stem bends and how
 * hard the gust pushes it.
 *
 * @param {object} canonicalXZ TSL vec2, canonical position
 * @returns {{ along: object, across: object }}
 */
export function windWaveCoordinates(canonicalXZ) {
  const { prevailing } = worldWindUniforms;
  return {
    along: dot(canonicalXZ, prevailing),
    across: dot(canonicalXZ, vec2(prevailing.y.negate(), prevailing.x)),
  };
}

/** @param {object} offset TSL vec2, metres from the window centre */
function sampleWindWindow(offset) {
  const { windowSize, prevailing, prevailingStrength, referenceStrength } = worldWindUniforms;
  const local = offset.div(windowSize);
  const edge = max(local.x.abs(), local.y.abs());
  const inside = float(1).sub(smoothstep(EDGE_FADE_START, 0.5, edge));
  const texel = texture(worldWindTarget.texture, local.add(0.5));
  const vector = mix(prevailing.mul(prevailingStrength), texel.xy, inside);
  const strength = vector.length();
  return {
    direction: vector.div(strength.max(1e-4)),
    strength,
    gust: texel.z.mul(inside),
    envelope: strength.div(referenceStrength.max(1e-4)),
  };
}
