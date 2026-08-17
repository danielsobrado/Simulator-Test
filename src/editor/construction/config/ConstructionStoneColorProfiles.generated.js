/* Generated from construction-stone-color.yml — do not edit. */

const DEFAULT_CATEGORIES = Object.freeze({
  field: 1,
  coping: 0.7,
  ashlar: 0.45,
  quoin: 0.45,
  voussoir: 0.5,
  merlon: 0.65,
  recess: 0,
});

export const CONSTRUCTION_STONE_COLOR_PROFILES = Object.freeze({
  default: Object.freeze({
    enabled: false,
    strength: 0,
    warmChance: 0.5,
    neutralChance: 1,
    value: Object.freeze({ min: 1, max: 1 }),
    warm: Object.freeze([1, 1, 1]),
    cool: Object.freeze([1, 1, 1]),
    outlier: Object.freeze({
      chance: 0,
      multiplier: Object.freeze([1, 1, 1]),
    }),
    categories: DEFAULT_CATEGORIES,
  }),
  "coursed-rubble": Object.freeze({
    enabled: true,
    strength: 0.72,
    warmChance: 0.54,
    neutralChance: 0.16,
    value: Object.freeze({ min: 0.965, max: 1.04 }),
    warm: Object.freeze([1.055, 1.018, 0.962]),
    cool: Object.freeze([0.972, 1.004, 1.038]),
    outlier: Object.freeze({
      chance: 0.045,
      multiplier: Object.freeze([0.91, 0.925, 0.92]),
    }),
    categories: DEFAULT_CATEGORIES,
  }),
  "soft-limestone-rubble": Object.freeze({
    enabled: true,
    strength: 0.48,
    warmChance: 0.52,
    neutralChance: 0.24,
    value: Object.freeze({ min: 0.98, max: 1.025 }),
    warm: Object.freeze([1.035, 1.014, 0.975]),
    cool: Object.freeze([0.982, 1.002, 1.025]),
    outlier: Object.freeze({
      chance: 0.03,
      multiplier: Object.freeze([0.94, 0.95, 0.945]),
    }),
    categories: DEFAULT_CATEGORIES,
  }),
});

export function constructionStoneColorProfile(styleKey) {
  return CONSTRUCTION_STONE_COLOR_PROFILES[styleKey]
    ?? CONSTRUCTION_STONE_COLOR_PROFILES.default;
}
