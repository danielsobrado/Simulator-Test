import { frameUniform } from '../../../render/FrameUniforms.js';
import {
  Fn,
  If,
  cameraPosition,
  float,
  positionWorld,
  smoothstep,
  vec2,
} from 'three/tsl';

import { stylizedFbm2 } from '../StylizedNoiseNodes.js';
import { sampleWorldWindCanonical, windWaveCoordinates } from '../../weather/wind/worldWindState.js';

/**
 * Wind-blown snow and sand streaming across the ground — after grass-test's
 * `src/weather/blownStreaks.js`.
 *
 * The donor draws it as a 0..1 surface mask: noise stretched `length` metres
 * along the wind and `width` across it, sliding downwind by `travel` metres, cut
 * into gust patches `patch` metres across so the streaming comes and goes, and
 * faded out past `reach` metres where the fine streaks would only shimmer. The
 * material then blends that mask into its own albedo.
 *
 * What is re-derived rather than copied:
 *
 * - *The wind is this project's, not the donor's.* The donor carried a wind
 *   direction uniform and a CPU gust envelope. Here the direction and the gust
 *   come from `sampleWorldWindCanonical`, the same shared field the grass, the
 *   flowers and the trees sway on, so a gust that bends the sward also steepens
 *   the streaks in the same place. No second wind field is created.
 * - *The pattern is measured in canonical world metres*, the space the terrain
 *   material already draws its own noise in (`stylizedFbm(worldXZ…)`) and where
 *   the wind field is sampled, so the streaks are stable across a floating-origin
 *   snap instead of re-rolling with the render origin. The near fade, which is a
 *   difference of two render-space points, stays exact.
 * - The ambient driver folds configured strength into the published region
 *   weight once. Loose snow lifts readily and
 *   packed sand does not, so each surface carries its own `strength` (how much of
 *   it lifts) and `hardness` (how packed it reads, 0 loose … 1 hard), and the
 *   material may add a per-pixel `packing` node (wet sand, compressed snow) on
 *   top. That is the "ground hardness" the streaks are keyed on.
 *
 * The whole thing is behind `If(amount > ACTIVE)`, and the factory returns
 * `null` when the effect is off, so a world that does not want it pays no nodes
 * at all.
 */

/** Below this the streaks are skipped; the branch is uniform, so it is free. */
const ACTIVE_AMOUNT = 0.001;
/** How strongly the field's own gust steepens a streak on top of its steady wind. */
const GUST_RESPONSE = 1.4;
/**
 * The gust envelope (wind ÷ the calm reference) over which streaks fade in. Below
 * the lower edge the air cannot lift anything, so a still day stays still.
 */
const CALM_ENVELOPE = Object.freeze([0.15, 0.7]);
/**
 * Metres each surface's pattern slides downwind per second, per unit of envelope.
 * Snow streams faster than sand, like the donor's 3.2 against 2.6, so the two do
 * not move as a single sheet where they meet.
 */
export const BLOWN_STREAK_TRAVEL_MOTION = Object.freeze({ snow: 3.4, sand: 2.6 });
/** Metres before the slide wraps, so the pattern never drifts out of float range. */
export const BLOWN_STREAK_TRAVEL_WRAP = 240;

export const DEFAULT_BLOWN_STREAKS = Object.freeze({
  enabled: true,
  snow: Object.freeze({
    // Loose snow lofts easily: near the reference give and almost no packing.
    strength: 0.45,
    hardness: 0.25,
    length: 3,
    width: 0.18,
    patch: 30,
    reach: 75,
    maxOpacity: 0.22,
    color: '#dce6ea',
  }),
  sand: Object.freeze({
    // Dry sand is harder ground and lofts less of itself for the same wind.
    strength: 0.30,
    hardness: 0.65,
    length: 1.4,
    width: 0.12,
    patch: 18,
    reach: 55,
    maxOpacity: 0.16,
    color: '#c7b18a',
  }),
});

/**
 * The ambient layer writes these once a frame; a material only reads them. Two
 * amount uniforms (the snow and sand region/preset/wind weight) and two travel
 * scalars (metres slid downwind). They are module state because the terrain
 * materials that read them are built long before the ambient system exists.
 */
export const blownStreakUniforms = Object.freeze({
  snow: frameUniform(0),
  sand: frameUniform(0),
  snowTravel: frameUniform(0),
  sandTravel: frameUniform(0),
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function positiveNumber(value, fallback, path) {
  const resolved = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(resolved) || !(resolved > 0)) {
    throw new Error(`Invalid editor configuration: ${path} must be positive.`);
  }
  return resolved;
}

function numberInRange(value, fallback, path, max) {
  const resolved = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > max) {
    throw new Error(`Invalid editor configuration: ${path} must be within [0, ${max}].`);
  }
  return resolved;
}

