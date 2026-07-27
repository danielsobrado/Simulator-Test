/**
 * Masonry styles a live construction can be built in.
 *
 * `style.key` used to be free-form text that no renderer read. These entries give
 * it meaning: they are the course-solver inputs handed to `packCurvedWall`, and
 * they mirror the tuning `buildWallCourses` derives from `recipe.detail` in the
 * workshop generator so both systems produce the same kind of stonework.
 */

export const CONSTRUCTION_STYLES = Object.freeze({
  'coursed-rubble': Object.freeze({
    key: 'coursed-rubble',
    label: 'Coursed rubble',
    courseHeight: 0.46,
    targetWidth: 0.92,
    minWidth: 0.26,
    irregularity: 0.45,
    detail: 2,
    merlonSpacing: 1.18,
    stonePalette: 'limestone',
  }),
  ashlar: Object.freeze({
    key: 'ashlar',
    label: 'Ashlar',
    courseHeight: 0.38,
    targetWidth: 1.1,
    minWidth: 0.34,
    irregularity: 0.18,
    detail: 3,
    merlonSpacing: 1.3,
    stonePalette: 'sandstone',
  }),
  'random-rubble': Object.freeze({
    key: 'random-rubble',
    label: 'Random rubble',
    courseHeight: 0.34,
    targetWidth: 0.62,
    minWidth: 0.2,
    irregularity: 0.72,
    detail: 2,
    merlonSpacing: 1.05,
    stonePalette: 'granite',
  }),
  'dry-stone': Object.freeze({
    key: 'dry-stone',
    label: 'Dry stone',
    courseHeight: 0.28,
    targetWidth: 0.54,
    minWidth: 0.18,
    irregularity: 0.85,
    detail: 2,
    merlonSpacing: 0.9,
    stonePalette: 'granite',
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
