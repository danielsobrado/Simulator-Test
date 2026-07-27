import { packCourse } from '../../workshop/ProceduralWorkshopCoursePacker.js';
import { createRandom, mixSeed } from '../../workshop/ProceduralRandom.js';

/**
 * Course-solve a curved wall in arc length.
 *
 * `packCourse` solves a 1-D interval problem — exact fill, joint staggering,
 * sliver dissolution — and arc length is a 1-D interval, so it is reused
 * unchanged. This module only maps the packed centres back onto path frames.
 *
 * Output is module-local and Three.js-free: `s` is an arc coordinate and `y` is
 * a height above local grade. The geometry builder resolves both against the
 * arc table and the terrain, so the packer stays testable in Node.
 */

/** Mortar joint a chord's sagitta is allowed to hide inside, in metres. */
const JOINT_TOLERANCE = 0.02;

/**
 * Headroom between the target width and the curvature limit.
 *
 * `packCourse` draws candidate widths in [0.72, 1.28] x targetWidth, but then
 * **normalizes them to fill the span exactly**. When the sample mean of those
 * draws falls below 1, every width scales up — so the widest emitted stone
 * exceeds 1.28 x targetWidth, by more the fewer stones the course has. With n
 * draws the sample mean has standard deviation ~0.162/sqrt(n), so a course of
 * ten stones can inflate by roughly 1.28 / (1 - 3 x 0.051) ~= 1.5.
 *
 * 1.75 covers the spread and that inflation with roughly 9% to spare. At 1.6 the
 * worst case lands exactly on the tolerance, and the finite-difference
 * curvature estimate is then enough to tip it over. It is a bound chosen from
 * the packer's actual distribution rather than a derived constant, so
 * `tests/ConstructionMasonry.test.js` sweeps radii and seeds to hold it honest.
 */
const WIDTH_SAFETY = 1.75;

export const MAX_MODULE_STONES = 280;
export const MAX_CONSTRUCTION_STONES = 6000;

/** Depth of the coping course that finishes a wall top. */
const COPING_HEIGHT = 0.16;
/** How far coping oversails the wall face, as a fraction of thickness. */
const COPING_OVERSAIL = 1.14;

const RUIN_HASH = 0x6ec1b5f3;
const SHAPE_HASH = 0x27d4eb2d;

/**
 * `stableIndex` ranges per unit kind within a module.
 *
 * Field, coping and merlon stones must not collide in the index space or they
 * would share `stoneJitter` hashes and shape identically. Separating them also
 * means adding a coping course cannot re-roll the field masonry beneath it.
 */
const INDEX_STRIDE = 10000;
const INDEX_COPING = 5000;
const INDEX_MERLON = 7000;

function hashUnit(seed, index) {
  return mixSeed(seed, index) / 0x100000000;
}

/** Independent unit lanes off one hash, so inset and depth do not correlate. */
function hashLane(seed, index, lane) {
  return ((mixSeed(seed, index) >>> (lane * 8)) & 255) / 255;
}

/**
 * Largest stone whose chord stays within the mortar joint on this curve.
 *
 * A block of width `w` chorded across radius `R = 1/k` leaves a wedge of
 * sagitta `R - sqrt(R^2 - (w/2)^2)`. `beveledBox`'s `skew` offsets the top and
 * bottom edges in local X, not the inner and outer faces in local Z, so it
 * cannot express a radial taper. Narrowing the stone instead is what real
 * curved masonry does, so this is correct rather than a workaround.
 */
export function curvatureLimitedWidth(curvature, tolerance = JOINT_TOLERANCE) {
  const magnitude = Math.abs(curvature);
  if (magnitude <= 1e-6) return Infinity;
  return 2 * Math.sqrt((2 * tolerance) / magnitude);
}

export function chordSagitta(width, curvature) {
  const magnitude = Math.abs(curvature);
  if (magnitude <= 1e-6) return 0;
  const radius = 1 / magnitude;
  const half = width / 2;
  if (half >= radius) return radius;
  return radius - Math.sqrt(radius * radius - half * half);
}

/**
 * Collapse eats the top courses first and leaves a footing, which is what makes
 * a ruin read as masonry that fell rather than as vertical noise.
 *
 * Keyed on `stableIndex` rather than on a sequential PRNG draw: a stone's fate
 * must not depend on how many stones happened to survive before it, or raising
 * one end of a wall would re-roll the other end.
 */
