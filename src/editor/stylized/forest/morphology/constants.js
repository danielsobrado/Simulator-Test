/** Morphology channel salts — keep in sync with clod-poc `trees/morphology/constants`. */
export const MORPH_CHANNEL = Object.freeze({
  AGE: 0x1101,
  LEAN: 0x1102,
  CROWN_BIAS: 0x1103,
  WIDTH: 0x1104,
  FLAT: 0x1105,
  DROOP: 0x1106,
  HEALTH: 0x1107,
  FLARE: 0x1108,
  FOLIAGE_CARD: 0x1109,
});

export const MORPHOLOGY_RANGES = Object.freeze({
  age01: Object.freeze([0, 1]),
  leanX: Object.freeze([-0.22, 0.22]),
  leanZ: Object.freeze([-0.22, 0.22]),
  crownBiasX: Object.freeze([-0.35, 0.35]),
  crownBiasZ: Object.freeze([-0.35, 0.35]),
  crownWidth: Object.freeze([0.82, 1.18]),
  crownFlattening: Object.freeze([0.82, 1.2]),
  branchDroop: Object.freeze([-0.18, 0.32]),
  foliageDensity: Object.freeze([0.55, 1.15]),
  health01: Object.freeze([0, 1]),
  rootFlare: Object.freeze([0.75, 1.35]),
  stiffness: Object.freeze([0.65, 1.35]),
});

/** Runtime knobs keyed by SimCity forest species ids (mapped from clod oak/pine/…). */
export const TREE_MORPHOLOGY_RUNTIME_DEFAULTS = Object.freeze({
  broadleaf_round: Object.freeze({
    slopeLean: 0.08, windLean: 0.04, randomLean: 0.05,
    exposureFlattening: 0.05, ageFlattening: 0.08,
    baseDroop: 0.03, ageDroop: 0.12, moistureDroop: 0.05, baseStiffness: 0.90,
  }),
  broadleaf_tall: Object.freeze({
    slopeLean: 0.10, windLean: 0.07, randomLean: 0.05,
    exposureFlattening: 0.07, ageFlattening: 0.04,
    baseDroop: 0.04, ageDroop: 0.10, moistureDroop: 0.06, baseStiffness: 0.82,
  }),
  conifer_narrow: Object.freeze({
    slopeLean: 0.06, windLean: 0.05, randomLean: 0.03,
    exposureFlattening: 0.10, ageFlattening: 0.02,
    baseDroop: -0.02, ageDroop: 0.06, moistureDroop: 0.02, baseStiffness: 1.15,
  }),
  conifer_wide: Object.freeze({
    slopeLean: 0.05, windLean: 0.04, randomLean: 0.025,
    exposureFlattening: 0.09, ageFlattening: 0.02,
    baseDroop: 0.00, ageDroop: 0.05, moistureDroop: 0.02, baseStiffness: 1.22,
  }),
  tropical_tall: Object.freeze({
    slopeLean: 0.08, windLean: 0.04, randomLean: 0.04,
    exposureFlattening: 0.04, ageFlattening: 0.10,
    baseDroop: 0.06, ageDroop: 0.12, moistureDroop: 0.08, baseStiffness: 0.78,
  }),
  wetland_sparse: Object.freeze({
    slopeLean: 0.08, windLean: 0.04, randomLean: 0.04,
    exposureFlattening: 0.04, ageFlattening: 0.10,
    baseDroop: 0.12, ageDroop: 0.16, moistureDroop: 0.10, baseStiffness: 0.72,
  }),
});

export const TREE_IMPOSTOR_AGE_BUCKETS = Object.freeze([0.20, 0.60, 0.92]);
export const TREE_IMPOSTOR_STRUCTURAL_VARIANTS = 4;
export const TREE_IMPOSTOR_LAYERS_PER_SPECIES = 12;
