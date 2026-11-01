import {
  Fn,
  If,
  cameraPosition,
  color as colorNode,
  dFdx,
  dFdy,
  distance,
  dot,
  float,
  floor,
  fract,
  fwidth,
  int,
  mix,
  positionWorld,
  sin,
  smoothstep,
  texture,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';
import { GROUND_LAYER_MEAN, GROUND_LAYERS } from './groundLayerIds.js';

/**
 * grass-test's path surface (`GroundMaterial`, cinematic style), on this
 * project's terrain.
 *
 * The donor paints a path from a real dirt texture set (`ground_0109`), pulled
 * 48% toward its `groundPath` tint scaled by the texture's own red; it breaks
 * the soft path mask's contour with turf fibres and a macro wave, so grass and
 * soil interpenetrate at the edge instead of meeting on a clean line; and it
 * paints the verge beside the tread as worn turf — duller, browner, broken by
 * soil patches. This is that, verbatim in its constants; what changes is only
 * where the mask comes from (the terrain's own path/road mask) and the
 * coordinates, because this map is not 960 units across:
 *
 *  - The dirt tiles a whole number of times per terrain chunk, so the texture
 *    UV is the chunk UV times an integer — exact at planet scale, where a
 *    world-space UV would have lost its low bits.
 *  - The noise runs in donor units (2.8 per metre) over chunk-local metres
 *    wrapped every `NOISE_PERIOD_METRES`, for the same reason.
 */
export const DEFAULT_PATH_PAINT = Object.freeze({
  enabled: true,
  /** The donor's `cinematic.style.groundPath`. */
  color: '#b7a476',
  /** How far the dirt is pulled toward that tint (donor 0.48). */
  tint: 0.48,
  /** Metres per repeat of the dirt texture (donor: 960 units / 70 ≈ 4.9 m). */
  repeatMeters: 4.9,
  /** Verge wear strength, 0 turns the worn verge off. */
  verge: 1,
});

const DONOR_UNITS_PER_METRE = 2.8;
const NOISE_PERIOD_METRES = 1024;
/** The donor's `ground.antiTiling`. */
const ANTI_TILING = Object.freeze({
  secondaryScale: 0.618,
  offset: [0.37, 0.61],
  macroFrequencyX: 0.012,
  macroFrequencyZ: 0.016,
  warpFrequency: 0.009,
  warpStrength: 2.1,
  blendStart: 0.18,
  blendEnd: 0.82,
  colorVariation: 0.16,
  roughnessVariation: 0.1,
});

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** @param {object | undefined} source `stylizedSurface.path.paint` */
export function resolvePathPaint(source) {
  if (source?.enabled === false) return null;
  const paint = { ...DEFAULT_PATH_PAINT, ...(source ?? {}) };
  if (typeof paint.color !== 'string' || !HEX_COLOR.test(paint.color)) {
    throw new Error('Invalid editor configuration: stylizedSurface.path.paint.color must be a #rrggbb colour.');
  }
  for (const [key, min, max] of [['tint', 0, 1], ['repeatMeters', 0.5, 64], ['verge', 0, 1]]) {
    if (!Number.isFinite(paint[key]) || paint[key] < min || paint[key] > max) {
      throw new Error(`Invalid editor configuration: stylizedSurface.path.paint.${key} must be in [${min}, ${max}].`);
    }
  }
  return paint;
}

// The donor's GroundTurf noise: smooth random height with its analytic gradient.
const turfNoise = Fn(([p]) => {
  const cell = floor(p);
  const local = fract(p);
  const weight = local.mul(local).mul(local).mul(local.mul(local.mul(6).sub(15)).add(10));
  const hash = (offset) => fract(sin(dot(cell.add(offset), vec2(127.1, 311.7))).mul(43758.5453));
  const a = hash(vec2(0, 0));
  const b = hash(vec2(1, 0));
  const c = hash(vec2(0, 1));
  const d = hash(vec2(1, 1));
  return mix(mix(a, b, weight.x), mix(c, d, weight.x), weight.y).mul(2).sub(1);
}, 'float');

// The donor's `groundTurf` fibres and tufts: their coordinates, and how much of
// each band survives before it goes sub-pixel. Derivatives, so built outside any
// branch — WGSL allows `fwidth` only in uniform control flow.
function turfLayers(world) {
  const bend = vec2(sin(dot(world, vec2(0.73, 1.21))), sin(dot(world, vec2(-1.13, 0.67)))).mul(0.18);
  const p = world.add(bend);
  const layers = [
    vec2(dot(p, vec2(18, 7)), dot(p, vec2(-1.5, 3.8))),
    vec2(dot(p, vec2(-9, 16)), dot(p, vec2(-3.5, -2))).add(23.7),
    vec2(dot(world, vec2(5.2, -3.9)), dot(world, vec2(3.9, 5.2))).add(41.3),
  ];
  return layers.map((coords) => {
    const footprint = fwidth(coords);
    return {
      coords: coords.toVar(),
      fade: smoothstep(0.25, 0.9, footprint.x.max(footprint.y)).oneMinus().toVar(),
    };
  });
}

// The donor's turf pigment from those layers.
function turfPigment([a, b, c]) {
  return turfNoise(a.coords).mul(a.fade).mul(0.45)
    .add(turfNoise(b.coords).mul(b.fade).mul(0.35))
    .add(turfNoise(c.coords).mul(c.fade).mul(0.2));
}

function floorMod(value, period) {
  return value.sub(floor(value.div(period)).mul(period));
}

/**
 * @param {object} options
 * @param {object} options.terrainUv chunk uv
 * @param {number} options.chunkWorldSize metres
 * @param {object} options.chunkCenter vec2 uniform, canonical chunk centre
 * @param {object} options.pathMask 0..1 path/road mask (the donor's path texture R)
 * @param {object} options.verge 0..1 verge band beside the tread
 * @param {object | null} options.settings resolvePathPaint()
 * @param {{ colorRoughness: object } | null} options.textures acquireGroundLayers()
 * @param {{ layers: object, blend: object } | null} [options.floor] floor scans:
 *   layers.xy are array indices, blend moves from x to y
 * @returns {{ apply: (color: object, roughness: object) => { color: object, roughness: object } } | null}
 */
export function createTerrainPathPaint({
  terrainUv, chunkWorldSize, chunkCenter, pathMask, verge, settings, textures, floor: floorScan = null,
}) {
  if (!settings || !textures) return null;
  const repeats = Math.max(1, Math.round(chunkWorldSize / settings.repeatMeters));
  const secondaryRepeats = Math.max(1, Math.round(repeats * ANTI_TILING.secondaryScale));
  const local = vec2(
    floorMod(chunkCenter.x, NOISE_PERIOD_METRES).add(terrainUv.x.sub(0.5).mul(chunkWorldSize)),
    floorMod(chunkCenter.y, NOISE_PERIOD_METRES).add(terrainUv.y.oneMinus().sub(0.5).mul(chunkWorldSize)),
  );

  return {
    apply(baseColor, baseRoughness) {
      const paint = Fn(() => {
        const world = local.mul(DONOR_UNITS_PER_METRE).toVar();
        // Smooth world-space warp, a tile or so over ~15 m: the 4.9 m repeat never lines
        // up into rows along a trail. World-based, so it stays continuous across chunks.
        const warp = vec2(
          sin(world.y.mul(0.041).add(sin(world.x.mul(0.023)).mul(2.1))),
          sin(world.x.mul(0.037).add(sin(world.y.mul(0.029)).mul(1.7))),
        ).mul(0.42).toVar();
        const uvA = terrainUv.mul(repeats).add(warp).toVar();
        const uvB = terrainUv.mul(secondaryRepeats).add(vec2(...ANTI_TILING.offset)).sub(warp.mul(0.7)).toVar();
        // Everything that needs screen derivatives, before the branch.
        const gradA = [dFdx(uvA).toVar(), dFdy(uvA).toVar()];
        const gradB = [dFdx(uvB).toVar(), dFdy(uvB).toVar()];
        const turfLayer = turfLayers(world);
        const result = vec4(baseColor, baseRoughness).toVar();
        // The ground has no texture of its own: lay a neutral scan over it near the
        // viewer, so the palette keeps the hue and the scan brings the structure, with
        // no brightness ring where it fades. Past 45 m the branch skips both taps.
        const floorFade = smoothstep(14, 45, distance(cameraPosition, positionWorld)).oneMinus().toVar();
        If(floorFade.greaterThan(0), () => {
          const scan = (uv, grad, layer) => texture(textures.colorRoughness, uv).grad(...grad).depth(layer).rgb;
          const layerA = floorScan ? floorScan.layers.x.round().toInt() : int(GROUND_LAYERS.grit);
          const layerB = floorScan ? floorScan.layers.y.round().toInt() : layerA;
          const detail = mix(scan(uvA, gradA, layerA), scan(uvB, gradB, layerB), floorScan?.blend ?? float(0));
          result.assign(vec4(result.xyz.mul(mix(vec3(1), detail.div(GROUND_LAYER_MEAN).clamp(0.45, 1.8), floorFade.mul(0.85))), result.w));
        });
        const mask = pathMask.toVar();
        const vergeBand = verge.toVar();
        // Only a path and its verge are painted: elsewhere (nearly all the
        // terrain) the whole paint is skipped. Unbranched it cost a third of the
        // frame rate (chunk-cross 53 vs 77 fps).
        // Below 0.03 the dithered contour cannot reach the soil threshold; the
        // natural-trail mask's soft tail stays under it across open ground.
        If(mask.max(vergeBand).greaterThan(0.03), () => {
          // Anti-tiling: a second, rescaled tap blended by a slow warped wave.
          const macroTile = sin(world.x.mul(ANTI_TILING.macroFrequencyX)
            .add(sin(world.y.mul(ANTI_TILING.warpFrequency)).mul(ANTI_TILING.warpStrength)))
            .mul(sin(world.y.mul(ANTI_TILING.macroFrequencyZ)
              .add(sin(world.x.mul(ANTI_TILING.warpFrequency * 1.37)).mul(ANTI_TILING.warpStrength * 0.63))))
            .mul(0.5).add(0.5).toVar();
          const tileBlend = macroTile.smoothstep(ANTI_TILING.blendStart, ANTI_TILING.blendEnd);
          const dirt = mix(
            texture(textures.colorRoughness, uvA).grad(...gradA).depth(int(0)),
            texture(textures.colorRoughness, uvB).grad(...gradB).depth(int(0)),
            tileBlend,
          ).toVar();
          // Broad damp hollows and sun-bleached runs, so no stretch of trail is one tone.
          const damp = sin(world.x.mul(0.083).add(sin(world.y.mul(0.11)).mul(1.9)))
            .mul(sin(world.y.mul(0.067).add(sin(world.x.mul(0.13)).mul(1.4)))).mul(0.5).add(0.5).smoothstep(0.35, 0.8);
          const ground = dirt.rgb
            .mul(mix(1 - ANTI_TILING.colorVariation, 1 + ANTI_TILING.colorVariation, macroTile))
            .mul(mix(vec3(1.08, 1.05, 1.0), vec3(0.72, 0.7, 0.68), damp)).toVar();
          const soilRoughness = dirt.a
            .add(macroTile.sub(0.5).mul(ANTI_TILING.roughnessVariation * 2)).clamp(0, 1);
          const pathPaint = mix(ground, colorNode(settings.color).mul(ground.r.mul(0.65).add(0.65)), settings.tint)
            .toVar();
          // The contour, broken by turf fibre and the macro wave.
          const macro = sin(world.x.mul(0.037).add(sin(world.y.mul(0.053)))).mul(sin(world.y.mul(0.071)))
            .mul(0.5).add(0.5);
          const turf = turfPigment(turfLayer);
          const soilEdge = smoothstep(0.12, 0.88, mask.add(turf.mul(0.09)).add(macro.sub(0.5).mul(0.06))).toVar();
          // The ground as the terrain painted it, read from the variable: naming
          // `baseColor` here would re-emit its whole graph inside the branch.
          const grass = result.xyz;
          let earth = mix(grass, pathPaint, soilEdge);
          if (settings.verge > 0) {
            // The verge as worn, trampled turf: duller and browner, broken by soil patches.
            const patches = sin(world.x.mul(0.61).add(sin(world.y.mul(0.43)).mul(1.7)))
              .mul(sin(world.y.mul(0.57).add(sin(world.x.mul(0.37)).mul(1.3)))).mul(0.5).add(0.5);
            const soilPatch = patches.add(turf.mul(0.35)).smoothstep(0.45, 0.85);
            const dull = mix(vec3(dot(grass, vec3(0.3, 0.59, 0.11))), grass, 0.5).mul(vec3(1, 0.94, 0.76));
            const worn = mix(dull, pathPaint.mul(0.92), soilPatch.mul(0.55).add(0.18));
            earth = mix(earth, worn, vergeBand.mul(soilEdge.oneMinus()).mul(settings.verge));
          }
          // Damp-free soil stays rough (the donor's `groundRoughness`, dry branch).
          const roughness = mix(result.w, soilRoughness.max(0.65), soilEdge);
          result.assign(vec4(earth, roughness));
        });
        return result;
      })();
      return { color: paint.xyz, roughness: paint.w };
    },
  };
}
