import {
  Fn, If, cameraViewMatrix, clamp, float, floor, fract, length, mix, normalize, oneMinus, select, smoothstep, time, vec2, vec3, vec4,
} from 'three/tsl';

import { surfaceWetnessUniform } from '../weather/surfaceWetness.js';
import { stormRainUniform } from '../weather/storm/stormGroundUniforms.js';

/** Metres per ripple cell: one ring per cell (storm plan §5.1). */
const RIPPLE_CELL = 0.5;
/** Wetness below which no puddle stands, so a dry frame skips the whole block. */
const PUDDLE_WETNESS = 0.45;

function hash(cell) {
  return fract(cell.dot(vec2(12.9898, 78.233)).sin().mul(43758.5453));
}

/**
 * Standing water after rain on flat, hollow ground (storm plan §5.1): darker,
 * near-mirror smooth and facing straight up, so the sky and sun reflect through
 * the existing environment lighting — no reflection pass, no viewport texture.
 * Puddles open in the deepest hollows first and spread as the ground soaks
 * (`surfaceWetnessUniform`), then shrink back as it dries. While rain falls,
 * one ring per 0.5 m cell spreads across them.
 *
 * @param {object} options
 * @param {Node} options.shape baked slope (r, tan) and curvature (g)
 * @param {Node} options.exposure 0..1 open to the rain (not snowed, not under canopy)
 * @param {Node} options.water 0..1 open water or shoreline, which take no puddles
 * @param {Node} options.worldXZ wrapped world metres
 */
export function createPuddleShading({ shape, exposure, water, worldXZ }) {
  const mask = Fn(() => {
    const result = float(0).toVar();
    If(surfaceWetnessUniform.greaterThan(PUDDLE_WETNESS), () => {
      const flat = oneMinus(smoothstep(0.08, 0.22, shape.r));
      const hollow = smoothstep(0.47, 0.56, clamp(shape.g.mul(8).add(0.5), 0, 1));
      const broken = worldXZ.x.mul(0.31).sin().mul(worldXZ.y.mul(0.27).add(worldXZ.x.mul(0.11)).sin()).mul(0.25).add(0.75);
      const basin = flat.mul(hollow).mul(broken).mul(exposure).mul(oneMinus(water));
      const spread = smoothstep(PUDDLE_WETNESS, 0.9, surfaceWetnessUniform);
      result.assign(smoothstep(oneMinus(spread), oneMinus(spread).add(0.12), basin));
    });
    return result;
  })().toVar('puddle');

  // World-space normal tilt from the rings, zero when dry or between drops.
  const ripple = Fn(() => {
    const result = vec2(0).toVar();
    If(stormRainUniform.greaterThan(0.01).and(mask.greaterThan(0)), () => {
      const p = worldXZ.div(RIPPLE_CELL);
      const cell = floor(p);
      const seed = hash(cell);
      const offset = fract(p).sub(0.5).sub(vec2(seed, fract(seed.mul(7.13))).sub(0.5).mul(0.4));
      const age = fract(time.mul(stormRainUniform.mul(1.2).add(0.4)).add(seed));
      const distance = length(offset);
      const ring = smoothstep(0.06, 0, distance.sub(age.mul(0.45)).abs()).mul(oneMinus(age));
      result.assign(offset.div(distance.max(1e-3)).mul(ring).mul(0.35));
    });
    return result;
  })();

  return {
    mask,
    apply(color, roughness) {
      return { color: mix(color, color.mul(0.6), mask), roughness: mix(roughness, float(0.06), mask) };
    },
    /** @param {Node} normal view-space surface normal */
    normal(normal) {
      const up = cameraViewMatrix.mul(vec4(normalize(vec3(ripple.x, 1, ripple.y)), 0)).xyz;
      // Untouched off the puddles: renormalizing the terrain's normal shifted dry shading.
      return select(mask.greaterThan(0), normalize(mix(normal, up, mask)), normal);
    },
  };
}
