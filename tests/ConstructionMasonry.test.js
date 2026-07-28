import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_MODULE_STONES,
  chordSagitta,
  curvatureLimitedWidth,
  packCurvedWall,
} from '../src/editor/construction/masonry/CurvedCoursePacker.js';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';
import { constructionStyle } from '../src/editor/construction/masonry/ConstructionStyleCatalog.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';

const STYLE = constructionStyle('coursed-rubble');

function straightPath(length = 24) {
  return createCubicBezierPathFromStroke([
    [0, 0], [length / 3, 0], [(length * 2) / 3, 0], [length, 0],
  ], { simplifyTolerance: 0.01 });
}

/** A tight arc: roughly a 4 m radius quarter turn. */
function tightArcPath(radius = 4) {
  const points = [];
  for (let index = 0; index <= 12; index += 1) {
    const angle = (index / 12) * (Math.PI / 2);
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return createCubicBezierPathFromStroke(points, { simplifyTolerance: 0.01 });
}

function record(path, overrides = {}) {
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 3141,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 3.5, thickness: 0.8 },
    path,
    features: [],
    ...overrides,
  });
}

function setup(path, overrides = {}) {
  const built = record(path, overrides);
  const arcTable = createCurveArcTable(sampleCubicBezierPath(built.path));
  const profile = createWallTopProfile(built, arcTable, { style: STYLE });
  return { record: built, arcTable, profile };
}

function pack(context, {
  arcRange, seedOffset = 0, budget, wallRange, courseHeight,
} = {}) {
  return packCurvedWall({
    arcTable: context.arcTable,
    arcRange: arcRange ?? [0, context.arcTable.totalLength],
    style: STYLE,
    thickness: context.record.dimensions.thickness,
    seed: context.record.seed,
    seedOffset,
    topHeightAt: context.profile.heightAt,
    ruinFactorAt: context.profile.ruinFactorAt,
    ...(wallRange ? { wallRange } : {}),
    ...(courseHeight ? { courseHeight } : {}),
    ...(budget === undefined ? {} : { budget }),
  });
}

test('packing is deterministic', () => {
  const context = setup(straightPath());
  assert.deepEqual(pack(context), pack(context));
});

test('each course tiles its arc range exactly', () => {
  const context = setup(straightPath());
  const { stones } = pack(context);
  assert.ok(stones.length > 20);

  const byCourse = new Map();
  for (const stone of stones) {
    const key = stone.heightRatio.toFixed(6);
    if (!byCourse.has(key)) byCourse.set(key, []);
    byCourse.get(key).push(stone);
  }
  assert.ok(byCourse.size >= 6, 'a 3.5 m wall should have several courses');

  for (const course of byCourse.values()) {
    const ordered = [...course].sort((a, b) => a.s - b.s);
    // Every stone survives on a flat, unruined wall, so the packed widths must
    // tile the whole range with no gap and no overlap.
    assert.ok(Math.abs((ordered[0].s - ordered[0].packedWidth / 2) - 0) < 1e-9);
    const last = ordered.at(-1);
    assert.ok(
      Math.abs((last.s + last.packedWidth / 2) - context.arcTable.totalLength) < 1e-9,
    );
    for (let index = 1; index < ordered.length; index += 1) {
      const previousEdge = ordered[index - 1].s + ordered[index - 1].packedWidth / 2;
      const nextEdge = ordered[index].s - ordered[index].packedWidth / 2;
      assert.ok(Math.abs(previousEdge - nextEdge) < 1e-9, 'gap or overlap between stones');
    }
  }
});

test('stone width is capped so the chord hides inside the mortar joint', () => {
  // `WIDTH_SAFETY` is an empirical bound on how far `packCourse`'s
  // fill-the-span normalization can inflate its widest draw. Sweep radii and
  // seeds so the constant is held to evidence rather than to one fixture.
  let narrowed = 0;
  let checked = 0;
  for (const radius of [2.5, 4, 6, 9, 14]) {
    for (const seed of [1, 7, 3141, 88_017, 525_600]) {
      const context = setup(tightArcPath(radius), { seed });
      const { stones, stats } = pack(context);
      assert.ok(stones.length > 0, `radius ${radius} seed ${seed} produced nothing`);
      if (stats.targetWidth < STYLE.targetWidth) narrowed += 1;
      for (const stone of stones) {
        const sagitta = chordSagitta(
          stone.packedWidth,
          context.arcTable.curvatureAt(stone.s),
        );
        assert.ok(
          sagitta <= 0.02 + 1e-9,
          `radius ${radius} seed ${seed}: width ${stone.packedWidth.toFixed(3)} `
          + `gives sagitta ${sagitta.toFixed(4)}`,
        );
        checked += 1;
      }
    }
  }
  assert.ok(checked > 2000, 'the sweep should cover many stones');
  assert.ok(narrowed > 0, 'tight radii must actually narrow the target width');
});

