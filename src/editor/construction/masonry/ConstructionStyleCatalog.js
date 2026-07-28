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
 * These are tuned against measurement, not against the analytic leaf count. Two
 * things pull away from `1 + c + c^2`: rejecting a split that would fall under
 * `minWidth` or `MIN_SPLIT_HEIGHT` costs a few percent, more of it the busier the
 * style; and `courseHeight` is only a target, since the packer divides the wall
 * body into a whole number of courses. Tune `targetWidth` against the density
 * table below — over 60 m x 3.34 m, five seeds — rather than against the cell
 * arithmetic, and expect a couple of percent of drift at other wall heights.
 *
 * | style          | leaves/cell | stones/m2 | pre-lattice | delta |
 * | coursed-rubble | 1.535       | 2.298     | 2.363       | -2.7% |
 * | ashlar         | 1.194       | 2.431     | 2.392       | +1.6% |
 * | random-rubble  | 1.842       | 4.706     | 4.744       | -0.8% |
 * | dry-stone      | 1.987       | 6.604     | 6.614       | -0.2% |
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
