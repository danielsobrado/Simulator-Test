/**
 * Masonry styles a live construction can be built in.
 *
 * `style.key` used to be free-form text that no renderer read. These entries give
 * it meaning: they are the course-solver inputs handed to `packCurvedWall`, and
 * they mirror the tuning `buildWallCourses` derives from `recipe.detail` in the
 * workshop generator so both systems produce the same kind of stonework.
 *
 * `bedAmplitude`, `jointTilt` and `splitChance` drive `CourseLattice`. Note what
 * `splitChance` does to the grid: with `splitMaxDepth` 2 a base cell yields
 * `1 + c + c²` leaves on average; with depth 1 it yields `1 + c`. So
 * `courseHeight` and `targetWidth` are deliberately *larger* than the finished
 * stone size and the recursive split brings it back down. That is the order the
 * reference builds in, and it is what widens the size distribution — one big
 * block beside two stacked small ones — without moving the stone count.
 *
 * These are tuned against measurement, not against the analytic leaf count. Two
 * things pull away from the leaf formula: rejecting a split that would fall under
 * `minWidth` or `MIN_SPLIT_HEIGHT` costs a few percent, more of it the busier the
 * style; and `courseHeight` is only a target, since the packer divides the wall
 * body into a whole number of courses. Tune `targetWidth` against the density
 * table below — over 60 m x 3.34 m, five seeds — rather than against the cell
 * arithmetic, and expect a couple of percent of drift at other wall heights.
 *
 * | style                 | leaves/cell | stones/m2 | pre-lattice | delta |
 * | coursed-rubble        | 1.535       | 2.298     | 2.363       | -2.7% |
 * | soft-limestone-rubble | ~1.34†      | (opt-in)  |             |       |
 * | ashlar                | 1.194       | 2.431     | 2.392       | +1.6% |
 * | random-rubble         | 1.842       | 4.706     | 4.744       | -0.8% |
 * | dry-stone             | 1.987       | 6.604     | 6.614       | -0.2% |
 *
 * † `splitMaxDepth` 1: expected leaves ≈ 1 + c. Depth 2: ≈ 1 + c + c².
 * soft-limestone-rubble base cell 0.52 × 1.09 = 0.567 m² → ≈ 0.423 m² / leaf,
 * matching coursed-rubble's finished density budget.
 */

/** Shared defaults that reproduce the former hard-coded packer behaviour. */
const DEFAULT_STYLE_TUNING = Object.freeze({
  splitMaxDepth: 2,

  jointInsetMin: 0.012,
  jointInsetMax: 0.03,
  jointInsetVerticalRatio: 0.7,

  depthScaleMin: 0.95,
  depthScaleMax: 0.985,
  faceOffsetAmplitude: 0.009,
});

/**
 * Local whitelist so the catalogue can validate palette keys without importing
 * workshop materials (and creating a circular dependency).
 */
const STONE_PALETTE_KEYS = new Set([
  'granite',
  'limestone',
  'sandstone',
  'soft-limestone',
]);

