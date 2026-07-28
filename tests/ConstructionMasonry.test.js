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
import { mixSeed } from '../src/editor/workshop/ProceduralRandom.js';

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
  const style = constructionStyle(built.style.key);
  const arcTable = createCurveArcTable(sampleCubicBezierPath(built.path));
  const profile = createWallTopProfile(built, arcTable, { style });
  return { record: built, arcTable, profile, style };
}

function pack(context, {
  arcRange, seedOffset = 0, budget, wallRange, courseHeight, style,
} = {}) {
  return packCurvedWall({
    arcTable: context.arcTable,
    arcRange: arcRange ?? [0, context.arcTable.totalLength],
    style: style ?? context.style ?? STYLE,
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

/**
 * Field masonry grouped course by course, and within a course cell by cell.
 *
 * `CourseLattice` can cut a base cell into up to four stones, so the exact-fill
 * contract now sits one level up: the *cells* tile the course, and the leaves
 * partition their own cell. Grouping on `courseIndex` rather than on
 * `heightRatio` is what makes that visible — a bed joint ramps along the wall, so
 * two stones in one course legitimately sit at different heights.
 *
 * @returns courses bottom-up, each an array of cells ordered along the wall,
 *   each cell `{ from, to, leaves }`.
 */
function fieldCells(result) {
  const courses = new Map();
  for (const stone of result.stones) {
    if (stone.category !== 'field' || stone.courseIndex == null) continue;
    if (!courses.has(stone.courseIndex)) courses.set(stone.courseIndex, new Map());
    const cells = courses.get(stone.courseIndex);
    const leaves = cells.get(stone.cellIndex);
    if (leaves) leaves.push(stone);
    else cells.set(stone.cellIndex, [stone]);
  }
  return [...courses.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, cells]) => [...cells.values()]
      .map((leaves) => ({
        from: Math.min(...leaves.map((leaf) => leaf.s - leaf.packedWidth / 2)),
        to: Math.max(...leaves.map((leaf) => leaf.s + leaf.packedWidth / 2)),
        leaves,
      }))
      .sort((a, b) => a.from - b.from));
}

test('each course tiles its arc range exactly', () => {
  const context = setup(straightPath());
  const result = pack(context);
  assert.ok(result.stones.length > 20);

  const courses = fieldCells(result);
  assert.ok(courses.length >= 6, 'a 3.5 m wall should have several courses');

  for (const cells of courses) {
    // Every stone survives on a flat, unruined wall, so the cells must tile the
    // whole range with no gap and no overlap.
    assert.ok(Math.abs(cells[0].from) < 1e-9);
    assert.ok(Math.abs(cells.at(-1).to - context.arcTable.totalLength) < 1e-9);
    for (let index = 1; index < cells.length; index += 1) {
      assert.ok(
        Math.abs(cells[index].from - cells[index - 1].to) < 1e-9,
        'gap or overlap between cells',
      );
    }
  }
});

test('the leaves of a split cell partition it', () => {
  // A split has to be a partition, not a cover: overlapping leaves would z-fight
  // along the cut, and leaves that fall short would open a hole no mortar gap
  // was sized for.
  const context = setup(straightPath());
  let split = 0;
  for (const cells of fieldCells(context && pack(context))) {
    for (const { from, to, leaves } of cells) {
      if (leaves.length > 1) split += 1;
      const covered = leaves.reduce(
        (total, leaf) => total + leaf.packedWidth * leaf.bandHeight,
        0,
      );
      assert.ok(
        Math.abs(covered - (to - from)) < 1e-9,
        `cell covers ${covered} of ${to - from}`,
      );
    }
  }
  assert.ok(split > 20, `the fixture should split many cells, split ${split}`);
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
  const courses = fieldCells(pack(context));

  // Cell joints only. A vertical split cuts a *new* joint inside a cell, and
  // that one is deliberately not staggered against anything — it is a stone
  // being broken in two, not a course being bonded.
  const jointsOf = (cells) => cells.slice(0, -1).map((cell) => cell.to);

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
  //
  // The course grid is pinned across both fixtures, which is what the planner
  // does in practice — it solves one `courseHeight` for the whole wall. Letting
  // it float here would compare two different grids, and since a head joint's
  // lean scales with course height, every stone in the wall would differ by a
  // fraction of a millimetre for reasons that have nothing to do with seed
  // locality. `ConstructionPlanner` hashes the wall-wide grid into every module
  // precisely so a change to it rebuilds the whole wall rather than half of it.
  const courseHeight = 0.42;
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

  const before = new Map(
    pack(flat, { courseHeight }).stones.map((stone) => [stone.stableIndex, stone]),
  );
  const after = pack(raised, { courseHeight }).stones;
  let compared = 0;
  for (const stone of after) {
    const original = before.get(stone.stableIndex);
    if (!original) continue;             // a course the flat wall never reached
    if (stone.s > 14) continue;          // inside the raise, heights legitimately differ
    assert.equal(stone.width, original.width);
    assert.equal(stone.height, original.height);
    assert.equal(stone.depth, original.depth);
    assert.equal(stone.offsetNormal, original.offsetNormal);
    assert.deepEqual(stone.corners, original.corners);
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

test('adjacent modules meet without leaving a full-height joint', () => {
  const context = setup(straightPath(36));
  const total = context.arcTable.totalLength;
  const middle = total / 2;
  const wall = { wallRange: [0, total], courseHeight: null };
  const left = pack(context, { arcRange: [0, middle], seedOffset: 0, ...wall });
  const right = pack(context, { arcRange: [middle, total], seedOffset: 1, ...wall });

  const leftEdges = fieldCells(left).map((cells) => cells.at(-1).to);
  const rightEdges = fieldCells(right).map((cells) => cells[0].from);
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
  const leftCourses = fieldCells(left);
  const rightCourses = fieldCells(right);
  assert.ok(leftCourses.length > 1 && leftCourses.length === rightCourses.length);

  for (let index = 0; index < leftCourses.length; index += 1) {
    const gap = rightCourses[index][0].from - leftCourses[index].at(-1).to;
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

  for (const cells of fieldCells(left)) {
    assert.ok(Math.abs(cells[0].from) < 1e-9);
    // A hard edge is plumb as well as exact: the lean every other head joint
    // gets would throw the end stone out past the end of the wall. Only the
    // leaves actually touching the wall start — a vertical split puts its right
    // child on an interior joint, which is free to lean. Corners 0 and 3 are the
    // bottom-left and top-left of the face.
    const touching = cells[0].leaves.filter(
      (leaf) => Math.abs((leaf.s - leaf.packedWidth / 2) - cells[0].from) < 1e-9,
    );
    assert.ok(touching.length > 0);
    for (const leaf of touching) {
      assert.ok(
        Math.abs(leaf.corners[0][0] - leaf.corners[3][0]) < 1e-9,
        'the wall-start joint leaned',
      );
    }
  }
  for (const cells of fieldCells(right)) {
    assert.ok(Math.abs(cells.at(-1).to - total) < 1e-9);
  }
});

test('adjacent modules share a course grid so courses do not step', () => {
  const context = setup(straightPath(36));
  const total = context.arcTable.totalLength;
  const middle = total / 2;
  const wall = { wallRange: [0, total], courseHeight: 0.44 };
  const left = pack(context, { arcRange: [0, middle], seedOffset: 0, ...wall });
  const right = pack(context, { arcRange: [middle, total], seedOffset: 1, ...wall });

  const courseIndices = (result) => [...new Set(
    result.stones.filter(({ category }) => category === 'field')
      .map(({ courseIndex }) => courseIndex),
  )].sort((a, b) => a - b);
  assert.deepEqual(
    courseIndices(left),
    courseIndices(right),
    'courses must line up across the seam',
  );

  // And the bed line itself has to agree, not just the course numbering: the
  // two modules meet along one continuous ramp or the seam shows as a step of a
  // whole course. Checked to the width of the mortar joint rather than to 1e-9,
  // because each stone's own hashed inset has already shrunk its face by then —
  // `tests/ConstructionCourseLattice.test.js` pins the exact continuity upstream
  // of that, where it is a property of the lattice rather than of the packer.
  const seamBed = (result, atEnd) => fieldCells(result).map((course) => {
    const cell = atEnd ? course.at(-1) : course[0];
    const leaf = [...cell.leaves].sort((a, b) => a.y - b.y)[0];
    return leaf.y + leaf.corners[atEnd ? 1 : 0][1];
  });
  const leftSeam = seamBed(left, true);
  const rightSeam = seamBed(right, false);
  for (let index = 0; index < leftSeam.length; index += 1) {
    const step = leftSeam[index] - rightSeam[index];
    assert.ok(Math.abs(step) < 0.02, `bed line steps by ${step} at course ${index}`);
  }
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

function fieldCellGroups(result) {
  const groups = new Map();
  for (const stone of result.stones) {
    if (stone.category !== 'field' || stone.cellIndex == null) continue;
    if (!groups.has(stone.cellIndex)) groups.set(stone.cellIndex, []);
    groups.get(stone.cellIndex).push(stone);
  }
  return groups;
}

function softContext(path = straightPath(24), overrides = {}) {
  return setup(path, {
    style: { key: 'soft-limestone-rubble', version: 1 },
    ...overrides,
  });
}

test('soft-limestone-rubble packing is deterministic', () => {
  const context = softContext();
  assert.deepEqual(pack(context), pack(context));
});

test('soft-limestone-rubble never splits a cell past one level', () => {
  const result = pack(softContext(straightPath(36)));
  const groups = fieldCellGroups(result);
  assert.ok(groups.size > 20);
  for (const leaves of groups.values()) {
    assert.ok(leaves.length <= 2, `cell produced ${leaves.length} leaves`);
  }
  assert.ok(
    [...groups.values()].some((leaves) => leaves.length === 2),
    'some cells must still split into paired blocks',
  );
});

test('soft-limestone-rubble splits fewer cells than coursed rubble', () => {
  const soft = pack(softContext(straightPath(36)));
  const coursed = pack(setup(straightPath(36)));
  const splitCount = (result) => (
    [...fieldCellGroups(result).values()].filter((leaves) => leaves.length > 1).length
  );
  assert.ok(splitCount(soft) < splitCount(coursed));
});

test('soft-limestone-rubble keeps a comparable stone-density budget', () => {
  const soft = pack(softContext(straightPath(24)));
  const coursed = pack(setup(straightPath(24)));
  const ratio = soft.stones.length / coursed.stones.length;
  assert.ok(
    ratio > 0.85 && ratio < 1.15,
    `soft/coursed stone ratio ${ratio.toFixed(3)} outside ±15%`,
  );
});

test('soft-limestone-rubble stays under the module stone budget', () => {
  const context = softContext(straightPath(12));
  const result = pack(context);
  assert.equal(result.stats.overBudget, false);
  assert.ok(result.stones.length < MAX_MODULE_STONES);
});

test('soft-limestone-rubble joint insets follow the style range', () => {
  const style = constructionStyle('soft-limestone-rubble');
  const context = softContext(straightPath(24));
  const result = pack(context);
  const field = result.stones.filter((stone) => stone.category === 'field');
  assert.ok(field.length > 40);

  // Reproduce the packer's inset hash so we can assert the style range without
  // confusing arc-leaf width with the tilted face bounding box.
  const SHAPE_HASH = 0x27d4eb2d;
  const shapeSeed = mixSeed(context.record.seed ^ SHAPE_HASH, 0);
  const hashLane = (seed, index, lane) => (
    ((mixSeed(seed, index) >>> (lane * 8)) & 255) / 255
  );
  const lerp = (from, to, amount) => from + (to - from) * amount;

  for (const stone of field) {
    assert.ok(stone.width > 0);
    assert.ok(stone.height > 0.1);
    const inset = lerp(
      style.jointInsetMin,
      style.jointInsetMax,
      hashLane(shapeSeed, stone.stableIndex, 0),
    );
    assert.ok(
      inset >= style.jointInsetMin - 1e-12
      && inset <= style.jointInsetMax + 1e-12,
      `inset ${inset}`,
    );
    assert.ok(stone.width < stone.packedWidth + 0.05);
    assert.ok(stone.height < stone.bandHeight * style.courseHeight + 0.08);
  }
});

test('soft-limestone-rubble depth and face offset stay in style range', () => {
  const style = constructionStyle('soft-limestone-rubble');
  const thickness = 0.8;
  const result = pack(softContext(straightPath(36)));
  const field = result.stones.filter((stone) => stone.category === 'field');
  let forward = 0;
  let recessed = 0;
  let offsetSum = 0;
  for (const stone of field) {
    const depthScale = stone.depth / thickness;
    assert.ok(
      depthScale >= style.depthScaleMin - 1e-9
      && depthScale <= style.depthScaleMax + 1e-9,
      `depth scale ${depthScale}`,
    );
    // Straight wall: no curvature straddle, so offsetNormal is pure face offset.
    assert.ok(Math.abs(stone.offsetNormal) <= style.faceOffsetAmplitude + 1e-9);
    if (stone.offsetNormal > 1e-6) forward += 1;
    if (stone.offsetNormal < -1e-6) recessed += 1;
    offsetSum += stone.offsetNormal;
  }
  assert.ok(forward > 0 && recessed > 0);
  assert.ok(Math.abs(offsetSum / field.length) < 0.003);
});

test('soft-limestone-rubble adjacent modules stay seamless', () => {
  const context = softContext(straightPath(36));
  const total = context.arcTable.totalLength;
  const middle = total / 2;
  const wall = { wallRange: [0, total] };
  const left = pack(context, { arcRange: [0, middle], seedOffset: 0, ...wall });
  const right = pack(context, { arcRange: [middle, total], seedOffset: 1, ...wall });

  const leftEdges = fieldCells(left).map((cells) => cells.at(-1).to);
  const rightEdges = fieldCells(right).map((cells) => cells[0].from);
  assert.equal(leftEdges.length, rightEdges.length);
  for (let index = 0; index < leftEdges.length; index += 1) {
    assert.ok(Math.abs(leftEdges[index] - rightEdges[index]) < 1e-9);
  }
  const distinct = new Set(leftEdges.map((edge) => edge.toFixed(4)));
  assert.ok(distinct.size >= leftEdges.length - 1);
  for (const leaves of fieldCellGroups(left).values()) {
    assert.ok(leaves.length <= 2);
  }
  for (const leaves of fieldCellGroups(right).values()) {
    assert.ok(leaves.length <= 2);
  }
});

test('soft-limestone-rubble respects curvature limits on tight arcs', () => {
  for (const radius of [2.5, 4, 6, 9]) {
    for (const seed of [1, 7, 42]) {
      const context = softContext(tightArcPath(radius), { seed });
      const result = pack(context);
      assert.equal(result.stats.overBudget, false);
      assert.ok(result.stones.length < MAX_MODULE_STONES);
      for (const stone of result.stones) {
        assert.ok(stone.width > 0);
        assert.ok(stone.height > 0);
        const sagitta = chordSagitta(stone.packedWidth ?? stone.width, context.arcTable.curvatureAt(stone.s));
        assert.ok(sagitta <= 0.02 + 1e-6, `sagitta ${sagitta} at r=${radius}`);
      }
      if (radius <= 4) {
        assert.ok(
          result.stats.targetWidth < context.style.targetWidth,
          `tight r=${radius} should narrow stones`,
        );
      }
    }
  }
});
