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
 * rounded-fieldstone base cell 0.5 × 0.95 = 0.475 m²; its 0.24 m split floor
 * rejects most horizontal splits, so ≈ 1.25 leaves → ≈ 0.38 m² / leaf above
 * its footing course, whose cells are 1.5× taller and 1.35× wider and rarely
 * split.
 */

/**
 * The coping course every flat-topped wall used before styles could size it.
 * `CurvedCoursePacker` falls back to these for style objects built outside the
 * catalogue.
 */
export const DEFAULT_COPING = Object.freeze({
  height: 0.16,
  oversail: 1.14,
  widthRatio: 1.15,
  // Downward wear as a fraction of cap height; its bed stays seated.
  crownVariation: 0,
});

/** Shared defaults that reproduce the former hard-coded packer behaviour. */
const DEFAULT_STYLE_TUNING = Object.freeze({
  coursesPerBand: 1,
  splitMaxDepth: 2,
  // Null prefers the longer axis. A style can favour stacked thin inserts.
  splitHorizontalChance: null,
  // Narrowest width:height a vertical split may leave; null allows uprights.
  splitMinAspect: null,

  jointInsetMin: 0.012,
  jointInsetMax: 0.03,
  jointInsetVerticalRatio: 0.7,

  depthScaleMin: 0.95,
  depthScaleMax: 0.985,
  faceOffsetAmplitude: 0.009,
  faceOffsetCoherence: 0,
  merlonHeight: null,
  merlonCourseHeight: null,
  // 0 keeps a regular crown; up to 1 varies each tooth's width, spacing and
  // height (a stacked second stone) from its own hashed cell.
  merlonVariation: 0,
  merlonMaxColumns: 3,
  // Lengthens jamb rows and voussoirs so an opening surround matches the
  // style's block size.
  openingBlockScale: 1,
  // Chord sagitta a stone may span on a curve, in metres; null keeps the
  // packer's joint tolerance. Only styles whose mesher bends stones to the
  // arc can afford more.
  curveWidthTolerance: null,

  // Shortest leaf a horizontal split may leave, in metres. Matches
  // `CourseLattice`'s MIN_SPLIT_HEIGHT, which every style used before.
  splitMinHeight: 0.14,

  // How the stones are meshed. `soft` is the bevelled-prism path with optional
  // relief and edge wear; `rounded` is the pillow-stone mesher.
  geometry: 'soft',
  // Top style a newly drawn wall starts with; null keeps the schema default.
  defaultTop: null,
  // Preserve the solved cells at distance, or merge cells/courses for styles
  // whose larger masonry tolerates that change in pattern.
  coarseLayout: 'merge',
  // Optional taller, wider, buried first course. Null means course 0 is an
  // ordinary course sitting on grade, as it always was.
  footing: null,
  coping: DEFAULT_COPING,
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
  'warm-fieldstone',
  'glade-sandstone',
]);

const GEOMETRY_KINDS = new Set(['soft', 'rounded']);

/** Mirrors `ConstructionSchema`'s top styles; the schema imports this module. */
const TOP_STYLE_KEYS = new Set(['flat', 'irregular', 'crenellated', 'ruined']);