test('a straight wall is not narrowed', () => {
  const context = setup(straightPath());
  assert.equal(pack(context).stats.targetWidth, STYLE.targetWidth);
  assert.equal(curvatureLimitedWidth(0), Infinity);
});

test('stones straddle the arc rather than chording to one side', () => {
  const context = setup(tightArcPath(4));
  const { stones } = pack(context);
  const offsets = stones.map(({ offsetNormal }) => offsetNormal);
  const mean = offsets.reduce((total, value) => total + value, 0) / offsets.length;
  // The straddle is signed against the curve, so on a consistently curving path
  // it pushes every stone the same way by half its own sagitta.
  assert.ok(Math.abs(mean) > 1e-4, 'expected a systematic straddle offset');
  assert.ok(Math.abs(mean) < 0.02, 'the straddle must stay inside the joint');
});

test('joints stagger against the course below', () => {
  const context = setup(straightPath());
  const { stones } = pack(context);
  const byCourse = new Map();
  for (const stone of stones) {
    const key = stone.heightRatio.toFixed(6);
    if (!byCourse.has(key)) byCourse.set(key, []);
    byCourse.get(key).push(stone);
  }
  const courses = [...byCourse.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, course]) => [...course].sort((a, b) => a.s - b.s));

  const jointsOf = (course) => course
    .slice(0, -1)
    .map((stone) => stone.s + stone.packedWidth / 2);

  const band = STYLE.targetWidth * 0.25;
  let checked = 0;
  for (let index = 1; index < courses.length; index += 1) {
    const below = jointsOf(courses[index - 1]);
    for (const joint of jointsOf(courses[index])) {
      for (const other of below) {
        assert.ok(
          Math.abs(joint - other) > band * 0.5,
          `joint at ${joint} stacks on ${other}`,
        );
        checked += 1;
      }
    }
  }
  assert.ok(checked > 100, 'the fixture should exercise many joint pairs');
});

test('the budget degrades instead of throwing', () => {
  const context = setup(straightPath(400));
  const { stones, stats } = pack(context, { budget: 64 });
  assert.equal(stats.overBudget, true);
  assert.ok(stones.length <= 64);
  assert.ok(stats.stones <= 64);
});

test('the default module budget is generous enough for a 12 m module', () => {
  const context = setup(straightPath(12));
  const { stats } = pack(context);
  assert.equal(stats.overBudget, false);
  assert.ok(stats.stones < MAX_MODULE_STONES);
});

test('raising one end does not re-roll the masonry at the other', () => {
  // The whole point of hashing per-stone shaping on `stableIndex` rather than
  // pulling from the sequential stream: a dropped or added stone must not shift
  // every stone after it.
  const flat = setup(straightPath(30));
  const segmentId = flat.record.path.segments.at(-1).id;
  const raised = setup(straightPath(30), {
    top: {
      style: 'flat',
      base: 3.5,
      profile: [
        { segmentId, arcFraction: 0.55, height: 3.5 },
        { segmentId, arcFraction: 0.8, height: 7 },
        { segmentId, arcFraction: 0.98, height: 3.5 },
      ],
    },
  });

  const before = new Map(pack(flat).stones.map((stone) => [stone.stableIndex, stone]));
  const after = pack(raised).stones;
  let compared = 0;
  for (const stone of after) {
    const original = before.get(stone.stableIndex);
    if (!original) continue;             // a course the flat wall never reached
    if (stone.s > 14) continue;          // inside the raise, heights legitimately differ
    assert.equal(stone.width, original.width);
    assert.equal(stone.depth, original.depth);
    assert.equal(stone.offsetNormal, original.offsetNormal);
    compared += 1;
  }
  assert.ok(compared > 100, 'expected many shared stones to compare');
});

test('a ruined wall drops from the top and keeps a footing', () => {
  const context = setup(straightPath(30), { top: { style: 'ruined', base: 4 } });
  const { stones, stats } = pack(context);
  assert.ok(stats.dropped > 0, 'a ruin must drop something');

  const heights = stones.map(({ heightRatio }) => heightRatio);
  const low = heights.filter((value) => value < 0.25).length;
  const high = heights.filter((value) => value > 0.75).length;
  assert.ok(low > high * 1.5, 'collapse must eat the top courses first');

  // Every metre of the wall keeps at least one bottom-course stone.
  const bottom = stones.filter(({ heightRatio }) => heightRatio < 0.2);
  for (let s = 1; s < 29; s += 1) {
    assert.ok(
      bottom.some((stone) => Math.abs(stone.s - s) < 1.5),
      `no footing survives near ${s} m`,
    );
  }
});

/** Field-stone courses, ordered bottom-up, each sorted along the wall. */
function fieldCourses(result) {
  const courses = new Map();
  for (const stone of result.stones.filter(({ category }) => category === 'field')) {
    const key = stone.heightRatio.toFixed(6);
    if (!courses.has(key)) courses.set(key, []);
    courses.get(key).push(stone);
  }
  return [...courses.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, course]) => [...course].sort((a, b) => a.s - b.s));
}

