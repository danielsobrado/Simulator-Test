import { Fn, If, abs, cameraWorldMatrix, dFdx, dFdy, float, int, mix, normalize, sin, smoothstep, texture, vec2, vec3, vec4 } from 'three/tsl';
import { GROUND_LAYERS } from '../stylized/path/groundLayerIds.js';

/** Texture repeat: a power of two, so it closes across the 1024 m canonical wrap. */
const REPEAT_METERS = 16;
const CANONICAL_PERIOD = 1024;
const LUMINANCE = vec3(0.3, 0.55, 0.15);
const STONE_MEAN = 0.24;
const STRATA_METERS = 5.5;
const STRATA_DEPTH = 0.16;
/** Angular frequency of `cycles` waves per canonical wrap, so a warp closes across it. */
const wave = (cycles) => (cycles * Math.PI * 2) / CANONICAL_PERIOD;

/**
 * Stone on the terrain's rock faces: the ground-layer array's rock scan projected
 * along the cliff, so a face reads as stone rather than a stretched ground texture.
 * The array is already bound; this adds no sampler, which the terrain has none of.
 *
 * @param {object} [options.strata] 0..1 bedding strength: snow country passes
 *   less, its snow-plastered faces showing the 1 m seams as contour stripes
 * @returns {object} the colour with stone over `rock`
 */
export function applyTerrainRockDetail({ color, rock, normal, local, chunkCenter, height, textures, strata: bedding = float(1) }) {
  const point = chunkCenter.mod(CANONICAL_PERIOD).add(local);
  // Before the branch: screen derivatives need uniform control flow.
  const projections = [vec2(point.y, height), point, vec2(point.x, height)].map((plane) => {
    const uv = plane.div(REPEAT_METERS).toVar();
    return { uv, grad: [dFdx(uv).toVar(), dFdy(uv).toVar()] };
  });
  const world = normalize(cameraWorldMatrix.mul(vec4(normal, 0)).xyz).toVar();
  const blend = abs(world).pow(vec3(4)).toVar();
  const weights = blend.div(blend.x.add(blend.y).add(blend.z)).toVar();
  return Fn(() => {
    const result = color.toVar();
    If(rock.greaterThan(0.02), () => {
      const layer = int(GROUND_LAYERS.rock);
      const tap = ({ uv, grad }) => texture(textures.colorRoughness, uv).grad(...grad).depth(layer).rgb;
      const sampled = tap(projections[0]).mul(weights.x).add(tap(projections[1]).mul(weights.y)).add(tap(projections[2]).mul(weights.z));
      const stone = sampled.dot(LUMINANCE).div(STONE_MEAN).clamp(0.35, 1.9);
      // Beds that wander up and down along the face, in two thicknesses, some
      // pronounced and some faint: one even sine read as ruled stripes across a wall.
      const warp = sin(point.x.mul(wave(18)).add(sin(point.y.mul(wave(11))).mul(2)))
        .mul(1.6).add(sin(point.y.mul(wave(27))).mul(1.1));
      const bedHeight = height.add(warp);
      const beds = sin(bedHeight.div(STRATA_METERS).mul(Math.PI * 2))
        .mul(sin(bedHeight.div(STRATA_METERS * 3.7).mul(Math.PI * 2)).mul(0.5).add(0.75));
      const seams = sin(bedHeight.div(STRATA_METERS * 0.23).mul(Math.PI * 2)).mul(0.35);
      const strata = beds.add(seams).mul(STRATA_DEPTH).mul(bedding).add(1);
      result.assign(mix(result, result.mul(stone).mul(strata), smoothstep(0.15, 0.55, rock)));
    });
    return result;
  })();
}
