import { frameUniform } from '../../../render/FrameUniforms.js';
import {
  Fn,
  If,
  float,
  normalize,
  sin,
  time as timeNode,
  vec2,
  vec3,
} from 'three/tsl';

/**
 * Heat shimmer over hot ground — after grass-test's heat shimmer
 * (`CinematicPipeline.#sceneUv`, `src/rendering/CinematicPipeline.js`).
 *
 * THE DONOR, AND WHY IT CANNOT BE PORTED AS WRITTEN
 *
 * The donor's shimmer is a screen-space post effect. Inside `#sceneUv` it reads
 * the *resolved depth buffer* (`stage.depth.r`) to turn a pixel's distance into
 * `smoothstep(SHIMMER_START, SHIMMER_FULL, distance)`, builds a fine rising
 * ripple from the pixel's `uv()` and the clock, and adds that ripple — measured
 * in screen widths, `SHIMMER_AMPLITUDE` — to the coordinate the beauty pass
 * samples the *scene colour texture* with. It needs both things this project's
 * viewport-texture rule keeps out of materials: `CLAUDE.md` treats every
 * `viewport*Texture` node as a whole-scene, per-frame copy of the colour buffer,
 * the depth buffer and a mip chain, at a cost that is binary and not avoidable
 * by visibility. So the donor's version is a read that cannot be avoided *in the
 * form it is written*.
 *
 * WHAT IS PORTED INSTEAD
 *
 * The one surface this world paints *procedurally* — the only place a distortion
 * can be applied with no framebuffer involved — is the sky dome
 * (`StylizedSkyView.createSkyMaterial`): its colour is a function of the
 * fragment's own view ray, `normalize(positionLocal)`, and no texture. So the
 * shimmer is ported as a small *angular warp of that ray*: the same fine rising
 * ripple, re-based on the dome's own coordinates, confined to the low band of
 * sky where hot ground air is seen against the horizon. Nothing is read — not
 * depth, not colour — and the warp is formally the donor's `uv + offset` with the
 * dome's ray standing in for the screen `uv`. The donor's own `#sceneUv` already
 * adds an underwater wobble to `uv()` the same way; this is that idea pointed at
 * the sky instead of the frame.
 *
 * The donor's two gates are each replaced by something a material already knows
 * without a depth comparison:
 *
 * - *"distant ground, never the sky"* becomes a *height/temperature field*. The
 *   donor needed depth to tell near from far and ground from sky. Here the
 *   shimmer rides the low sky band — a band on the ray's own height — and is
 *   scaled by the region's heat: the ambient layer's `sand`/`desert` weight
 *   (`ambientRegions.js`) times a temperature. Hot air pools low, so the band
 *   *is* the height/temperature field, and the dome above it stays still.
 * - *strength* is still the ambient weight (region × preset × strength), driven
 *   into `heatShimmerUniforms.hot` once a frame exactly as
 *   `blownStreakUniforms` is, so a cold or wooded focus costs one branch.
 *
 * The factory returns `null` when the effect is off, so the dome material adds
 * no nodes at all, and the whole ripple sits behind `If(amount > ACTIVE_AMOUNT)`
 * so a world with no hot ground pays a single comparison per sky pixel.
 *
 * `offset` is returned as well as the warped `direction`, so a ground material
 * that wants the donor's other half — hot sand's own detail wavering toward the
 * horizon — can add the same offset to its own procedural lookup (`worldXZ`),
 * with `cameraPosition.distance(positionWorld)` standing in for the donor's
 * depth gate. That path is left to the material; nothing here reads anything.
 */

/** Below this the ripple is skipped; the branch is uniform, so it is nearly free. */
const ACTIVE_AMOUNT = 0.0005;

export const DEFAULT_HEAT_SHIMMER = Object.freeze({
  enabled: true,
  strength: 1,
  // The donor ships presets { sunny: 1, calm: 1, windy: 0.4, bowed: 0.6,
  // goldenHour: 0.3 } with a default of 0 (public/ambient-effects.yaml).
  presetDefault: 0,
  // Peak angular displacement of the dome's ray, in the ray's own units. The
  // donor's peak is SHIMMER_AMPLITUDE = 0.0011 screen widths; a 60° fov spans
  // ~1 rad over one screen width, so 0.006 here is a few pixels at 1440p and
  // stays below the ripple's own wavelength so it does not alias.
  amplitude: 0.006,
  // The low sky band the hot air sits in: full shimmer at and below the floor,
  // gone by the ceiling. Measured on the ray's height (`direction.y`), where 0
  // is the horizon.
  band: Object.freeze([0.02, 0.22]),
  // Ripple frequencies, cycles per unit of the dome's ray coordinates, and the
  // rise speed in cycles per second. Retuned from the donor's *screen* constants
  // (290/410/47/37 and 6.5/8.5 per uv unit): those are per screen pixel and
  // would alias on the dome, whose coordinates span the full hemisphere.
  ripple: Object.freeze({ across: 23, along: 9, cross: 3 }),
  rise: 1,
});