function resolveSurface(defaults, source, path) {
  const configured = source !== null && typeof source === 'object' ? source : {};
  const tint = configured.color ?? defaults.color;
  if (!/^#[0-9a-f]{6}$/i.test(tint)) throw new Error(`Invalid editor configuration: ${path}.color must be #rrggbb.`);
  return {
    color: tint,
    maxOpacity: numberInRange(configured.maxOpacity, defaults.maxOpacity, `${path}.maxOpacity`, 1),
    enabled: configured.enabled !== false,
    strength: numberInRange(configured.strength, defaults.strength, `${path}.strength`, 4),
    hardness: numberInRange(configured.hardness, defaults.hardness, `${path}.hardness`, 1),
    length: positiveNumber(configured.length, defaults.length, `${path}.length`),
    width: positiveNumber(configured.width, defaults.width, `${path}.width`),
    patch: positiveNumber(configured.patch, defaults.patch, `${path}.patch`),
    reach: positiveNumber(configured.reach, defaults.reach, `${path}.reach`),
  };
}

/**
 * Resolves the streak settings from the ambient layer's block. It accepts either
 * the raw `ambientEffects` YAML or the resolved `stylizedSurface.ambientEffects`
 * the config loader produces: the strength and the enabled flags come from
 * `snowStreaks`/`sandStreaks` either way, and the shape keys (`length`, `width`,
 * `patch`, `reach`, `hardness`) fall back to the defaults here, so nothing has to
 * be added to the YAML for the effect to work.
 *
 * @param {object} [ambientEffects] `ambientEffects` block, raw or resolved
 * @returns {{ enabled: boolean, snow: object|null, sand: object|null }}
 */
export function resolveBlownStreaks(ambientEffects) {
  const source = ambientEffects !== null && typeof ambientEffects === 'object' ? ambientEffects : {};
  // `ambientEffects.enabled` is the whole layer; a disabled layer builds nothing.
  if (source.enabled === false) return { enabled: false, snow: null, sand: null };
  const snow = resolveSurface(DEFAULT_BLOWN_STREAKS.snow, source.snowStreaks, 'ambientEffects.snowStreaks');
  const sand = resolveSurface(DEFAULT_BLOWN_STREAKS.sand, source.sandStreaks, 'ambientEffects.sandStreaks');
  if (!snow.enabled && !sand.enabled) return { enabled: false, snow: null, sand: null };
  return {
    enabled: true,
    snow: snow.enabled ? snow : null,
    sand: sand.enabled ? sand : null,
  };
}

/**
 * How readily the ground under a point lifts into the wind, 0..1: the surface's
 * own give (`strength` × (1 − `hardness`)) times the per-pixel packing the
 * material reports (wet sand, compressed snow). This is the CPU twin of the
 * arithmetic the node does, and it is what the strength is keyed on.
 */
export function streakLift({ weight, strength = 1, hardness = 0, packing = 0 }) {
  return clamp01(weight) * clamp01(strength) * (1 - clamp01(hardness)) * (1 - clamp01(packing));
}

/** CPU twin of shader composition; driver weight already includes strength. */
export function streakMaskReference({ fine, patch, distance, envelope, gust, region, weight, hardness, packing = 0, reach }) {
  const smooth = (a, b, value) => {
    const t = clamp01((value - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const wind = Math.max(0, Math.min(4, envelope));
  const activity = smooth(CALM_ENVELOPE[0], CALM_ENVELOPE[1], wind)
    * Math.max(wind, 0.2) * (1 + clamp01(gust) * GUST_RESPONSE);
  return clamp01(smooth(0.85, 1.15, fine) * smooth(0.3, 0.7, patch)
    * (1 - smooth(reach * 0.4, reach, distance)) * clamp01(region)
    * streakLift({ weight, strength: 1, hardness, packing }) * activity);
}

/**
 * The two unit axes a streak is measured on, from the wind direction: `along` is
 * the wind itself, `across` its left-hand perpendicular. It is the CPU twin of
 * the projection the node builds (`dot(world, dir)` and `dot(world, (-dir.y,
 * dir.x))`), and the spec a caller can reason about. A still or degenerate wind
 * falls back to +X rather than producing NaNs.
 *
 * @param {{ x: number, y: number }} direction wind (x, z), not necessarily unit
 */
export function streakBasis(direction) {
  const x = Number(direction?.x) || 0;
  const y = Number(direction?.y) || 0;
  const length = Math.hypot(x, y);
  const along = length > 1e-6 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
  // `|| 0` folds the signed zero a component can land on, so callers comparing
  // the axes do not have to know about -0.
  return { along, across: { x: -along.y || 0, y: along.x || 0 } };
}

/**
 * Advances the shared travel scalars by the wind that blew this frame. Integrated
 * on the CPU, not derived from a clock in the shader: a change of wind speed must
 * not make the streaks jump, and `v × t` would jump by the whole elapsed time.
 *
 * @param {object} state
 * @param {number} state.delta seconds
 * @param {number} [state.envelope] wind strength ÷ the calm reference
 * @param {number} [state.gust] the field's gust, 0..1
 */
export function advanceBlownStreaks({ delta, envelope = 1, gust = 1 }) {
  const seconds = Math.max(0, Number(delta) || 0);
  const drive = Math.max(Number(envelope) || 0, 0.15) * (Number(gust) || 1);
  const advance = (target, motion) => {
    const next = (target.value + drive * motion * seconds) % BLOWN_STREAK_TRAVEL_WRAP;
    target.value = next;
    return next;
  };
  return {
    snow: advance(blownStreakUniforms.snowTravel, BLOWN_STREAK_TRAVEL_MOTION.snow),
    sand: advance(blownStreakUniforms.sandTravel, BLOWN_STREAK_TRAVEL_MOTION.sand),
  };
}

/**
 * The streak mask, 0..1, for one surface, to be blended into a terrain
 * material's albedo (or emissive: airborne snow scatters its own light, so it
 * adds rather than lightens). Returns `null` when the effect or that surface is
 * off, so the material adds nothing.
 *
 * @param {object} options
 * @param {object} options.worldXZ canonical world position, vec2 node
 * @param {'snow'|'sand'} [options.kind] which surface's shape and weight to use
 * @param {object} options.weight per-pixel surface weight node (snow cover, dry sand) 0..1
 * @param {object} [options.packing] per-pixel hardness node, 0 loose … 1 packed
 * @param {object} options.settings resolved by `resolveBlownStreaks`
 * @param {object} [options.travel] metres slid downwind; the shared uniform by default
 * @returns {object|null} the mask node, or null
 */
export function blownStreaks({
  worldXZ,
  kind = 'snow',
  weight,
  packing = null,
  settings,
  travel = null,
  wind: fixedWind = null,
}) {
  const surface = settings?.enabled ? settings[kind] : null;
  if (!surface) return null;
  const region = kind === 'sand' ? blownStreakUniforms.sand : blownStreakUniforms.snow;
  const drift = travel ?? (kind === 'sand' ? blownStreakUniforms.sandTravel : blownStreakUniforms.snowTravel);

  // The shared field, sampled at the canonical point so it agrees with the gust
  // the grass and the wind particles are riding in this frame.
  const wind = fixedWind ?? sampleWorldWindCanonical(worldXZ);
  const envelope = wind.envelope.clamp(0, 4);
  // Strength is in the driver weight. Apply only substrate give and packing here.
  const soft = packing ? float(1).sub(packing.clamp(0, 1)) : float(1);
  const give = float(1 - surface.hardness)
    .mul(weight.clamp(0, 1))
    .mul(soft);
  // A still day does not lift, and a gust leans on it: the steady wind scales the
  // streaking and the field's own gust steepens it further.
  const activity = smoothstep(CALM_ENVELOPE[0], CALM_ENVELOPE[1], envelope)
    .mul(float(envelope).max(0.2))
    .mul(float(1).add(wind.gust.clamp(0, 1).mul(GUST_RESPONSE)));
  const amount = region.clamp(0, 1).mul(give).mul(activity);

  return Fn(() => {
    const value = float(0).toVar();
    If(amount.greaterThan(ACTIVE_AMOUNT), () => {
      // Built from worldXZ inside the branch: an expression first built inside an
      // If and read later leaves the reader an unassigned variable.
      // Against the prevailing wind: the local field's curl would scatter the
      // streak cells on a planet-scale map (windWaveCoordinates).
      const { along, across } = windWaveCoordinates(worldXZ);
      const cell = vec2(along.sub(drift).div(surface.length), across.div(surface.width));
      const fine = stylizedFbm2(cell)
        .add(stylizedFbm2(cell.mul(vec2(1.9, 2.3)).add(vec2(5.2, 1.3))).mul(0.5));
      const streak = smoothstep(0.85, 1.15, fine);
      // Gust patches drift more slowly than the fine streaks, so the streaming
      // comes and goes along the wind rather than as one unbroken sheet.
      const gusts = smoothstep(0.3, 0.7,
        stylizedFbm2(vec2(along.sub(drift.mul(0.6)), across).div(surface.patch)));
      const near = smoothstep(surface.reach * 0.4, surface.reach,
        cameraPosition.distance(positionWorld)).oneMinus();
      value.assign(streak.mul(gusts).mul(near).mul(amount).clamp(0, 1));
    });
    return value;
  })();
}
