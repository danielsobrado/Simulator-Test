import { frameUniform } from '../../../render/FrameUniforms.js';
import {
  Fn,
  If,
  cameraPosition as cameraPositionNode,
  color,
  exp,
  float,
  mix,
  positionWorld as positionWorldNode,
  smoothstep,
  time as timeNode,
  vec2,
  vec3,
} from 'three/tsl';

import { canonicalFromRender } from '../../weather/wind/worldWindState.js';
import { Color } from 'three/webgpu';

import { stylizedFbm2 } from '../StylizedNoiseNodes.js';

/**
 * Humid ground mist between the jungle trees — after grass-test's jungle mist
 * (`src/rendering/jungleMist.js`, applied in `CinematicPipeline.#jungleMist`).
 *
 * THE DONOR, AND WHY IT CANNOT BE PORTED AS WRITTEN
 *
 * The donor runs the mist in the post pass. To do so it reconstructs each
 * pixel's view ray and — from the *resolved depth buffer*
 * (`perspectiveDepthToViewZ(stage.depth…)`) — the distance to the surface the
 * pixel shows, then blends the mist over the *scene colour texture*. Both are
 * viewport reads this project refuses where they can be avoided.
 *
 * WHAT IS PORTED INSTEAD, AND WHY IT NEEDS NEITHER
 *
 * The donor's own comment says the reason it is a post effect is a *cost*: as a
 * fog node it "ran for every fragment of the jungle's alpha-tested foliage,
 * whose overdraw defeats early depth rejection". It is not that the maths needs
 * the framebuffer — it does not. The density falls off exponentially with height
 * above one ground level, so the integral along the ray has a closed form: one
 * `exp` pair and one noise tap, no march. The *only* framebuffer input is
 * `length`, the distance to the surface the pixel shows.
 *
 * In a material that value is free. `cameraPosition.distance(positionWorld)` is
 * the distance to the fragment being shaded — the very surface `length` was
 * resolved from depth to reach, and the same quantity the valley fog port
 * marches toward (`mist/ValleyFogShading.js`). So the closed form ports exactly,
 * with `cameraPosition` standing in for the donor's `eye`, `worldPosition` for
 * its surface point, and a `ground` node for its eased terrain height under the
 * view. Nothing is read: no depth buffer, no scene colour texture, no planar
 * reflection, no cube probe. It is a pure function of the ray, the ground level
 * and the clock.
 *
 * The cost argument flips back the other way — a material node runs once per
 * shaded fragment rather than once per screen pixel — but that is the trade this
 * project's rule makes deliberately, and the closed form is *cheaper* than the
 * valley fog port's six-step march: no loop, no height-texture fetches. It is
 * gated three ways: `enabled` (this returns `null`, so the material keeps the
 * colour it already had), a runtime region weight (`weight`, the ambient layer's
 * `jungle` weight × preset × strength) below which a single branch skips the
 * whole thing, and the quality share.
 *
 * The sky is left alone, as in the donor: the mist is blended into the ground and
 * foliage materials a pixel actually shows, and scene fog already leaves the sky
 * dome.
 *
 * HOME: this is the same kind of node graph as the valley fog — a quality-gated,
 * region-weighted volumetric mist blended into a material as
 * `mix(base, color, amount)` — so it is deliberately kept to the ambient file
 * family's shape (config + nodes in one file, like `BlownStreaks`/`FrostShading`)
 * rather than split across `mist/`. Its authority, the region weight, the ground
 * level and the strength, is the ambient layer's, so it lives where its driver
 * lives.
 */

/** Below this region weight the mist is skipped; a uniform at zero costs one compare. */
const ACTIVE_WEIGHT = 0.001;
/** Below this height difference along the ray the closed form's divide is replaced by its limit. */
const FLAT_RAY = 0.05;

export const DEFAULT_JUNGLE_MIST = Object.freeze({
  enabled: true,
  strength: 1,
  // The donor ships presets { rainy: 1.4, goldenHour: 1.1, moonlight: 1.2,
  // windy: 0.5 } with the default weight (1).
  presetDefault: 1,
  // Optical depth per metre at full density, before the region weight.
  density: 0.006,
  // Metres above the mist's ground at which the density has fallen by 1/e.
  height: 6,
  // Metres. The mist fades out by here; no height field is marched, so this is
  // purely the reach of the closed form, not a patch bound.
  maxDistance: 260,
  // Metres along the ray: the first span stays clear so the player is never
  // fogged in, the mist reaches full density by the second (donor nearStart/nearEnd).
  nearClear: Object.freeze([12, 45]),
  // 1/m: the scale of the drifting pocket noise that breaks the sheet into banks.
  pocketScale: 0.02,
  // 0..1: how much the pockets vary the sheet from empty gaps to thick banks.
  pocketStrength: 0.35,
  // m/s: how fast the pockets slide across and along.
  drift: Object.freeze([0.6, 0.25]),
  // The most of the pixel the mist may take, so a view into thick mist still
  // shows what is behind it (the donor's factor clamp).
  ceiling: 0.50,
  // The cool, green-lit ground mist colour (donor '#c9d6c4').
  color: '#b7c6bc',
});