/**
 * The ambient layer writes these once a frame; the dome material only reads
 * them. `hot` is the region weight (the ambient layer's `sand` weight × preset ×
 * strength), `temperature` the heat of the air, 0 cold … 1 full sun.
 */
export const heatShimmerUniforms = Object.freeze({
  hot: frameUniform(0),
  temperature: frameUniform(1),
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

function numberInRange(value, fallback, path, max) {
  const resolved = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > max) {
    throw new Error(`Invalid editor configuration: ${path} must be within [0, ${max}].`);
  }
  return resolved;
}

function positiveNumber(value, fallback, path) {
  const resolved = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(resolved) || !(resolved > 0)) {
    throw new Error(`Invalid editor configuration: ${path} must be positive.`);
  }
  return resolved;
}

function bandRange(value, path) {
  if (value === undefined || value === null) return [...DEFAULT_HEAT_SHIMMER.band];
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`Invalid editor configuration: ${path} must be a [floor, ceiling] pair.`);
  }
  const floor = Number(value[0]);
  const ceiling = Number(value[1]);
  if (!Number.isFinite(floor) || !Number.isFinite(ceiling) || floor < 0 || ceiling > 1 || ceiling <= floor) {
    throw new Error(`Invalid editor configuration: ${path} must be two numbers in [0, 1] with the second above the first.`);
  }
  return [floor, ceiling];
}

function presetWeights(value, path) {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) throw new Error(`Invalid editor configuration: ${path} must map preset names to weights.`);
  return Object.fromEntries(Object.entries(value)
    .map(([preset, weight]) => [preset, numberInRange(weight, 0, `${path}.${preset}`, 4)]));
}

/**
 * Resolves the shimmer settings from the ambient layer's block (raw
 * `ambientEffects` or the resolved `stylizedSurface.ambientEffects`).
 *
 * @param {object} [ambientEffects] `ambientEffects` block
 * @returns {{ enabled: boolean, strength: number, presets: object, presetDefault: number,
 *   amplitude: number, band: number[], ripple: object, rise: number }}
 */
export function resolveHeatShimmerConfig(ambientEffects) {
  const source = isRecord(ambientEffects) ? ambientEffects : {};
  const path = 'ambientEffects.heatShimmer';
  // `ambientEffects.enabled` is the whole layer; a disabled layer builds nothing.
  if (source.enabled === false) return { enabled: false };
  const configured = isRecord(source.heatShimmer) ? source.heatShimmer : {};
  if (configured.enabled === false) return { enabled: false };
  const strength = numberInRange(configured.strength, DEFAULT_HEAT_SHIMMER.strength, `${path}.strength`, 4);
  // A zero strength is the effect switched off in every sense that matters.
  if (strength === 0) return { enabled: false };
  if (configured.ripple !== undefined && !isRecord(configured.ripple)) {
    throw new Error(`Invalid editor configuration: ${path}.ripple must be an object.`);
  }
  const ripple = configured.ripple ?? {};
  return {
    enabled: true,
    strength,
    presets: presetWeights(configured.presets, `${path}.presets`),
    presetDefault: numberInRange(configured.presetDefault, DEFAULT_HEAT_SHIMMER.presetDefault, `${path}.presetDefault`, 4),
    amplitude: numberInRange(configured.amplitude, DEFAULT_HEAT_SHIMMER.amplitude, `${path}.amplitude`, 0.2),
    band: bandRange(configured.band, `${path}.band`),
    ripple: {
      across: positiveNumber(ripple.across, DEFAULT_HEAT_SHIMMER.ripple.across, `${path}.ripple.across`),
      along: positiveNumber(ripple.along, DEFAULT_HEAT_SHIMMER.ripple.along, `${path}.ripple.along`),
      cross: positiveNumber(ripple.cross, DEFAULT_HEAT_SHIMMER.ripple.cross, `${path}.ripple.cross`),
    },
    rise: numberInRange(configured.rise, DEFAULT_HEAT_SHIMMER.rise, `${path}.rise`, 20),
  };
}

