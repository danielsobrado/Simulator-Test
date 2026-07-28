/**
 * Tuning and appearance for recessed mortar / core backing meshes.
 *
 * Geometry builders read these constants; keep visual tuning here rather than
 * scattering magic numbers through the prism writer.
 */

export const CONSTRUCTION_MORTAR_CONFIG = Object.freeze({
  /** Metres between the visible stone face and the mortar core face. */
  faceRecess: 0.035,
  /** Minimum backing prism thickness (m). */
  minimumDepth: 0.08,
  /** UV scale for future imported mortar textures. */
  uvDensity: 0.8,
  /** Absolute face-plane expansion behind joint gaps, by stone category (m). */
  overlapByCategory: Object.freeze({
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
    color: '#77766b',
    roughness: 1,
    metalness: 0,
  }),
  'soft-limestone-rubble': Object.freeze({
    color: '#74746d',
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
  const table = config.overlapByCategory;
  return table[category] ?? table.default;
}
