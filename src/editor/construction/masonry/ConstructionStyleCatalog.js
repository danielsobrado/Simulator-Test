/**
 * Masonry styles a live construction can be built in.
 *
 * `style.key` used to be free-form text that no renderer read. These entries give
 * it meaning: they are the course-solver inputs handed to `packCurvedWall`, and
 * they mirror the tuning `buildWallCourses` derives from `recipe.detail` in the
 * workshop generator so both systems produce the same kind of stonework.
 *
 * `bedAmplitude`, `jointTilt` and `splitChance` drive `CourseLattice`. Note what
 * `splitChance` does to the grid: a base cell yields `1 + c + c^2` leaves on
 * average, so `courseHeight` and `targetWidth` are deliberately *larger* than the
 * finished stone size and the recursive split brings it back down. That is the
 * order the reference builds in, and it is what widens the size distribution —
 * one big block beside two stacked small ones — without moving the stone count.
 *
 * The calibration each row holds to is
 * `courseHeight * targetWidth / (1 + c + c^2) ~= the pre-lattice cell area`, so
 * stones per square metre and therefore the triangle budget are unchanged:
 *
 * | style          | pre-lattice | 1+c+c^2 | area / leaf |
 * | coursed-rubble | 0.46 x 0.92 = 0.423 | 1.596 | 0.672 / 1.596 = 0.421 |
 * | ashlar         | 0.38 x 1.10 = 0.418 | 1.240 | 0.519 / 1.240 = 0.419 |
 * | random-rubble  | 0.34 x 0.62 = 0.211 | 1.960 | 0.414 / 1.960 = 0.211 |
 * | dry-stone      | 0.28 x 0.54 = 0.151 | 2.142 | 0.324 / 2.142 = 0.151 |
 */

export const CONSTRUCTION_STYLES = Object.freeze({
  'coursed-rubble': Object.freeze({
    key: 'coursed-rubble',
    label: 'Coursed rubble',
    courseHeight: 0.56,
    targetWidth: 1.2,
    minWidth: 0.26,
    irregularity: 0.45,
    detail: 2,
    merlonSpacing: 1.18,
    stonePalette: 'limestone',
    bedAmplitude: 0.14,
    jointTilt: 0.16,
    splitChance: 0.42,
  }),
  ashlar: Object.freeze({
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
  'random-rubble': Object.freeze({
    key: 'random-rubble',
    label: 'Random rubble',
    courseHeight: 0.46,
    targetWidth: 0.9,
    minWidth: 0.2,
    irregularity: 0.72,
    detail: 2,
    merlonSpacing: 1.05,
    stonePalette: 'granite',
    bedAmplitude: 0.18,
    jointTilt: 0.22,
    splitChance: 0.6,
  }),
  'dry-stone': Object.freeze({
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