/**
 * The ambient layer writes these once a frame; a material only reads them.
 * `weight` is the jungle region weight × preset × strength, `ground` the eased
 * terrain height under the view that the mist lies on (the donor's
 * `values.mistGround`), and `sun`/`fill` the scene's sun and sky light (colour ×
 * intensity / π) the mist is lit by.
 */
export const jungleMistUniforms = Object.freeze({
  weight: frameUniform(0),
  ground: frameUniform(0),
  sun: frameUniform(new Color(1, 1, 1)),
  fill: frameUniform(new Color(0.5, 0.6, 0.7)),
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstepNumber(edge0, edge1, x) {
  if (edge1 === edge0) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function finite(value, fallback, path, { min = -Infinity, max = Infinity } = {}) {
  const resolved = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(resolved) || resolved < min || resolved > max) {
    throw new Error(`Invalid editor configuration: ${path} must be a finite number in range.`);
  }
  return resolved;
}

function presetWeights(value, path) {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error(`Invalid editor configuration: ${path} must map preset names to weights.`);
  return Object.fromEntries(Object.entries(value)
    .map(([preset, weight]) => [preset, finite(weight, 0, `${path}.${preset}`, { min: 0, max: 4 })]));
}

/**
 * Resolves the jungle mist settings from the ambient layer's block (raw
 * `ambientEffects` or the resolved `stylizedSurface.ambientEffects`). Mirrors the
 * donor's `resolveJungleMistConfig`; `strength`/`presets` are carried through for
 * the caller's region weight, but the node uses only the shape keys — `weight` is
 * where the region, preset and strength have already been folded.
 *
 * @param {object} [ambientEffects] `ambientEffects` block
 * @returns {{ enabled: boolean, strength: number, presets: object, presetDefault: number,
 *   density: number, height: number, maxDistance: number, nearClear: number[],
 *   pocketScale: number, pocketStrength: number, drift: number[], ceiling: number, color: string }}
 */
export function resolveJungleMistConfig(ambientEffects) {
  const source = isRecord(ambientEffects) ? ambientEffects : {};
  const path = 'ambientEffects.jungleMist';
  if (source.enabled === false) return { enabled: false };
  const configured = isRecord(source.jungleMist) ? source.jungleMist : {};
  if (configured.enabled === false) return { enabled: false };

  // The donor keys these two separately; the node wants them as a rising pair.
  // Either the donor's `nearStart`/`nearEnd` or an already-resolved `nearClear`
  // pair is accepted, so the resolver round-trips through its own output.
  let nearStartValue = configured.nearStart;
  let nearEndValue = configured.nearEnd;
  if (configured.nearClear !== undefined) {
    if (!Array.isArray(configured.nearClear) || configured.nearClear.length !== 2) {
      throw new Error(`Invalid editor configuration: ${path}.nearClear must be a [start, end] pair.`);
    }
    [nearStartValue, nearEndValue] = configured.nearClear;
  }
  const nearStart = finite(nearStartValue, DEFAULT_JUNGLE_MIST.nearClear[0], `${path}.nearStart`, { min: 0 });
  const nearEnd = finite(nearEndValue, DEFAULT_JUNGLE_MIST.nearClear[1], `${path}.nearEnd`, { min: 0 });
  if (!(nearEnd > nearStart)) {
    throw new Error(`Invalid editor configuration: ${path}.nearEnd must be greater than ${path}.nearStart.`);
  }

  const color = configured.color;
  if (color !== undefined && (typeof color !== 'string' || color.length === 0)) {
    throw new Error(`Invalid editor configuration: ${path}.color must be a color string.`);
  }

  const drift = configured.drift;
  if (drift !== undefined && (!Array.isArray(drift) || drift.length !== 2)) {
    throw new Error(`Invalid editor configuration: ${path}.drift must be an [across, along] pair.`);
  }

  return {
    enabled: true,
    strength: finite(configured.strength, DEFAULT_JUNGLE_MIST.strength, `${path}.strength`, { min: 0, max: 4 }),
    presets: presetWeights(configured.presets, `${path}.presets`),
    presetDefault: finite(configured.presetDefault, DEFAULT_JUNGLE_MIST.presetDefault, `${path}.presetDefault`, { min: 0, max: 4 }),
    density: finite(configured.density, DEFAULT_JUNGLE_MIST.density, `${path}.density`, { min: 0 }),
    height: finite(configured.height, DEFAULT_JUNGLE_MIST.height, `${path}.height`, { min: 1e-3 }),
    maxDistance: finite(configured.maxDistance, DEFAULT_JUNGLE_MIST.maxDistance, `${path}.maxDistance`, { min: 1 }),
    nearClear: [nearStart, nearEnd],
    pocketScale: finite(configured.pocketScale, DEFAULT_JUNGLE_MIST.pocketScale, `${path}.pocketScale`, { min: 1e-6 }),
    pocketStrength: finite(configured.pocketStrength, DEFAULT_JUNGLE_MIST.pocketStrength, `${path}.pocketStrength`, { min: 0, max: 1 }),
    drift: drift
      ? [finite(drift[0], 0, `${path}.drift[0]`), finite(drift[1], 0, `${path}.drift[1]`)]
      : [...DEFAULT_JUNGLE_MIST.drift],
    ceiling: finite(configured.ceiling, DEFAULT_JUNGLE_MIST.ceiling, `${path}.ceiling`, { min: 0, max: 1 }),
    color: typeof color === 'string' && color ? color : DEFAULT_JUNGLE_MIST.color,
  };
}

/**
 * The closed-form mean density along a ray, times its reach: `exp(-h / scale)`
 * integrated over `[start, end]`, `start = eye.y - ground` and `end` its value at
 * the far end of the reach. A level ray takes the divide's limit, so it never
 * produces a NaN. Pure, and the CPU twin of the node's arithmetic.
 *
 * @param {object} options
 * @param {number} options.start height above the mist's ground at the near end, metres
 * @param {number} options.end height above the mist's ground at the far end, metres
 * @param {number} options.scale the density height, metres
 * @param {number} options.reach how far the ray runs through the mist, metres
 * @param {number} [options.flat] the height difference below which the ray is level
 */
export function jungleMistIntegral({ start, end, scale, reach, flat = FLAT_RAY }) {
  const s = Math.max(Number(start) || 0, 0);
  const e = Math.max(Number(end) || 0, 0);
  const rise = e - s;
  const startDensity = Math.exp(-s / scale);
  const endDensity = Math.exp(-e / scale);
  const sloped = (startDensity - endDensity) * scale / (Math.abs(rise) < flat ? flat : rise);
  return (Math.abs(rise) < flat ? startDensity : sloped) * reach;
}

/**
 * The pocket banks, 0..(1 + strength): the signed noise (0±1) eased through a
 * `smoothstep`, mapped onto `[1 - strength, 1 + strength]`. This is what breaks
 * the sheet into drifting banks rather than an even fog. Pure.
 *
 * @param {object} options
 * @param {number} options.noise signed pocket noise at the point, −1..1
 * @param {number} options.strength 0..1
 */
export function jungleMistBanks({ noise, strength }) {
  return (1 - strength) + 2 * strength * smoothstepNumber(-0.45, 0.45, Number(noise));
}

/**
 * The fraction of the pixel the mist takes: `1 - exp(-opticalDepth)`, clamped to
 * the ceiling so what is behind it always shows through. Pure.
 *
 * @param {object} options
 * @param {number} options.opticalDepth
 * @param {number} [options.ceiling] the most it may take, 0..1
 */
export function jungleMistOpticalDepth({start,end,reach,weight,density=DEFAULT_JUNGLE_MIST.density,
  quality=1,noise=0,settings=DEFAULT_JUNGLE_MIST}) {
  for(const [key,value] of Object.entries({start,end,reach,weight,density,quality,noise})) {
    if(!Number.isFinite(value))throw new Error(`Jungle mist ${key} must be finite.`);
  }
  if(weight<0||density<0||quality<0||reach<0)throw new Error('Jungle mist density, weight, quality and reach must be nonnegative.');
  if(weight<=ACTIVE_WEIGHT)return 0;
  const length=Math.min(reach,settings.maxDistance);
  return jungleMistIntegral({start,end,scale:settings.height,reach:length})
    * jungleMistBanks({noise,strength:settings.pocketStrength})
    * smoothstepNumber(settings.nearClear[0],settings.nearClear[1],length)
    * density * quality * Math.min(4,weight);
}

export function jungleMistFactor({ opticalDepth, ceiling = DEFAULT_JUNGLE_MIST.ceiling }) {
  return Math.max(0, Math.min(1 - Math.exp(-Math.max(Number(opticalDepth) || 0, 0)), ceiling));
}

/**
 * Humid ground mist a material blends in as `mix(base, color, amount)`.
 * Returns `null` when the effect is off, so the material keeps the colour it
 * already had.
 *
 * @param {object} options
 * @param {object} [options.worldPosition] positionWorld node for the shaded fragment
 * @param {object} [options.cameraPosition] cameraPosition node, the ray's origin (the donor's `eye`)
 * @param {object} [options.ground] the eased terrain height under the view, metres
 *   (`jungleMistUniforms.ground` by default; `groundPatch.heightNode(cameraPosition.x, cameraPosition.z)` also fits)
 * @param {object} [options.weight] 0..1 region weight node; `jungleMistUniforms.weight` by default
 * @param {object} [options.time] seconds, for the drifting pockets
 * @param {number} [options.quality] quality share 0..1; `<= 0` builds nothing
 * @param {object} options.settings resolved by `resolveJungleMistConfig`
 * @param {object} [options.fogColor] scene fog colour, to tint the mist toward
 * @param {object} [options.sunColor] sun colour × intensity, for the lit tint
 * @param {object} [options.fill] the sky's fill light, for the lit tint
 * @returns {{ amount: object, color: object } | null} `null` when there is
 *   nothing to build and the caller keeps its own material
 */
export function createJungleMistNodes({
  worldPosition = positionWorldNode,
  cameraPosition = cameraPositionNode,
  ground = jungleMistUniforms.ground,
  weight = jungleMistUniforms.weight,
  time = timeNode,
  quality = 1,
  settings,
  fogColor = null,
  sunColor = null,
  fill = null,
}) {
  if (!settings?.enabled || !(Number(quality) > 0)) return null;

  const drift = vec2(settings.drift[0], settings.drift[1]);

  // Built from the fragment's own ray, so the surface distance is the shaded
  // fragment's — no depth buffer involved. Below the region weight a single
  // branch skips the closed form, so a world with no jungle pays one compare.
  const opticalDepth = Fn(() => {
    const depth = float(0).toVar();
    If(weight.greaterThan(ACTIVE_WEIGHT), () => {
      const ray = worldPosition.sub(cameraPosition);
      const length = ray.length();
      const direction = ray.div(length.max(1e-4));
      const reach = length.min(settings.maxDistance);
      const scale = float(settings.height);
      // Heights above the mist's ground, clamped so a camera below that level
      // does not see exponentially dense fog.
      const start = cameraPosition.y.sub(ground).max(0);
      const end = start.add(direction.y.mul(reach)).max(0);
      const rise = end.sub(start);
      const startDensity = exp(start.div(scale).negate());
      const endDensity = exp(end.div(scale).negate());
      // Mean density along the ray; a level ray takes the limit.
      const flat = rise.abs().lessThan(FLAT_RAY);
      const sloped = startDensity.sub(endDensity).mul(scale).div(flat.select(float(FLAT_RAY), rise));
      const integral = flat.select(startDensity, sloped).mul(reach);
      const point = cameraPosition.xz.add(direction.xz.mul(reach));
      // Drifting pockets gather the mist into banks, so it reads as ground mist
      // rather than an even sheet.
      const banks = mix(
        float(1 - settings.pocketStrength),
        float(1 + settings.pocketStrength),
        smoothstep(-0.45, 0.45, stylizedFbm2(canonicalFromRender(point).add(time.mul(drift)).mul(settings.pocketScale)).mul(2).sub(1)),
      );
      // The first metres stay clear so the player is never fogged in.
      const clear = smoothstep(settings.nearClear[0], settings.nearClear[1], reach);
      depth.assign(integral.mul(banks).mul(clear).mul(settings.density).mul(quality).mul(weight.clamp(0, 4)));
    });
    return depth;
  })();

  const amount = exp(opticalDepth.mul(-1)).oneMinus().clamp(0, settings.ceiling);

  // Green-lit ground mist: the mist colour lit by the sun, the sky's fill and a
  // little ambient, leaned toward the scene fog so it does not read as a
  // separate layer sitting in front of it.
  const lit = color(settings.color).mul((sunColor ?? vec3(0)).mul(0.6).add(fill ?? float(0)).add(0.15));
  return { opticalDepth, amount, color: (fogColor ? mix(fogColor, lit, 0.7) : lit).max(0) };
}
