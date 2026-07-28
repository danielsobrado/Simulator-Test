import assert from 'node:assert/strict';
import test from 'node:test';
import { planConstruction } from '../src/editor/construction/planning/ConstructionPlanner.js';
import { createCubicBezierPathFromStroke } from '../src/editor/construction/curve/CubicBezierPath.js';

function record() {
  return {
    version: 1,
    id: 'construction-1',
    revision: 3,
    seed: 11,
    kind: 'wall',
    label: 'Planner wall',
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 4, thickness: 1 },
    path: createCubicBezierPathFromStroke([
      [0, 0],
      [10, 4],
      [25, 0],
      [36, 3],
    ], { simplifyTolerance: 0.01 }),
    features: [],
  };
}

test('construction planning emits stable bounded semantic modules', () => {
  const first = planConstruction(record(), { maxModuleLength: 8 });
  const second = planConstruction(record(), { maxModuleLength: 8 });
  assert.deepEqual(first, second);
  assert.equal(first.constructionRevision, 3);
  assert.ok(first.totalLength > 25);
  assert.ok(first.modules.length >= 4);
  assert.equal(new Set(first.modules.map(({ id }) => id)).size, first.modules.length);
  for (const module of first.modules) {
    assert.ok(module.pathInterval[1] > module.pathInterval[0]);
    assert.ok(module.bounds.maxX > module.bounds.minX);
    assert.ok(module.bounds.maxZ > module.bounds.minZ);
  }
});

test('modules tile the whole wall with no gap between them', () => {
  // Module intervals used to come from each segment's own sampled points, but
  // the sampler drops every segment's duplicated first point — so segment n+1
  // started strictly after segment n ended, and each joint left an unwalled
  // sliver. It is visible in a finished wall as a vertical gap at every
  // segment boundary, and nothing inside the masonry packer can close it.
  const plan = planConstruction(record(), { maxModuleLength: 8 });
  const intervals = plan.modules.map(({ pathInterval }) => pathInterval);
  assert.ok(intervals.length > 3);

  assert.ok(Math.abs(intervals[0][0]) < 1e-9, 'the first module must start at the wall start');
  assert.ok(
    Math.abs(intervals.at(-1)[1] - plan.totalLength) < 1e-9,
    'the last module must end at the wall end',
  );
  for (let index = 1; index < intervals.length; index += 1) {
    const gap = intervals[index][0] - intervals[index - 1][1];
    assert.ok(
      Math.abs(gap) < 1e-9,
      `modules ${index - 1} and ${index} leave a ${gap.toFixed(4)} m gap`,
    );
  }
});

test('masonry covers every course from wall start to wall end', () => {
  const plan = planConstruction(record(), { maxModuleLength: 8 });
  // Grouped by course and then by base cell: `CourseLattice` can cut a cell into
  // several stones, so it is the cells that tile the course. Keyed on
  // `courseIndex` rather than on `heightRatio`, which a ramped bed joint no
  // longer holds constant along a course.
  const courses = new Map();
  for (const module of plan.modules) {
    for (const placement of module.placements ?? []) {
      if (placement.category !== 'field') continue;
      if (!courses.has(placement.courseIndex)) courses.set(placement.courseIndex, new Map());
      const cells = courses.get(placement.courseIndex);
      // `cellIndex` is module-local, so qualify it before pooling modules.
      const key = `${module.id}:${placement.cellIndex}`;
      const leaves = cells.get(key);
      if (leaves) leaves.push(placement);
      else cells.set(key, [placement]);
    }
  }
  assert.ok(courses.size >= 4, 'the fixture should have several courses');
  for (const [courseIndex, cells] of courses) {
    const spans = [...cells.values()]
      .map((leaves) => [
        Math.min(...leaves.map((leaf) => leaf.s - leaf.packedWidth / 2)),
        Math.max(...leaves.map((leaf) => leaf.s + leaf.packedWidth / 2)),
      ])
      .sort((a, b) => a[0] - b[0]);
    assert.ok(
      Math.abs(spans[0][0]) < 1e-6,
      `course ${courseIndex} does not reach the wall start`,
    );
    assert.ok(
      Math.abs(spans.at(-1)[1] - plan.totalLength) < 1e-6,
      `course ${courseIndex} does not reach the wall end`,
    );
    for (let index = 1; index < spans.length; index += 1) {
      const gap = spans[index][0] - spans[index - 1][1];
      assert.ok(Math.abs(gap) < 1e-6, `course ${courseIndex} has a ${gap.toFixed(4)} m hole`);
    }
  }
});