test('adjacent modules meet without leaving a full-height joint', () => {
  const context = setup(straightPath(36));
  const total = context.arcTable.totalLength;
  const middle = total / 2;
  const wall = { wallRange: [0, total], courseHeight: null };
  const left = pack(context, { arcRange: [0, middle], seedOffset: 0, ...wall });
  const right = pack(context, { arcRange: [middle, total], seedOffset: 1, ...wall });

  const leftEdges = fieldCourses(left).map((course) => {
    const last = course.at(-1);
    return last.s + last.packedWidth / 2;
  });
  const rightEdges = fieldCourses(right).map((course) => {
    const first = course[0];
    return first.s - first.packedWidth / 2;
  });
  assert.ok(leftEdges.length >= 6, 'the fixture should have several courses');

  // The two modules still meet exactly — no gap, no overlap.
  for (let index = 0; index < leftEdges.length; index += 1) {
    assert.ok(
      Math.abs(leftEdges[index] - rightEdges[index]) < 1e-9,
      `course ${index} leaves a gap of ${leftEdges[index] - rightEdges[index]}`,
    );
  }

  // But the meeting point moves course to course, so the seam cannot stack
  // into the continuous vertical line that a partitioned wall otherwise shows.
  const distinct = new Set(leftEdges.map((edge) => edge.toFixed(4)));
  assert.ok(
    distinct.size >= leftEdges.length - 1,
    `the boundary joint stacked: only ${distinct.size} distinct positions`,
  );
  const spread = Math.max(...leftEdges) - Math.min(...leftEdges);
  assert.ok(spread > 0.2, `the boundary barely moves: ${spread} m`);
  assert.ok(spread < STYLE.targetWidth, 'the boundary must not wander a whole stone');
});

test('boundaries still meet where curvature differs across the seam', () => {
  // The wander offset must depend only on seed and course index. Scaling it by
  // the local `targetWidth` looks harmless but that value is curvature-limited
  // *per module*, so two modules either side of a bend shift by different
  // amounts and tear open a gap most of a stone wide.
  const context = setup(tightArcPath(5));
  const total = context.arcTable.totalLength;
  const middle = total / 2;
  const wall = { wallRange: [0, total] };
  const left = pack(context, { arcRange: [0, middle], seedOffset: 0, ...wall });
  const right = pack(context, { arcRange: [middle, total], seedOffset: 1, ...wall });

  // The two halves of a tight arc really do get different stone widths.
  assert.notEqual(left.stats.targetWidth, undefined);
  const leftCourses = fieldCourses(left);
  const rightCourses = fieldCourses(right);
  assert.ok(leftCourses.length > 1 && leftCourses.length === rightCourses.length);

  for (let index = 0; index < leftCourses.length; index += 1) {
    const last = leftCourses[index].at(-1);
    const first = rightCourses[index][0];
    const gap = (first.s - first.packedWidth / 2) - (last.s + last.packedWidth / 2);
    assert.ok(Math.abs(gap) < 1e-9, `course ${index} tore open a ${gap.toFixed(4)} m gap`);
  }
});

test('the wall ends stay hard edges even as boundaries wander', () => {
  const context = setup(straightPath(36));
  const total = context.arcTable.totalLength;
  const middle = total / 2;
  const wall = { wallRange: [0, total] };
  const left = pack(context, { arcRange: [0, middle], seedOffset: 0, ...wall });
  const right = pack(context, { arcRange: [middle, total], seedOffset: 1, ...wall });

  for (const course of fieldCourses(left)) {
    assert.ok(Math.abs((course[0].s - course[0].packedWidth / 2) - 0) < 1e-9);
  }
  for (const course of fieldCourses(right)) {
    const last = course.at(-1);
    assert.ok(Math.abs((last.s + last.packedWidth / 2) - total) < 1e-9);
  }
});

test('adjacent modules share a course grid so courses do not step', () => {
  const context = setup(straightPath(36));
  const total = context.arcTable.totalLength;
  const middle = total / 2;
  const courseHeight = 0.44;
  const wall = { wallRange: [0, total], courseHeight };
  const left = pack(context, { arcRange: [0, middle], seedOffset: 0, ...wall });
  const right = pack(context, { arcRange: [middle, total], seedOffset: 1, ...wall });

  const heights = (result) => [...new Set(
    result.stones.filter(({ category }) => category === 'field')
      .map(({ heightRatio }) => heightRatio.toFixed(6)),
  )].sort();
  assert.deepEqual(heights(left), heights(right), 'courses must line up across the seam');
});

test('a zero-length or zero-height range yields nothing rather than throwing', () => {
  const context = setup(straightPath());
  assert.deepEqual(pack(context, { arcRange: [5, 5] }).stones, []);
  const flattened = packCurvedWall({
    arcTable: context.arcTable,
    arcRange: [0, context.arcTable.totalLength],
    style: STYLE,
    thickness: 0.8,
    seed: 1,
    topHeightAt: () => 0,
  });
  assert.deepEqual(flattened.stones, []);
});