/**
 * The donor's two-component rising ripple (`CinematicPipeline.#sceneUv`),
 * re-based on the dome's own coordinates: `across` is the ray's horizontal
 * component and `along` its height. Unitless and bounded — the amplitude is the
 * node's, so this is the shape alone and is assertable on its own.
 *
 * @param {object} options
 * @param {number} options.across the ray's horizontal component
 * @param {number} options.along the ray's height
 * @param {number} options.time seconds
 * @param {object} [options.settings] resolved by `resolveHeatShimmerConfig`
 */
export function heatShimmerRipple({ across, along, time, settings = DEFAULT_HEAT_SHIMMER }) {
  const { ripple, rise } = settings;
  return {
    x: Math.sin(along * ripple.along + time * rise + Math.sin(across * ripple.across + time * rise * 0.2) * 2) * 0.35,
    y: Math.sin(along * ripple.along * 1.4 - time * rise * 1.3 + across * ripple.cross),
  };
}

/**
 * The hot-air gate, 0..1: how much the air a ray of this height passes through
 * can waver. Full at and below the band's floor, gone by its ceiling — hot air
 * pools low — times the air's temperature and the region's heat. This is the
 * CPU twin of the node's arithmetic, and it is what the shimmer's presence is
 * keyed on.
 *
 * @param {object} options
 * @param {number} options.elevation the ray's height (direction.y)
 * @param {number[]} [options.band] [floor, ceiling]
 * @param {number} [options.temperature] 0..1
 * @param {number} [options.weight] 0..1 region heat
 */
export function heatShimmerHot({ elevation, band = DEFAULT_HEAT_SHIMMER.band, temperature = 1, weight = 1 }) {
  const low = 1 - smoothstepNumber(band[0], band[1], Number(elevation));
  return clamp01(low) * clamp01(temperature) * clamp01(weight);
}

/**
 * The shimmer applied to a view ray, and the blend gates the caller reads.
 * Returns `null` when the effect is off, so the dome material keeps the
 * direction it already had, byte for byte.
 *
 * @param {object} options
 * @param {object} options.direction the dome's unit view ray (vec3 node), e.g. `normalize(positionLocal)`
 * @param {object} [options.weight] 0..1 region heat node; `heatShimmerUniforms.hot` by default
 * @param {object} [options.temperature] 0..1 air temperature node; the shared uniform by default
 * @param {object} [options.time] seconds, for the rising ripple
 * @param {number} [options.quality] quality share 0..1; `<= 0` builds nothing
 * @param {object} options.settings resolved by `resolveHeatShimmerConfig`
 * @returns {{ direction: object, offset: object, amount: object } | null}
 *   `direction` is the warped ray; `offset` the raw displacement (ray units) for
 *   a material that wants to warp its own lookup instead; `amount` how strong the
 *   shimmer is at this ray, 0..1.
 */
export function createHeatShimmerNodes({
  direction,
  weight = heatShimmerUniforms.hot,
  temperature = heatShimmerUniforms.temperature,
  time = timeNode,
  quality = 1,
  settings,
}) {
  if (!settings?.enabled || !(Number(quality) > 0)) return null;

  const { band, ripple, rise } = settings;
  // Hot air pools low, so only the low band of the dome moves.
  const hot = direction.y.smoothstep(band[0], band[1]).oneMinus();
  const amount = hot.mul(temperature.clamp(0, 1)).mul(weight.clamp(0, 1)).mul(quality);

  const displacement = Fn(() => {
    const offset = vec2(0).toVar();
    If(amount.greaterThan(ACTIVE_AMOUNT), () => {
      // Built inside the branch: an expression first built inside an If and read
      // later would leave its reader an unassigned variable.
      const across = direction.x;
      const along = direction.y;
      const rippleShape = vec2(
        sin(along.mul(ripple.along).add(time.mul(rise))
          .add(sin(across.mul(ripple.across).add(time.mul(rise * 0.2))).mul(2))).mul(0.35),
        sin(along.mul(ripple.along * 1.4).sub(time.mul(rise * 1.3)).add(across.mul(ripple.cross))),
      );
      offset.assign(rippleShape.mul(float(settings.amplitude)).mul(amount));
    });
    return offset;
  })();

  return {
    amount,
    offset: displacement,
    // The donor's `uv + offset`, with the dome's ray in place of the screen uv.
    direction: normalize(direction.add(vec3(displacement.x, displacement.y, 0))),
  };
}
