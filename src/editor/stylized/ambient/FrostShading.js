import { color, float, mix } from 'three/tsl';
import { frameUniform as uniform } from '../../../render/FrameUniforms.js';

import { stylizedFbm2 } from '../StylizedNoiseNodes.js';

/**
 * Frost rime on exposed faces — the surface half of grass-test's frost.
 *
 * The donor's frost (`CinematicPipeline`) is a screen-space pass: crystalline
 * needles growing in from the frame edge in snow country. This project's terrain
 * terms live in the material, not the grade pass, and the effect that makes a
 * rock or a slab read as *cold* is the surface one — rime on the faces the sky
 * can see. So this is the donor's idea (a cold weight lighting up a crystalline
 * cover) written as a node function a material blends in, and the screen pass is
 * deliberately not ported: it would read the scene colour, which this project's
 * viewport-texture rule keeps out of materials.
 *
 * It is keyed on two things this project already tracks rather than a new input:
 *
 * - *Up-facing faces.* Rime grows on whatever points at the sky and stays bare on
 *   the walls and undersides, which is what makes it read as deposition rather
 *   than as a white wash. `SnowSurfaceShading` and `rockWeathering` key their own
 *   snow and moss the same way.
 * - *The cold weight.* The caller passes the 0..1 cold it already has — the
 *   terrain's baked snow weight, or the snow-country weight that
 *   `SnowCountryWeight`/`snowCountryLook` drive the sky with. With no node passed
 *   the shared `frostUniforms.cold` is used, so the ambient system can set it once
 *   a frame from the same snow-country weight the air is tinted by.
 */

export const DEFAULT_FROST = Object.freeze({
  enabled: true,
  strength: 0.55,
  /** Rime is matte: it raises a surface's roughness toward this. */
  roughness: 0.92,
  color: '#dfeaf5',
  /** Metres of noise for the broken, crystalline coverage. */
  scale: 0.55,
  /** How much of an up face takes rime, and how ragged its edge is. */
  coverage: 0.45,
  softness: 0.2,
  /** Above `facing[0]` rime starts, fully formed by `facing[1]`. */
  facing: Object.freeze([0.35, 0.85]),
});

/**
 * The ambient layer writes the cold weight once a frame; a material that has its
 * own (the terrain's baked snow) passes a node instead and ignores this.
 */
export const frostUniforms = Object.freeze({
  cold: uniform(0),
});

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function numberInRange(value, fallback, path, max) {
  const resolved = value === undefined || value === null ? fallback : Number(value);
  if (!Number.isFinite(resolved) || resolved < 0 || resolved > max) {
    throw new Error(`Invalid editor configuration: ${path} must be within [0, ${max}].`);
  }
  return resolved;
}

function facingRange(value, fallback, path) {
  if (value === undefined || value === null) return [...fallback];
  if (!Array.isArray(value) || value.length !== 2) throw new Error(`Invalid editor configuration: ${path} must be a [start, full] pair.`);
  const start = Number(value[0]);
  const full = Number(value[1]);
  if (!Number.isFinite(start) || !Number.isFinite(full) || start < 0 || full > 1 || full <= start) {
    throw new Error(`Invalid editor configuration: ${path} must be two numbers in [0, 1] with the second above the first.`);
  }
  return [start, full];
}

/**
 * Resolves the frost settings from the ambient layer's block (raw or resolved).
 *
 * @param {object} [ambientEffects] `ambientEffects` block
 * @returns {{ enabled: boolean, strength: number, roughness: number, color: string,
 *   scale: number, coverage: number, softness: number, facing: number[] }}
 */
export function resolveFrost(ambientEffects) {
  const source = ambientEffects !== null && typeof ambientEffects === 'object' ? ambientEffects : {};
  const configured = source.frost !== null && typeof source.frost === 'object' ? source.frost : {};
  if (source.enabled === false || configured.enabled === false) return { enabled: false };
  const strength = numberInRange(configured.strength, DEFAULT_FROST.strength, 'ambientEffects.frost.strength', 1);
  // A zero strength is the effect switched off in every sense that matters.
  if (strength === 0) return { enabled: false };
  return {
    enabled: true,
    strength,
    roughness: numberInRange(configured.roughness, DEFAULT_FROST.roughness, 'ambientEffects.frost.roughness', 1),
    color: typeof configured.color === 'string' && configured.color ? configured.color : DEFAULT_FROST.color,
    scale: numberInRange(configured.scale, DEFAULT_FROST.scale, 'ambientEffects.frost.scale', 8),
    coverage: numberInRange(configured.coverage, DEFAULT_FROST.coverage, 'ambientEffects.frost.coverage', 1),
    softness: numberInRange(configured.softness, DEFAULT_FROST.softness, 'ambientEffects.frost.softness', 1),
    facing: facingRange(configured.facing, DEFAULT_FROST.facing, 'ambientEffects.frost.facing'),
  };
}

/**
 * The frost mask, 0..1. The CPU twin of the node's arithmetic and the spec its
 * shape is asserted against: nothing where the face is not up-turned, nothing
 * where it is not cold, and a broken crystalline cover in between.
 *
 * @param {object} options
 * @param {number} options.facing the surface normal's up component, −1..1
 * @param {number} options.cold 0..1 cold weight (snow cover / snow country)
 * @param {number} [options.patch] the coverage noise at this point, 0..1
 * @param {number} [options.strength] 0..1
 * @param {number[]} [options.facingRange] [start, full] up components
 */
export function frostMask({ facing, cold, patch = 1, strength = 1, facingRange: range = DEFAULT_FROST.facing }) {
  const [start, full] = range;
  const up = clamp01((Number(facing) - start) / (full - start));
  const easedUp = up * up * (3 - 2 * up);
  return clamp01(easedUp * clamp01(cold) * clamp01(patch) * clamp01(strength));
}

/**
 * Rime on the up-facing faces, as a colour/roughness blend a material applies.
 * Returns `null` when frost is off, so the material adds nothing.
 *
 * @param {object} options
 * @param {object} options.normal world normal node (vec3)
 * @param {object} options.worldXZ canonical world position, vec2 node
 * @param {object} [options.cold] 0..1 cold weight node; `frostUniforms.cold` by default
 * @param {object} options.settings resolved by `resolveFrost`
 * @returns {{ mask: object, applyColor: (base: object) => object,
 *   applyRoughness: (base: object) => object }|null}
 */
export function createFrostShading({ normal, worldXZ, cold = null, settings }) {
  if (!settings?.enabled) return null;
  const temperature = (cold ?? frostUniforms.cold).clamp(0, 1);
  // Broken coverage rather than a clean cap: rime forms in patches on a face the
  // way it does on real stone, so the same noise the terrain uses is enough.
  const breakup = stylizedFbm2(worldXZ.mul(settings.scale))
    .smoothstep(settings.coverage - settings.softness, settings.coverage + settings.softness);
  const mask = normal.y.smoothstep(settings.facing[0], settings.facing[1])
    .mul(temperature)
    // The patches thin the cover but never clear it to a hard zero, so a fully
    // cold up face always takes some rime.
    .mul(breakup.mul(0.75).add(0.25))
    .mul(settings.strength)
    .clamp(0, 1);

  return {
    mask,
    /** Rime is pale and a touch cold, and brighter where the crystals gather. */
    applyColor(base) {
      const rime = color(settings.color).mul(float(0.9).add(breakup.mul(0.2)));
      return mix(base, rime, mask);
    },
    /** Rime is matte — it roughens whatever it settles on. */
    applyRoughness(base) {
      return mix(base, float(settings.roughness), mask);
    },
  };
}