function finiteInRange(value, label, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function positive(value, label) {
  return finiteInRange(value, label, Number.EPSILON, Infinity);
}

function freezeFooting(footing, key) {
  if (footing == null) return null;
  if (typeof footing !== 'object') throw new Error(`${key} footing must be an object.`);
  const resolved = {
    heightRatio: footing.heightRatio,
    widthRatio: footing.widthRatio,
    splitChance: footing.splitChance ?? 0,
    plinth: footing.plinth ?? 0,
    burialMargin: footing.burialMargin ?? 0,
    burialMax: footing.burialMax ?? 0,
  };
  finiteInRange(resolved.heightRatio, `${key} footing heightRatio`, 1, 3);
  finiteInRange(resolved.widthRatio, `${key} footing widthRatio`, 0.5, 2.5);
  finiteInRange(resolved.splitChance, `${key} footing splitChance`, 0, 1);
  finiteInRange(resolved.plinth, `${key} footing plinth`, 0, 0.3);
  finiteInRange(resolved.burialMargin, `${key} footing burialMargin`, 0, 1);
  finiteInRange(resolved.burialMax, `${key} footing burialMax`, 0, 2);
  if (resolved.burialMax < resolved.burialMargin) {
    throw new Error(`${key} footing burialMax must be at least burialMargin.`);
  }
  return Object.freeze(resolved);
}

function freezeCoping(coping, key) {
  if (coping === DEFAULT_COPING) return DEFAULT_COPING;
  if (!coping || typeof coping !== 'object') throw new Error(`${key} coping must be an object.`);
  const resolved = { ...DEFAULT_COPING, ...coping };
  finiteInRange(resolved.height, `${key} coping height`, 0.05, 0.6);
  finiteInRange(resolved.oversail, `${key} coping oversail`, 1, 1.6);
  finiteInRange(resolved.widthRatio, `${key} coping widthRatio`, 0.8, 2);
  finiteInRange(resolved.crownVariation, `${key} coping crownVariation`, 0, 0.25);
  return Object.freeze(resolved);
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
  if (style.splitHorizontalChance != null) {
    finiteInRange(style.splitHorizontalChance, `${style.key} splitHorizontalChance`, 0, 1);
  }
  finiteInRange(style.splitMaxDepth, `${style.key} splitMaxDepth`, 0, 2);
  if (style.splitMinAspect != null) {
    finiteInRange(style.splitMinAspect, `${style.key} splitMinAspect`, 0.2, 3);
  }
  finiteInRange(style.faceOffsetCoherence, `${style.key} faceOffsetCoherence`, 0, 1);
  if (style.merlonHeight != null) finiteInRange(style.merlonHeight, `${style.key} merlonHeight`, 0.2, 2);
  if (style.curveWidthTolerance != null) {
    finiteInRange(style.curveWidthTolerance, `${style.key} curveWidthTolerance`, 0.005, 0.2);
    if (style.geometry !== 'rounded') {
      throw new Error(`${style.key} curveWidthTolerance needs arc-bent (rounded) geometry.`);
    }
  }
  finiteInRange(style.openingBlockScale, `${style.key} openingBlockScale`, 0.5, 3);
  finiteInRange(style.merlonVariation, `${style.key} merlonVariation`, 0, 1);
  if (!Number.isInteger(style.merlonMaxColumns) || style.merlonMaxColumns < 1 || style.merlonMaxColumns > 3) {
    throw new Error(`${style.key} merlonMaxColumns must be 1, 2 or 3.`);
  }
  if (style.merlonCourseHeight != null) finiteInRange(style.merlonCourseHeight, `${style.key} merlonCourseHeight`, 0.1, 1);
  if (!Number.isInteger(style.coursesPerBand) || style.coursesPerBand < 1 || style.coursesPerBand > 2) {
    throw new Error(`${style.key} coursesPerBand must be 1 or 2.`);
  }
  finiteInRange(style.splitMinHeight, `${style.key} splitMinHeight`, 0.05, 1);

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

  if (!GEOMETRY_KINDS.has(style.geometry)) {
    throw new Error(`${style.key} geometry must be one of ${[...GEOMETRY_KINDS].join(', ')}.`);
  }

  if (style.defaultTop != null && !TOP_STYLE_KEYS.has(style.defaultTop)) {
    throw new Error(`${style.key} defaultTop ${style.defaultTop} is not a top style.`);
  }
  if (!['merge', 'preserve'].includes(style.coarseLayout)) {
    throw new Error(`${style.key} coarseLayout must be merge or preserve.`);
  }

  style.footing = freezeFooting(style.footing, style.key);
  style.coping = freezeCoping(style.coping, style.key);

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
  /**
   * Chunky rounded field stone in the reference game's manner: pillow-shaped
   * units with rolled rims (meshed by `ConstructionPillowStoneMesher`), narrow
   * joints that the rounding opens into dark crevices, a buried footing course
   * of big stones, and a thick capstone course on a flat top.
   */
  'rounded-fieldstone': defineConstructionStyle({
    key: 'rounded-fieldstone',
    label: 'Rounded fieldstone',
    courseHeight: 0.5,
    targetWidth: 0.95,
    minWidth: 0.3,
    irregularity: 0.42,
    detail: 2,
    merlonSpacing: 1.2,
    stonePalette: 'warm-fieldstone',
    bedAmplitude: 0.1,
    jointTilt: 0.12,
    splitChance: 0.36,
    splitMaxDepth: 1,
    // A course split horizontally leaves two slabs a rounded rim turns into
    // sausages; only let it happen where both halves stay chunky.
    splitMinHeight: 0.24,
    depthScaleMin: 0.97,
    depthScaleMax: 1.0,
    faceOffsetAmplitude: 0.022,
    geometry: 'rounded',
    defaultTop: 'flat',
    footing: {
      heightRatio: 1.5,
      widthRatio: 1.35,
      splitChance: 0.15,
      plinth: 0.05,
      burialMargin: 0.1,
      burialMax: 0.6,
    },
    coping: {
      height: 0.24,
      oversail: 1.2,
      widthRatio: 1.35,
    },
  }),
  /**
   * The reference look (docs/reference/tiny-glade): a few big blocks, about
   * five courses to a wall, lying on their beds rather than standing up; wide
   * flat chamfers that catch the sun; joints deep enough to sit in shadow;
   * saturated apricot sandstone. The odd unsplit two-course block breaks the
   * bed lines. New wall strokes use this style.
   */
  'glade-sandstone': defineConstructionStyle({
    key: 'glade-sandstone',
    label: 'Glade sandstone',
    coarseLayout: 'preserve',
    courseHeight: 0.6,
    targetWidth: 0.95,
    minWidth: 0.36,
    // Neat, aligned blocks: jitter's shrink, skew and turn opened visible
    // slots between neighbours.
    irregularity: 0.12,
    detail: 2,
    merlonSpacing: 1.7,
    stonePalette: 'glade-sandstone',
    bedAmplitude: 0.1,
    jointTilt: 0.06,
    // Two-course cells are mostly cut along the bed at an uneven height, so
    // neighbouring stacks do not share a seam; the uncut ones stay as tall
    // blocks. `splitMinAspect` turns any cut that would stand a stone upright
    // into a bed cut.
    coursesPerBand: 2,
    splitChance: 0.86,
    splitHorizontalChance: 0.85,
    splitMaxDepth: 2,
    splitMinHeight: 0.28,
    splitMinAspect: 1.05,
    depthScaleMin: 0.94,
    depthScaleMax: 1.0,
    // Some blocks stand proud of the face, a few sit back.
    faceOffsetAmplitude: 0.045,
    faceOffsetCoherence: 0.55,
    // One block per tooth, varied in width, spacing and height.
    merlonHeight: 0.6,
    merlonCourseHeight: 0.6,
    merlonVariation: 0.7,
    merlonMaxColumns: 1,
    openingBlockScale: 1.7,
    // Stones are bent to the arc, so curves keep big blocks.
    curveWidthTolerance: 0.06,
    // Blocks meet at the joint width: no in-plane shrink or turn.
    exactFit: true,
    // Real units supply the joints and worn bevels; broad faces stay calm.
    geometry: 'rounded',
    defaultTop: 'flat',
    footing: {
      heightRatio: 1.15,
      widthRatio: 1.25,
      splitChance: 0.1,
      plinth: 0.02,
      burialMargin: 0.06,
      burialMax: 0.4,
    },
    // About 1.5 stones per square metre: a 12 m, 4 m module needs ~75.
    stoneBudget: { module: 280, construction: 6000 },
    // The crown is a course of the wall's own blocks, stepped by wear rather
    // than a thin overhanging cap.
    coping: {
      height: 0.36,
      oversail: 1.0,
      widthRatio: 1.0,
      crownVariation: 0.25,
    },
  }),
});