function finiteInRange(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function positive(value, label) {
  return finiteInRange(value, label, Number.EPSILON, Infinity);
}

/**
 * Freeze a complete masonry style descriptor after filling defaults and
 * validating every tuning field.
 *
 * Exported for unit tests that assert invalid input fails immediately.
 */
export function defineConstructionStyle(input) {
  const style = {
    ...DEFAULT_STYLE_TUNING,
    ...input,
  };

  if (!style.key || typeof style.key !== 'string') {
    throw new Error('Construction style key is required.');
  }

  if (!style.label || typeof style.label !== 'string') {
    throw new Error(`Construction style ${style.key} needs a label.`);
  }

  positive(style.courseHeight, `${style.key} courseHeight`);
  positive(style.targetWidth, `${style.key} targetWidth`);
  positive(style.minWidth, `${style.key} minWidth`);
  positive(style.merlonSpacing, `${style.key} merlonSpacing`);

  finiteInRange(style.irregularity, `${style.key} irregularity`, 0, 1);
  finiteInRange(style.detail, `${style.key} detail`, 1, 3);
  finiteInRange(style.bedAmplitude, `${style.key} bedAmplitude`, 0, 0.2);
  finiteInRange(style.jointTilt, `${style.key} jointTilt`, 0, 0.5);
  finiteInRange(style.splitChance, `${style.key} splitChance`, 0, 1);
  finiteInRange(style.splitMaxDepth, `${style.key} splitMaxDepth`, 0, 2);

  finiteInRange(style.jointInsetMin, `${style.key} jointInsetMin`, 0, 0.1);
  finiteInRange(style.jointInsetMax, `${style.key} jointInsetMax`, 0, 0.1);
  finiteInRange(
    style.jointInsetVerticalRatio,
    `${style.key} jointInsetVerticalRatio`,
    0.1,
    1,
  );

  finiteInRange(style.depthScaleMin, `${style.key} depthScaleMin`, 0.5, 1.2);
  finiteInRange(style.depthScaleMax, `${style.key} depthScaleMax`, 0.5, 1.2);
  finiteInRange(
    style.faceOffsetAmplitude,
    `${style.key} faceOffsetAmplitude`,
    0,
    0.1,
  );

  if (!Number.isInteger(style.detail)) {
    throw new Error(`${style.key} detail must be an integer.`);
  }

  if (!Number.isInteger(style.splitMaxDepth)) {
    throw new Error(`${style.key} splitMaxDepth must be an integer.`);
  }

  if (style.minWidth >= style.targetWidth) {
    throw new Error(`${style.key} minWidth must be below targetWidth.`);
  }

  if (style.jointInsetMin > style.jointInsetMax) {
    throw new Error(`${style.key} joint inset range is reversed.`);
  }

  if (style.depthScaleMin > style.depthScaleMax) {
    throw new Error(`${style.key} depth scale range is reversed.`);
  }

  if (!STONE_PALETTE_KEYS.has(style.stonePalette)) {
    throw new Error(
      `${style.key} references unknown stone palette ${style.stonePalette}.`,
    );
  }

  return Object.freeze(style);
}

export const CONSTRUCTION_STYLES = Object.freeze({
  'coursed-rubble': defineConstructionStyle({
    key: 'coursed-rubble',
    label: 'Coursed rubble',
    courseHeight: 0.56,
    targetWidth: 1.2,
    minWidth: 0.26,
    irregularity: 0.56,
    detail: 2,
    merlonSpacing: 1.18,
    stonePalette: 'soft-limestone',
    bedAmplitude: 0.16,
    jointTilt: 0.18,
    splitChance: 0.42,
    depthScaleMin: 0.92,
    depthScaleMax: 1.025,
    faceOffsetAmplitude: 0.018,
  }),
  'soft-limestone-rubble': defineConstructionStyle({
    key: 'soft-limestone-rubble',
    label: 'Soft limestone rubble',
    courseHeight: 0.52,
    targetWidth: 1.09,
    minWidth: 0.28,
    irregularity: 0.36,
    detail: 2,
    merlonSpacing: 1.22,
    stonePalette: 'soft-limestone',
    bedAmplitude: 0.08,
    jointTilt: 0.10,
    splitChance: 0.34,
    splitMaxDepth: 1,
    // Field head/bed joints are authored in masonry-joints.yml (soft limestone
    // uses wider separate ranges). These inset fields remain for catalogue
    // compatibility; CurvedCoursePacker no longer reads them for field stones.
    jointInsetMin: 0.018,
    jointInsetMax: 0.032,
    jointInsetVerticalRatio: 0.72,
    depthScaleMin: 0.965,
    depthScaleMax: 0.995,
    faceOffsetAmplitude: 0.012,
  }),
  ashlar: defineConstructionStyle({
    key: 'ashlar',
    label: 'Ashlar',
    courseHeight: 0.44,
    targetWidth: 1.18,
    minWidth: 0.34,
    irregularity: 0.18,
    detail: 3,
    merlonSpacing: 1.3,
    stonePalette: 'sandstone',
    // Dressed stone is cut to level and plumb; the lattice barely moves it.
    bedAmplitude: 0.05,
    jointTilt: 0.05,
    splitChance: 0.2,
  }),
  'random-rubble': defineConstructionStyle({
    key: 'random-rubble',
    label: 'Random rubble',
    courseHeight: 0.46,
    targetWidth: 0.94,
    minWidth: 0.2,
    irregularity: 0.72,
    detail: 2,
    merlonSpacing: 1.05,
    stonePalette: 'granite',
    bedAmplitude: 0.18,
    jointTilt: 0.22,
    splitChance: 0.6,
  }),
  'dry-stone': defineConstructionStyle({
    key: 'dry-stone',
    label: 'Dry stone',
    courseHeight: 0.4,
    targetWidth: 0.81,
    minWidth: 0.18,
    irregularity: 0.85,
    detail: 2,
    merlonSpacing: 0.9,
    stonePalette: 'granite',
    bedAmplitude: 0.2,
    jointTilt: 0.24,
    splitChance: 0.68,
  }),
});

export const DEFAULT_CONSTRUCTION_STYLE_KEY = 'coursed-rubble';

export const CONSTRUCTION_STYLE_KEYS = Object.freeze(Object.keys(CONSTRUCTION_STYLES));

export function isConstructionStyleKey(key) {
  return typeof key === 'string' && Object.hasOwn(CONSTRUCTION_STYLES, key);
}

export function constructionStyle(key) {
  const style = CONSTRUCTION_STYLES[key];
  if (!style) throw new Error(`Unknown construction style ${key}.`);
  return style;
}