function shouldDropRuinStone(ruinFactor, y, localTop, seed, stableIndex) {
  if (ruinFactor <= 0) return false;
  const topDistance = Math.max(0, localTop - y);
  const reach = 0.35 + ruinFactor * 1.6;
  const proximity = Math.max(0, 1 - topDistance / reach);
  const chance = ruinFactor * (0.12 + proximity * 0.62);
  return hashUnit(seed ^ RUIN_HASH, stableIndex) < chance;
}

/**
 * @param options.arcRange `[s0, s1]` — this module's slice of the path.
 * @param options.topHeightAt `(s) => number` height above grade, from `WallTopProfile`.
 * @param options.ruinFactorAt `(s) => 0..1`, from `WallTopProfile`.
 * @param options.seedOffset module index, so each module forks the stream.
 */
export function packCurvedWall({
  arcTable,
  arcRange,
  style,
  thickness,
  seed,
  seedOffset = 0,
  topHeightAt,
  ruinFactorAt = () => 0,
  slopeAt = () => 0,
  crenellationsOver = () => [],
  topStyle = 'flat',
  budget = MAX_MODULE_STONES,
}) {
  const [s0, s1] = arcRange;
  const span = s1 - s0;
  const stones = [];
  const stats = {
    courses: 0,
    stones: 0,
    dropped: 0,
    overBudget: false,
    targetWidth: style.targetWidth,
  };
  if (!(span > 1e-6)) return { stones, stats: Object.freeze(stats) };

  // Cap the stone width from the tightest curvature anywhere in the module, and
  // leave headroom for the packer's widest draw rather than for its mean.
  const curvatureLimit = curvatureLimitedWidth(arcTable.maxCurvatureOver(s0, s1));
  const targetWidth = Math.max(
    style.minWidth * 1.35,
    Math.min(style.targetWidth, curvatureLimit / WIDTH_SAFETY),
  );
  stats.targetWidth = targetWidth;

  // The course grid is sized from the tallest point the module reaches, so a
  // raised section adds courses rather than stretching every stone.
  let maxTop = 0;
  const topSamples = Math.max(4, Math.ceil(span / 0.5));
  for (let index = 0; index <= topSamples; index += 1) {
    maxTop = Math.max(maxTop, topHeightAt(s0 + (span * index) / topSamples));
  }
  if (!(maxTop > 0)) return { stones, stats: Object.freeze(stats) };

  // A coping course finishes the wall, so the field masonry stops short of the
  // crown by exactly its depth and the finished height still matches `top.base`.
  // A ruin has no coping — its top is a break, not a finish — and a crenellated
  // wall's crown carries merlons instead.
  const coped = topStyle === 'flat' || topStyle === 'irregular';
  const copingHeight = coped ? COPING_HEIGHT : 0;
  const bodyHeightAt = (s) => Math.max(0.12, topHeightAt(s) - copingHeight);

  const bodyMax = Math.max(0.12, maxTop - copingHeight);
  const courses = Math.max(1, Math.ceil(bodyMax / style.courseHeight));
  const courseHeight = bodyMax / courses;
  const random = createRandom(mixSeed(seed, seedOffset));
  const shapeSeed = mixSeed(seed ^ SHAPE_HASH, seedOffset);
  const baseIndex = seedOffset * INDEX_STRIDE;
  let stableIndex = baseIndex;
  let previousJoints = [];

  stats.courses = courses;

  for (let course = 0; course < courses; course += 1) {
    const y = (course + 0.5) * courseHeight;
    const packed = packCourse({
      span,
      targetWidth,
      minWidth: style.minWidth,
      random,
      forbiddenJoints: previousJoints,
    });
    // Assigned from the solve, not from what survived, so staggering is a
    // property of the course and an opening or a ruin cannot unbond the wall.
    previousJoints = packed.joints;

    for (const stone of packed.stones) {
      // `packCourse` centres its stones on zero, in [-span/2, +span/2].
      const s = s0 + span / 2 + stone.center;
      const index = stableIndex;
      stableIndex += 1;

      const localTop = bodyHeightAt(s);
      if (y > localTop) continue;
      if (shouldDropRuinStone(ruinFactorAt(s), y, localTop, seed, index)) {
        stats.dropped += 1;
        continue;
      }
      if (stones.length >= budget) {
        stats.overBudget = true;
        continue;
      }

      const frame = arcTable.frameAt(s);
      const curvature = arcTable.curvatureAt(s);
      // Straddle the arc so the chord's error is split between the inner and
      // outer faces instead of landing entirely on one. Positive curvature
      // turns toward +normal, so the chord bulges that way and the block shifts
      // against it.
      const sagitta = chordSagitta(stone.width, curvature);
      const straddle = -Math.sign(curvature) * sagitta * 0.5;

      const inset = 0.012 + hashLane(shapeSeed, index, 0) * 0.018;
      stones.push(Object.freeze({
        category: 'field',
        s,
        y: y + (hashLane(shapeSeed, index, 1) - 0.5) * 0.025,
        offsetNormal: straddle + (hashLane(shapeSeed, index, 2) - 0.5) * 0.018,
        // The solved width before the mortar inset. The geometry uses `width`;
        // this is what tiles the course exactly, so coverage is checkable.
        packedWidth: stone.width,
        width: Math.max(0.12, stone.width - inset),
        height: Math.max(0.12, courseHeight - inset * 0.7),
        depth: thickness * (0.95 + hashLane(shapeSeed, index, 3) * 0.035),
        yaw: frame.yaw,
        roll: 0,
        stableIndex: index,
        heightRatio: y / maxTop,
      }));
    }
  }

  /** Shared emitter for the dressing passes, which differ only in placement. */
  const emitUnit = (category, s, y, index, size) => {
    if (stones.length >= budget) {
      stats.overBudget = true;
      return;
    }
    const frame = arcTable.frameAt(s);
    const curvature = arcTable.curvatureAt(s);
    const straddle = -Math.sign(curvature) * chordSagitta(size.width, curvature) * 0.5;
    stones.push(Object.freeze({
      category,
      s,
      y,
      offsetNormal: straddle,
      packedWidth: size.packedWidth ?? size.width,
      width: size.width,
      height: size.height,
      depth: size.depth,
      yaw: frame.yaw,
      roll: size.roll ?? 0,
      stableIndex: index,
      heightRatio: Math.min(1, y / maxTop),
    }));
  };

  if (coped) {
    // One course finishing the wall, rolled to follow the top's own slope so a
    // ramped or irregular wall reads as capped rather than stepped.
    let copingIndex = baseIndex + INDEX_COPING;
    const packed = packCourse({
      span,
      targetWidth: Math.min(targetWidth * 1.15, curvatureLimit / WIDTH_SAFETY),
      minWidth: style.minWidth,
      random,
      forbiddenJoints: previousJoints,
    });
    for (const stone of packed.stones) {
      const s = s0 + span / 2 + stone.center;
      const index = copingIndex;
      copingIndex += 1;
      // A ruined stretch has no crown to cap.
      if (ruinFactorAt(s) > 0.55) continue;
      const inset = 0.01 + hashLane(shapeSeed, index, 0) * 0.012;
      emitUnit('coping', s, topHeightAt(s) - copingHeight / 2, index, {
        packedWidth: stone.width,
        width: Math.max(0.12, stone.width - inset),
        height: copingHeight,
        // Coping oversails the face, which is what throws the shadow line that
        // reads as a finished top.
        depth: thickness * COPING_OVERSAIL,
        // `roll` is applied about the block's own local Z *before* the yaw
        // swings it onto the path — see the Euler-order note in the builder.
        roll: slopeAt(s),
      });
    }
  }

  if (topStyle === 'crenellated') {
    let merlonIndex = baseIndex + INDEX_MERLON;
    for (const merlon of crenellationsOver(s0, s1)) {
      if (merlon.s < s0 || merlon.s > s1) continue;
      // Merlons are bonded masonry, not single blocks: short packed courses so
      // they carry the same joints and jitter as the wall below.
      const merlonCourses = Math.max(1, Math.round(merlon.height / courseHeight));
      const merlonCourseHeight = merlon.height / merlonCourses;
      let merlonJoints = [];
      for (let course = 0; course < merlonCourses; course += 1) {
        const y = merlon.base + (course + 0.5) * merlonCourseHeight;
        const packed = packCourse({
          span: merlon.width,
          targetWidth,
          minWidth: Math.min(style.minWidth, merlon.width * 0.45),
          random,
          forbiddenJoints: merlonJoints,
        });
        merlonJoints = packed.joints;
        for (const stone of packed.stones) {
          const index = merlonIndex;
          merlonIndex += 1;
          const inset = 0.01 + hashLane(shapeSeed, index, 0) * 0.014;
          emitUnit('field', merlon.s + stone.center, y, index, {
            packedWidth: stone.width,
            width: Math.max(0.1, stone.width - inset),
            height: Math.max(0.1, merlonCourseHeight - inset * 0.7),
            depth: thickness * 0.92,
          });
        }
      }
    }
  }

  stats.stones = stones.length;
  return { stones: Object.freeze(stones), stats: Object.freeze(stats) };
}
