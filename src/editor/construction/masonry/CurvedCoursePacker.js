import { constructionJointProfile } from '../config/ConstructionJointProfiles.generated.js';
import { constructionRuinProfile } from '../config/ConstructionRuinConfig.generated.js';
import { packCourse } from '../../workshop/ProceduralWorkshopCoursePacker.js';
import { createRandom, mixSeed } from '../../workshop/ProceduralRandom.js';
import { layoutOpening, openingHalfWidthAt, survivingIntervals } from './OpeningLayout.js';
import {
  createBedField,
  jointTilt,
  resolveCellCorners,
  scaleCorners,
  splitCell,
} from './CourseLattice.js';
import { clampJointWidths, sampleJointWidths } from './JointWidthField.js';
import { layoutMerlon } from './MerlonOrnament.js';
import { CONSTRUCTION_SUPPORT_ROLE } from './ConstructionSupportRoles.js';
import {
  createRuinDamageField,
  isProtectedFooting,
} from './RuinDamageField.js';

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

const SHAPE_HASH = 0x27d4eb2d;
const BOUNDARY_HASH = 0x1b873593;

/**
 * How far a module boundary wanders per course, as a fraction of stone width.
 *
 * Modules partition the wall, so without this **every course has to terminate
 * on the same arc position** and the shared joint stacks into a continuous
 * vertical line up the full height of the wall — the one thing coursed masonry
 * never does. Offsetting the boundary per course makes the seam zigzag like any
 * other joint.
 *
 * The offset depends only on `(seed, course)`, never on the module, so the two
 * modules either side of a boundary compute the *same* shift and still meet
 * flush. It is clamped away at the wall's real ends, which genuinely are edges.
 */
const BOUNDARY_WANDER = 0.42;

/**
 * `stableIndex` ranges per unit kind within a module.
 *
 * Field, coping and merlon stones must not collide in the index space or they
 * would share `stoneJitter` hashes and shape identically. Separating them also
 * means adding a coping course cannot re-roll the field masonry beneath it.
 *
 * A base cell now reserves `LEAVES_PER_CELL` indices rather than one, because
 * `splitCell` can turn it into up to four stones and each needs its own shaping
 * hash. The lanes are scaled by the same factor so the headroom is unchanged.
 */
const LEAVES_PER_CELL = 4;
const INDEX_STRIDE = 40000;
const INDEX_COPING = 20000;
const INDEX_MERLON = 28000;
const INDEX_DRESSING = 34000;
/** Indices reserved per merlon: 4 rows x 3 cells, plus a corbel, plus slack. */
const MERLON_UNIT_STRIDE = 16;

/** A leaf this short reads as a chip wedged in the joint, not as a stone. */
const MIN_LEAF_HEIGHT = 0.09;

function hashUnit(seed, index) {
  return mixSeed(seed, index) / 0x100000000;
}

/** Independent unit lanes off one hash, so inset and depth do not correlate. */
function hashLane(seed, index, lane) {
  return ((mixSeed(seed, index) >>> (lane * 8)) & 255) / 255;
}