export const STONEHOLD_ASHLAR_STYLE = defineConstructionStyle({
  key: 'stonehold-ashlar',
  label: 'Stonehold dwarven ashlar',
  coarseLayout: 'preserve',
  courseHeight: 0.82,
  targetWidth: 1.95,
  minWidth: 0.68,
  irregularity: 0.14,
  detail: 2,
  merlonSpacing: 2.0,
  stonePalette: 'granite',
  // Precision-cut cyclopean mountain blocks: nearly level courses, tight plumb joints.
  bedAmplitude: 0.025,
  jointTilt: 0.025,
  splitChance: 0.16,
  splitMaxDepth: 1,
  splitMinHeight: 0.36,
  depthScaleMin: 0.96,
  depthScaleMax: 1.0,
  faceOffsetAmplitude: 0.022,
  faceOffsetCoherence: 0.6,
  openingBlockScale: 1.9,
  footing: {
    heightRatio: 1.35,
    widthRatio: 1.18,
    splitChance: 0.08,
    plinth: 0.025,
    burialMargin: 0,
    burialMax: 0,
  },
  coping: {
    height: 0.34,
    oversail: 1.06,
    widthRatio: 1.05,
    crownVariation: 0.04,
  },
});

export const DEFAULT_CONSTRUCTION_STYLE_KEY = 'rounded-fieldstone';

export const CONSTRUCTION_STYLE_KEYS = Object.freeze(Object.keys(CONSTRUCTION_STYLES));

export function isConstructionStyleKey(key) {
  return typeof key === 'string' && Object.hasOwn(CONSTRUCTION_STYLES, key);
}

export function constructionStyle(key) {
  const style = CONSTRUCTION_STYLES[key];
  if (!style) throw new Error(`Unknown construction style ${key}.`);
  return style;
}
