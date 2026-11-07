import { Color } from 'three/webgpu';
import { Fn, If, clamp, float, fwidth, max, min, mix, oneMinus, smoothstep, vec2, vec3 } from 'three/tsl';
import { periodicFbm2, periodicVoronoiDistances } from './PeriodicNoiseNodes.js';

/** Pattern frames the ice reads; merged into the water's pattern origins. */
export const FROZEN_WATER_PATTERN_FRAMES = Object.freeze({
  iceMacro: { scale: 1 / 14 },
  iceCrack: { scale: 1 / 6 },
  iceCrackFine: { scale: 1 / 2.2 },
  iceCrackWarp: { scale: 1 / 3 },
});

const color = (hex) => { const c = new Color(hex); return vec3(c.r, c.g, c.b); };
const BLACK_ICE = color('#2a4b5c');
const CLEAR_ICE = color('#6f9fb2');
const WHITE_ICE = color('#c9dde4');
const SNOW = color('#eef3f5');
const CRACK = color('#e9f6fb');

/**
 * Water in the coldest country lies frozen where `cold` is glacier or tundra
 * (taiga, 0.55, stays open): lakes whole, and sea-kind water out to a ragged
 * edge some 30-60 m from shore. Every non-lake water tile is sea-kind, so that
 * freezes the small inland pools through and gives the open sea a band of
 * shore-fast ice, with open water (and the icebergs) beyond. Clear dark ice over
 * deep water, whiter ice toward the banks, wandering pressure cracks and
 * drifted snow patches. The sheet goes near-opaque there and loses its waves,
 * glint and foam; the caller gates those with `frozen`.
 *
 * @param {object} options
 * @param {object} options.appearance createWaterAppearanceNodes result
 * @param {object} options.patterns the water's PatternOrigins
 * @param {object} options.localXZ metres from the chunk centre
 * @param {object} options.waterDepth float node, metres
 * @param {object} options.currentStrength float node, 0..1
 * @param {object} options.shoreDistance float node, metres from the bank
 */
export function createFrozenWaterNodes({ appearance, patterns, localXZ, waterDepth, currentStrength, shoreDistance }) {
  if (!appearance || !patterns) return null;
  const macro = periodicFbm2(patterns.latticePoint('iceMacro', localXZ));
  const fastIce = oneMinus(smoothstep(30, 34, shoreDistance.add(macro.sub(0.5).mul(60))));
  // Ice is there or it is not: the cold share drifts over 16 m cells, and as a
  // straight weight it drew a wide foggy band between ice and open water.
  const frozen = smoothstep(0.4, 0.6, max(appearance.lake, appearance.ocean.mul(fastIce))
    .mul(smoothstep(0.72, 0.84, appearance.cold))
    .mul(oneMinus(smoothstep(0.08, 0.25, currentStrength))))
    .toVar('frozenWater');
  // Cracks: Voronoi cell edges (F2 - F1), warped so they run jagged rather than
  // straight. Contour lines of smooth noise looped like noodles. Only frozen
  // pixels pay the two 3x3 neighbourhoods.
  const crackEdges = (point, width) => {
    const distances = periodicVoronoiDistances(point, float(0), 0);
    let f1 = distances[0];
    let f2 = float(8);
    for (const distance of distances.slice(1)) {
      f2 = min(f2, max(f1, distance));
      f1 = min(f1, distance);
    }
    const gap = f2.sub(f1);
    const footprint = fwidth(gap).max(1e-4);
    return oneMinus(smoothstep(width, footprint.mul(1.5).add(width), gap))
      .mul(oneMinus(smoothstep(0.08, 0.3, footprint)));
  };
  const cracks = Fn(() => {
    const result = float(0).toVar();
    If(frozen.greaterThan(0.001), () => {
      const warp = vec2(
        periodicFbm2(patterns.latticePoint('iceCrackWarp', localXZ)),
        periodicFbm2(patterns.latticePoint('iceCrackWarp', localXZ).add(vec2(37.1, 11.9))),
      ).sub(0.5).mul(0.6);
      result.assign(max(
        crackEdges(patterns.latticePoint('iceCrack', localXZ).add(warp), 0.025),
        crackEdges(patterns.latticePoint('iceCrackFine', localXZ).add(warp.mul(1.6)), 0.02).mul(0.5),
      ));
    });
    return result;
  })();
  const depthShade = smoothstep(0.4, 4, waterDepth);
  const body = mix(mix(WHITE_ICE, CLEAR_ICE, smoothstep(0.1, 0.9, depthShade)), BLACK_ICE,
    smoothstep(0.55, 1, depthShade).mul(smoothstep(0.35, 0.7, macro)));
  // Snow drifts onto the ice in patches, thicker near the banks.
  const snow = smoothstep(0.5, 0.7, macro.add(oneMinus(depthShade).mul(0.25)));
  const ice = mix(mix(body, CRACK, cracks.mul(0.7)), SNOW, snow);
  return {
    frozen,
    color(base) { return mix(base, ice, frozen); },
    // Ice is solid to the bank: the thin-water fade only softens its last edge.
    alpha(base, waterlineFade, distanceFade) {
      return mix(base, clamp(waterlineFade.mul(4), 0, 1).mul(0.98).mul(distanceFade), frozen);
    },
    /** Waves, glints and foam: none on ice. */
    open: oneMinus(frozen),
  };
}
