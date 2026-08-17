import { constructionJointProfile } from '../config/ConstructionJointProfiles.generated.js';

/**
 * Tuning and appearance for recessed mortar / core backing meshes.
 *
 * Geometry builders read these constants; keep visual tuning here rather than
 * scattering magic numbers through the prism writer.
 *
 * Field placements from the course packer carry authoritative `mortarCorners`
 * (the solved cell footprint). Those use `safetyOverlap` only — a few
 * millimetres to hide floating-point cracks. `legacyOverlapByCategory` remains
 * the fallback for dressings and older placement producers without footprints.
 *
 * `safetyOverlap` is taken from the joint-profile defaults so YAML remains the
 * editable source for the millimetre crack fill.
 */

const DEFAULT_JOINT_PROFILE = constructionJointProfile('default');

export const CONSTRUCTION_MORTAR_CONFIG = Object.freeze({
  /** Metres between the visible stone face and the mortar core face. */
  faceRecess: 0.055,
  /** Minimum backing prism thickness (m). */
  minimumDepth: 0.08,
  /** UV scale for future imported mortar textures. */
  uvDensity: 0.8,
  /**
   * Tiny absolute expansion when backing from authoritative `mortarCorners`.
   * Hides FP cracks between adjacent cell footprints — not a visual joint.
   */
  safetyOverlap: DEFAULT_JOINT_PROFILE.mortarSafetyOverlap,
  /** Fallback face-plane expansion for placements without mortarCorners (m). */
  legacyOverlapByCategory: Object.freeze({
    field: 0.024,
    ashlar: 0.014,
    quoin: 0.012,
    voussoir: 0.012,
    coping: 0.01,
    merlon: 0.01,
    default: 0.018,
  }),
  /** Cap on face expansion so tiny dressings cannot balloon. */
  maxCornerScale: 1.25,
});

/**
 * Style-keyed mortar appearance. Dry-stone reads as packed interior stone /
 * deep shadow, not pale cement.
 */
export const CONSTRUCTION_MORTAR_PROFILES = Object.freeze({
  'coursed-rubble': Object.freeze({
    color: '#5d5a53',
    roughness: 1,
    metalness: 0,
  }),
  'soft-limestone-rubble': Object.freeze({
    color: '#68675f',
    roughness: 1,
    metalness: 0,
  }),
  ashlar: Object.freeze({
    color: '#868174',
    roughness: 0.98,
    metalness: 0,
  }),
  'random-rubble': Object.freeze({
    color: '#666861',
    roughness: 1,
    metalness: 0,
  }),
  'dry-stone': Object.freeze({
    color: '#4f514c',
    roughness: 1,
    metalness: 0,
  }),
});

const DEFAULT_MORTAR_PROFILE = CONSTRUCTION_MORTAR_PROFILES['coursed-rubble'];

export function mortarProfile(styleKey) {
  return CONSTRUCTION_MORTAR_PROFILES[styleKey] ?? DEFAULT_MORTAR_PROFILE;
}

export function overlapForCategory(category, config = CONSTRUCTION_MORTAR_CONFIG) {
  const table = config.legacyOverlapByCategory;
  return table[category] ?? table.default;
}