test('module content hashes only change where an anchor edit reaches', () => {
  const source = record();
  const before = planConstruction(source, { maxModuleLength: 8 });
  const changed = structuredClone(source);
  changed.path.anchors[0].position[1] = -4;
  changed.revision += 1;
  const after = planConstruction(changed, { maxModuleLength: 8 });

  const beforeHashes = new Map(before.modules.map(({ id, contentHash }) => [id, contentHash]));
  const segmentOf = new Map(before.modules.map(({ id, segmentId }) => [id, segmentId]));
  // Moving anchor 0 re-solves the handles of the first two segments, so those
  // modules must change and the rest must be byte-identical.
  const reachable = new Set(source.path.segments.slice(0, 2).map(({ id }) => id));
  let changedCount = 0;
  for (const module of after.modules) {
    if (!beforeHashes.has(module.id)) continue;
    if (module.contentHash === beforeHashes.get(module.id)) continue;
    changedCount += 1;
    assert.ok(
      reachable.has(segmentOf.get(module.id)),
      `module ${module.id} changed outside the edit's reach`,
    );
  }
  assert.ok(changedCount > 0, 'the edit must change something');
  assert.notEqual(before.contentHash, after.contentHash);
});

test('a material swap leaves geometry hashes unchanged', () => {
  const source = record();
  const before = planConstruction(source, { maxModuleLength: 8 });
  const painted = structuredClone(source);
  painted.style.materials = { stone: 'granite-masonry', mortar: null, roof: null };
  painted.revision += 1;
  const after = planConstruction(painted, { maxModuleLength: 8 });

  assert.equal(after.contentHash, before.contentHash);
  assert.equal(before.modules.length, after.modules.length);
  for (let index = 0; index < before.modules.length; index += 1) {
    assert.equal(before.modules[index].contentHash, after.modules[index].contentHash);
    assert.deepEqual(before.modules[index].pathInterval, after.modules[index].pathInterval);
    assert.deepEqual(before.modules[index].placements, after.modules[index].placements);
  }
});

test('a top profile edit only reaches the modules it interpolates across', () => {
  // The raise gesture writes bracketing control points at base height on either
  // side of the edit, which is what confines it. Without brackets a lone
  // control point sets the whole wall, because the profile clamps outside its
  // outermost point — so this test uses the shape the gesture actually emits.
  const lastSegmentId = record().path.segments.at(-1).id;
  const hashesOf = (shoulder, peak) => {
    const source = record();
    source.top = {
      style: 'flat',
      base: 4,
      profile: [
        { segmentId: lastSegmentId, arcFraction: 0.5, height: 4 },
        { segmentId: lastSegmentId, arcFraction: 0.65, height: shoulder },
        { segmentId: lastSegmentId, arcFraction: 0.8, height: peak },
        { segmentId: lastSegmentId, arcFraction: 0.95, height: 4 },
      ],
    };
    return new Map(
      planConstruction(source, { maxModuleLength: 8 })
        .modules.map(({ id, contentHash }) => [id, contentHash]),
    );
  };

  const base = hashesOf(4, 5);
  const ids = [...base.keys()];

  // A shoulder moved under the peak, and a raise that lifts the peak itself.
  // Both stay local, including the second: the course grid is the style's course
  // height flat, so no top edit can re-space the courses on a module the edit
  // never reached. Deriving the grid from the wall's tallest point instead made
  // every raise a whole-wall rebuild.
  for (const [label, changed] of [
    ['shoulder', hashesOf(4.6, 5)],
    ['peak', hashesOf(4, 7)],
  ]) {
    assert.equal(
      changed.get(ids[0]),
      base.get(ids[0]),
      `a ${label} edit at the far end reached the near end`,
    );
    assert.notEqual(changed.get(ids.at(-1)), base.get(ids.at(-1)));
  }
});

test('editing one segment leaves other segment module IDs stable', () => {
  const source = record();
  const before = planConstruction(source, { maxModuleLength: 8 });
  const changed = structuredClone(source);
  changed.path.anchors[0].position[1] = -4;
  changed.revision += 1;
  const after = planConstruction(changed, { maxModuleLength: 8 });
  const lastSegmentId = source.path.segments.at(-1).id;
  assert.deepEqual(
    before.modules.filter(({ segmentId }) => segmentId === lastSegmentId).map(({ id }) => id),
    after.modules.filter(({ segmentId }) => segmentId === lastSegmentId).map(({ id }) => id),
  );
});