function lerp(from, to, amount) {
  return from + (to - from) * amount;
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
 * @param options.arcRange `[s0, s1]` — this module's slice of the path.
 * @param options.topHeightAt `(s) => number` height above grade, from `WallTopProfile`.
 * @param options.ruinFactorAt `(s) => 0..1`, from `WallTopProfile`.
 * @param options.ruinStateAt `(s) => { factor, nominalHeight, collapsedHeight }`.
 * @param options.seedOffset module index, so each module forks the stream.
 * @param options.deferRuinRemoval when true (ruined walls), emit damage
 *   candidates instead of dropping stones inline — the wall-wide support
 *   resolver owns final removal.
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
  ruinStateAt = null,
  slopeAt = () => 0,
  crenellationsOver = () => [],
  topStyle = 'flat',
  openings = [],
  /**
   * The whole wall's arc range. Only its real ends are hard edges; every
   * interior module boundary is free to wander per course.
   */
  wallRange = null,
  /**
   * Course height for the whole wall, so adjacent modules lay their courses at
   * the same heights. Derived per module it would drift wherever the wall top
   * differs, and the courses would step at the boundary.
   */
  courseHeight: courseHeightOverride = null,
  /**
   * Wall-wide top height that `heightRatio` is normalised against.
   *
   * Normalised per module it would mean the same physical course weathers
   * differently either side of a boundary, because `applyUnitShading` drives
   * weathering from this ratio.
   */
  heightReference = null,
  budget = MAX_MODULE_STONES,
  deferRuinRemoval = topStyle === 'ruined',
}) {
  const [s0, s1] = arcRange;
  const span = s1 - s0;
  const stones = [];
  const jointProfile = constructionJointProfile(style.key);
  const ruinProfile = constructionRuinProfile(style.key);
  const ruinField = deferRuinRemoval
    ? createRuinDamageField({
      seed,
      profile: ruinProfile,
      ruinFactorAt,
    })
    : null;
  const resolveRuinState = ruinStateAt ?? ((s) => Object.freeze({
    factor: ruinFactorAt(s),
    nominalHeight: topHeightAt(s),
    collapsedHeight: topHeightAt(s),
  }));
  const stats = {
    courses: 0,
    stones: 0,
    dropped: 0,
    ruinCandidates: 0,
    overBudget: false,
    targetWidth: style.targetWidth,
    jointSamples: 0,
    headJointTotal: 0,
    bedJointTotal: 0,
    headJointMin: Infinity,
    headJointMax: 0,
    bedJointMin: Infinity,
    bedJointMax: 0,
    headJointsClamped: 0,
    bedJointsClamped: 0,
    meanHeadJoint: 0,
    meanBedJoint: 0,
  };
  if (!(span > 1e-6)) {
    stats.headJointMin = 0;
    stats.bedJointMin = 0;
    return { stones, stats: Object.freeze(stats) };
  }

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
  if (!(maxTop > 0)) {
    stats.headJointMin = 0;
    stats.bedJointMin = 0;
    return { stones, stats: Object.freeze(stats) };
  }

  // A coping course finishes the wall, so the field masonry stops short of the
  // crown by exactly its depth and the finished height still matches `top.base`.
  // A ruin has no coping — its top is a break, not a finish — and a crenellated
  // wall's crown carries merlons instead.
  const coped = topStyle === 'flat' || topStyle === 'irregular';
  const copingHeight = coped ? COPING_HEIGHT : 0;
  const bodyHeightAt = (s) => Math.max(0.12, topHeightAt(s) - copingHeight);

  const bodyMax = Math.max(0.12, maxTop - copingHeight);
  const courseHeight = courseHeightOverride ?? style.courseHeight;
  // Ceil, not round: the top course is trimmed to the wall profile by
  // `resolveCellCorners`, so overshooting costs nothing and rounding down would
  // leave up to half a course of bare wall under the coping.
  const courses = Math.max(1, Math.ceil(bodyMax / courseHeight));
  const heightScale = heightReference ?? maxTop;
  const random = createRandom(mixSeed(seed, seedOffset));
  const shapeSeed = mixSeed(seed ^ SHAPE_HASH, seedOffset);
  const baseIndex = seedOffset * INDEX_STRIDE;
  let cellCounter = 0;
  let previousJoints = [];

  stats.courses = courses;

  // Bed lines, joint lean and cell splitting. The first two must agree across a
  // module boundary, so they are driven by the wall-wide `seed`, `courseHeight`
  // and `style` values and never by anything curvature-limited per module — the
  // same rule `boundaryOffset` below follows, for the same reason.
  const bedOffset = createBedField(seed, courseHeight, {
    amplitude: style.bedAmplitude ?? 0,
  });
  const tiltAmount = style.jointTilt ?? 0;
  // Splitting is safe to scale per module: a base cell never straddles a
  // boundary, so no two modules have to agree about how one is cut. A course the
  // curvature has already narrowed has small cells, and cutting those again would
  // only make splinters.
  const splitChance = (style.splitChance ?? 0) * Math.min(1, targetWidth / style.targetWidth);

  const [wallStart, wallEnd] = wallRange ?? [s0, s1];
  // Shared by both modules at a boundary, so it may depend only on `seed` and
  // the course index. Scaling by the local `targetWidth` would break that:
  // that value is curvature-limited per module, so two modules either side of a
  // bend would shift by different amounts and stop meeting at all.
  const boundaryOffset = (course) => (
    (hashUnit(seed ^ BOUNDARY_HASH, course) - 0.5) * 2 * BOUNDARY_WANDER * style.targetWidth
  );
  const courseRange = (course) => {
    const shift = boundaryOffset(course);
    return [
      s0 <= wallStart + 1e-6 ? wallStart : s0 + shift,
      s1 >= wallEnd - 1e-6 ? wallEnd : s1 + shift,
    ];
  };

  for (let course = 0; course < courses; course += 1) {
    const y = (course + 0.5) * courseHeight;
    const [courseStart, courseEnd] = courseRange(course);
    // Split the course around the openings and pack each surviving span
    // separately, so stone edges land flush on the jamb line rather than
    // wherever the omitted stone happened to end.
    const spans = openings.length > 0
      ? survivingIntervals([courseStart, courseEnd], openings, y)
      : [[courseStart, courseEnd]];

    const packedStones = [];
    const courseJoints = [];
    // Joints that have to stay plumb: the wall's real ends, and every jamb line
    // an opening cut into this course. Leaning those would put the stone either
    // proud of the wall end or into the void.
    const plumbJoints = [wallStart, wallEnd];
    for (const [from, to] of spans) {
      const spanWidth = to - from;
      const midpoint = from + spanWidth / 2;
      const packed = packCourse({
        span: spanWidth,
        targetWidth,
        minWidth: style.minWidth,
        random,
        // Translate the course below's joints into this span's local frame so
        // staggering survives the split; an opening must not unbond the wall.
        forbiddenJoints: previousJoints.map((joint) => joint - midpoint),
      });
      for (const stone of packed.stones) {
        packedStones.push({ ...stone, center: midpoint + stone.center });
      }
      for (const joint of packed.joints) courseJoints.push(midpoint + joint);
      // A jamb is a vertical line the course above must not stack a joint on.
      if (from > courseStart) {
        courseJoints.push(from);
        plumbJoints.push(from);
      }
      if (to < courseEnd) {
        courseJoints.push(to);
        plumbJoints.push(to);
      }
    }
    // Assigned from the solve, not from what survived, so staggering is a
    // property of the course and an opening or a ruin cannot unbond the wall.
    previousJoints = courseJoints;

    const tiltAt = (jointS) => (
      plumbJoints.some((plumb) => Math.abs(plumb - jointS) < 1e-6)
        ? 0
        : jointTilt(seed, course, jointS, courseHeight, tiltAmount)
    );

    for (const stone of packedStones) {
      // Spans report their stones already in absolute arc coordinates.
      const s = stone.center;
      // Counted per base cell, and incremented even for a cell the wall top or a
      // ruin removes, so a change at one end of the wall cannot shift the shaping
      // hash of every stone after it.
      const cell = cellCounter;
      cellCounter += 1;

      const localTop = bodyHeightAt(s);
      if (y > localTop) continue;

      // Coarse grid first, then split — the order the reference builds in, and
      // what puts one big block beside two stacked small ones.
      const leaves = splitCell(
        { courseIndex: course, s0: s - stone.width / 2, s1: s + stone.width / 2 },
        {
          seed,
          chance: splitChance,
          maxDepth: style.splitMaxDepth ?? 2,
          minWidth: style.minWidth,
          courseHeight,
        },
      );

      for (let ordinal = 0; ordinal < leaves.length; ordinal += 1) {
        const leaf = leaves[ordinal];
        const index = baseIndex + cell * LEAVES_PER_CELL + ordinal;
        const leafWidth = leaf.s1 - leaf.s0;
        const leafCenter = (leaf.s0 + leaf.s1) / 2;

        // Both tilts come from the joint's own arc position, so the neighbour
        // sharing that joint — in this cell, the next cell, or the next module —
        // resolves the identical corner and the two stones meet exactly.
        const face = resolveCellCorners(leaf, {
          bedOffset,
          courseHeight,
          tiltLeft: tiltAt(leaf.s0),
          tiltRight: tiltAt(leaf.s1),
          ceilingAt: bodyHeightAt,
          minHeight: MIN_LEAF_HEIGHT,
        });
        if (!face) continue;

        const verticalValues = face.corners.map(([, yValue]) => face.anchorY + yValue);
        const supportBottom = Math.min(...verticalValues);
        const supportTop = Math.max(...verticalValues);
        const role = course === 0
          ? CONSTRUCTION_SUPPORT_ROLE.FOUNDATION
          : CONSTRUCTION_SUPPORT_ROLE.FIELD;
        const support = Object.freeze({
          role,
          span: Object.freeze([leaf.s0, leaf.s1]),
          bottom: supportBottom,
          top: supportTop,
          courseIndex: course,
          groupId: null,
        });

        let ruinMeta = null;
        if (ruinField) {
          const state = resolveRuinState(leafCenter);
          const protectedFooting = isProtectedFooting({
            support,
            courseIndex: course,
          }, ruinProfile);
          const candidate = ruinField.evaluateStone({
            s: leafCenter,
            courseIndex: course,
            stableIndex: index,
            yTop: supportTop,
            collapsedTop: state.collapsedHeight,
            protectedFooting,
          });
          if (candidate.remove) stats.ruinCandidates += 1;
          // Legacy counter: preliminary damage still reports as "dropped"
          // candidates until the wall-wide resolver finalises survivors.
          if (candidate.remove) stats.dropped += 1;
          ruinMeta = Object.freeze({
            candidate: candidate.remove,
            score: candidate.score,
            clusterScore: candidate.clusterScore,
            proximity: candidate.proximity,
          });
        }

        if (stones.length >= budget) {
          stats.overBudget = true;
          continue;
        }

        const frame = arcTable.frameAt(leafCenter);
        const curvature = arcTable.curvatureAt(leafCenter);
        // Straddle the arc so the chord's error is split between the inner and
        // outer faces instead of landing entirely on one. Positive curvature
        // turns toward +normal, so the chord bulges that way and the block shifts
        // against it.
        const sagitta = chordSagitta(leafWidth, curvature);
        const straddle = -Math.sign(curvature) * sagitta * 0.5;

        // The lattice tiles exactly by construction, so the mortar gap is cut
        // out of the face. jointWidth is the total visible gap; scaleCorners
        // retracts once across the face (half per side when neighbours match).
        const sampledJointWidths = sampleJointWidths({
          profile: jointProfile,
          seed: shapeSeed,
          stableIndex: index,
          lodBand: 'near',
        });
        const jointWidths = clampJointWidths(face, sampledJointWidths, jointProfile);
        const scaleX = 1 - jointWidths.head / face.width;
        const scaleY = 1 - jointWidths.bed / face.height;
        const safeScaleX = Math.max(0.01, scaleX);
        const safeScaleY = Math.max(0.01, scaleY);

        stats.jointSamples += 1;
        stats.headJointTotal += jointWidths.head;
        stats.bedJointTotal += jointWidths.bed;
        stats.headJointMin = Math.min(stats.headJointMin, jointWidths.head);
        stats.headJointMax = Math.max(stats.headJointMax, jointWidths.head);
        stats.bedJointMin = Math.min(stats.bedJointMin, jointWidths.bed);
        stats.bedJointMax = Math.max(stats.bedJointMax, jointWidths.bed);
        if (jointWidths.headClamped) stats.headJointsClamped += 1;
        if (jointWidths.bedClamped) stats.bedJointsClamped += 1;

        const depthScale = lerp(
          style.depthScaleMin ?? 0.95,
          style.depthScaleMax ?? 0.985,
          hashLane(shapeSeed, index, 3),
        );
        const faceOffset = (hashLane(shapeSeed, index, 2) - 0.5)
          * 2
          * (style.faceOffsetAmplitude ?? 0.009);

        stones.push(Object.freeze({
          category: 'field',
          s: leafCenter,
          y: face.anchorY,
          offsetNormal: straddle + faceOffset,
          // Arc span of the solved leaf (before joint retraction).
          packedWidth: leafWidth,
          // Fraction of the course the leaf occupies, so a cell's leaves can be
          // shown to partition it rather than merely to span it.
          bandHeight: leaf.v1 - leaf.v0,
          corners: scaleCorners(face.corners, safeScaleX, safeScaleY),
          // Authoritative solved cell footprint for the recessed mortar core.
          mortarCorners: Object.freeze(
            face.corners.map((corner) => Object.freeze([...corner])),
          ),
          jointWidths: Object.freeze({
            head: jointWidths.head,
            bed: jointWidths.bed,
          }),
          // Frozen near-band widths so coarse LOD can amplify idempotently.
          jointWidthsNear: Object.freeze({
            head: jointWidths.head,
            bed: jointWidths.bed,
          }),
          width: face.width * safeScaleX,
          height: face.height * safeScaleY,
          depth: thickness * depthScale,
          yaw: frame.yaw,
          roll: 0,
          stableIndex: index,
          courseIndex: course,
          cellIndex: baseIndex + cell,
          heightRatio: face.anchorY / heightScale,
          support,
          ...(ruinMeta ? { ruin: ruinMeta } : {}),
        }));
      }
    }
  }

  /** Shared emitter for the dressing passes, which differ only in placement. */
  const emitUnit = (category, s, y, index, size, supportMeta = null) => {
    if (stones.length >= budget) {
      stats.overBudget = true;
      return;
    }
    const frame = arcTable.frameAt(s);
    const curvature = arcTable.curvatureAt(s);
    const straddle = -Math.sign(curvature) * chordSagitta(size.width, curvature) * 0.5;
    const packedWidth = size.packedWidth ?? size.width;
    const height = size.height;
    const role = supportMeta?.role
      ?? (category === 'coping'
        ? CONSTRUCTION_SUPPORT_ROLE.COPING
        : category === 'merlon'
          ? CONSTRUCTION_SUPPORT_ROLE.MERLON
          : category === 'voussoir'
            ? CONSTRUCTION_SUPPORT_ROLE.ARCH
            : CONSTRUCTION_SUPPORT_ROLE.JAMB);
    const bottom = y - height / 2;
    const top = y + height / 2;
    let aboveEnvelope = false;
    if (ruinField && resolveRuinState) {
      const state = resolveRuinState(s);
      aboveEnvelope = top > state.collapsedHeight + 0.05;
    }
    stones.push(Object.freeze({
      category,
      s,
      y,
      // Dressings sit at an explicit offset from the centreline (a voussoir
      // ring stands proud of each face); field units only straddle the chord.
      offsetNormal: straddle + (size.offsetNormal ?? 0),
      packedWidth,
      width: size.width,
      height,
      depth: size.depth,
      yaw: frame.yaw,
      roll: size.roll ?? 0,
      stableIndex: index,
      heightRatio: Math.min(1, y / heightScale),
      support: Object.freeze({
        role,
        span: Object.freeze([s - packedWidth / 2, s + packedWidth / 2]),
        bottom,
        top,
        courseIndex: supportMeta?.courseIndex ?? -1,
        groupId: supportMeta?.groupId ?? null,
        archOrdinal: supportMeta?.archOrdinal ?? null,
        side: supportMeta?.side ?? null,
      }),
      ...(ruinField ? {
        ruin: Object.freeze({
          candidate: false,
          score: 0,
          clusterScore: 0,
          proximity: 0,
          aboveEnvelope,
        }),
      } : {}),
    }));
  };

  if (coped) {
    // One course finishing the wall, rolled to follow the top's own slope so a
    // ramped or irregular wall reads as capped rather than stepped.
    let copingIndex = baseIndex + INDEX_COPING;
    // The cap is a course too, so it takes the next course index's offset —
    // otherwise the coping joint would be the one seam still stacking on the
    // module boundary, right along the most visible edge of the wall.
    const [copingStart, copingEnd] = courseRange(courses);
    const copingSpan = copingEnd - copingStart;
    const copingMidpoint = copingStart + copingSpan / 2;
    const packed = packCourse({
      span: copingSpan,
      targetWidth: Math.min(targetWidth * 1.15, curvatureLimit / WIDTH_SAFETY),
      minWidth: style.minWidth,
      random,
      // `previousJoints` is kept in absolute arc coordinates so it can be
      // shared across the split spans of a pierced course; `packCourse` works
      // in its own span-local frame, so convert on the way in or the coping
      // silently stops breaking bond with the course beneath it.
      forbiddenJoints: previousJoints.map((joint) => joint - copingMidpoint),
    });
    for (const stone of packed.stones) {
      const s = copingMidpoint + stone.center;
      const index = copingIndex;
      copingIndex += 1;
      // A ruined stretch has no crown to cap.
      if (ruinFactorAt(s) > 0.55) continue;
      // Nor does a stretch the void reaches all the way through — an opening
      // tall enough to break the crown would otherwise leave coping floating
      // over thin air, which is exactly what a standalone arcade produces.
      const crownY = topHeightAt(s) - copingHeight / 2;
      const pierced = openings.some((opening) => (
        Math.abs(opening.s - s) <= openingHalfWidthAt(opening, crownY)
      ));
      if (pierced) continue;
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
    let merlonOrdinal = 0;
    for (const merlon of crenellationsOver(s0, s1)) {
      if (merlon.s < s0 || merlon.s > s1) continue;
      // A fixed stride per merlon rather than a running counter: the ornament
      // emits a variable number of units, so counting them would make every
      // merlon's shape depend on how the ones before it happened to come out.
      const merlonIndex = baseIndex + INDEX_MERLON + merlonOrdinal * MERLON_UNIT_STRIDE;
      merlonOrdinal += 1;
      // Shaped stones rather than a plain packed block: tapered, bridged back to
      // the crown, sometimes pierced by an arrow loop, sometimes carrying a
      // corbel.
      const ornament = layoutMerlon(merlon, {
        minWidth: style.minWidth,
        thickness,
        seed,
        index: merlonIndex,
      });
      for (let unitIndex = 0; unitIndex < ornament.units.length; unitIndex += 1) {
        const unit = ornament.units[unitIndex];
        const index = merlonIndex + unitIndex;
        const inset = 0.01 + hashLane(shapeSeed, index, 0) * 0.014;
        emitUnit(unit.category, unit.s, unit.y, index, {
          packedWidth: unit.width,
          width: Math.max(0.1, unit.width - inset),
          height: Math.max(0.1, unit.height - inset * 0.7),
          depth: unit.depth,
        });
      }
    }
  }

  // Dressings last: they are placed against the void, not packed into a course,
  // and their categories scale the jitter down so they read as worked stone.
  let dressingIndex = baseIndex + INDEX_DRESSING;
  for (const opening of openings) {
    const { jambs, voussoirs, keystone } = layoutOpening(opening, { thickness, minWidth: style.minWidth });
    const openingId = opening.id ?? `opening@${opening.s}`;
    let jambOrdinal = 0;
    for (const unit of jambs) {
      if (unit.s < s0 - 0.5 || unit.s > s1 + 0.5) continue;
      const index = dressingIndex;
      dressingIndex += 1;
      const side = unit.s < opening.s ? -1 : 1;
      emitUnit(unit.category, unit.s, unit.y, index, {
        width: unit.width,
        height: unit.height,
        depth: unit.depth,
        roll: unit.roll,
        offsetNormal: unit.offsetNormal,
      }, {
        role: CONSTRUCTION_SUPPORT_ROLE.JAMB,
        groupId: `opening:${openingId}:${side < 0 ? 'left' : 'right'}-jamb`,
        courseIndex: jambOrdinal,
        side,
        archOrdinal: 0,
      });
      jambOrdinal += 1;
    }
    let archOrdinal = 0;
    for (const unit of voussoirs) {
      if (unit.s < s0 - 0.5 || unit.s > s1 + 0.5) continue;
      const index = dressingIndex;
      dressingIndex += 1;
      emitUnit(unit.category, unit.s, unit.y, index, {
        width: unit.width,
        height: unit.height,
        depth: unit.depth,
        roll: unit.roll,
        offsetNormal: unit.offsetNormal,
      }, {
        role: CONSTRUCTION_SUPPORT_ROLE.ARCH,
        groupId: `opening:${openingId}:arch`,
        courseIndex: -1,
        archOrdinal,
      });
      archOrdinal += 1;
    }
    if (keystone) {
      if (!(keystone.s < s0 - 0.5 || keystone.s > s1 + 0.5)) {
        const index = dressingIndex;
        dressingIndex += 1;
        emitUnit(keystone.category, keystone.s, keystone.y, index, {
          width: keystone.width,
          height: keystone.height,
          depth: keystone.depth,
          roll: keystone.roll,
          offsetNormal: keystone.offsetNormal,
        }, {
          role: CONSTRUCTION_SUPPORT_ROLE.KEYSTONE,
          groupId: `opening:${openingId}:arch`,
          courseIndex: -1,
          archOrdinal: 999,
        });
      }
    }
  }

  stats.stones = stones.length;
  stats.openings = openings.length;
  stats.meanHeadJoint = stats.jointSamples > 0
    ? stats.headJointTotal / stats.jointSamples
    : 0;
  stats.meanBedJoint = stats.jointSamples > 0
    ? stats.bedJointTotal / stats.jointSamples
    : 0;
  if (stats.jointSamples === 0) {
    stats.headJointMin = 0;
    stats.bedJointMin = 0;
  }
  return { stones: Object.freeze(stones), stats: Object.freeze(stats) };
}
