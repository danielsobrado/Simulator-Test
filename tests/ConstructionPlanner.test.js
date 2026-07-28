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
  const courses = new Map();
  for (const module of plan.modules) {
    for (const placement of module.placements ?? []) {
      if (placement.category !== 'field') continue;
      const key = Math.round(placement.heightRatio * 1e5);
      if (!courses.has(key)) courses.set(key, []);
      courses.get(key).push(placement);
    }
  }
  assert.ok(courses.size >= 4, 'the fixture should have several courses');
  for (const [key, course] of courses) {
    course.sort((a, b) => a.s - b.s);
    assert.ok(
      Math.abs((course[0].s - course[0].packedWidth / 2)) < 1e-6,
      `course ${key} does not reach the wall start`,
    );
    const last = course.at(-1);
    assert.ok(
      Math.abs((last.s + last.packedWidth / 2) - plan.totalLength) < 1e-6,
      `course ${key} does not reach the wall end`,
    );
    for (let index = 1; index < course.length; index += 1) {
      const gap = (course[index].s - course[index].packedWidth / 2)
        - (course[index - 1].s + course[index - 1].packedWidth / 2);
      assert.ok(Math.abs(gap) < 1e-6, `course ${key} has a ${gap.toFixed(4)} m hole`);
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

test('a material swap changes hashes while the curve does not', () => {
  const source = record();
  const before = planConstruction(source, { maxModuleLength: 8 });
  const painted = structuredClone(source);
  painted.style.materials = { stone: 'granite-masonry', mortar: null, roof: null };
  painted.revision += 1;
  const after = planConstruction(painted, { maxModuleLength: 8 });
  assert.equal(before.modules.length, after.modules.length);
  for (let index = 0; index < before.modules.length; index += 1) {
    assert.notEqual(before.modules[index].contentHash, after.modules[index].contentHash);
    assert.deepEqual(before.modules[index].pathInterval, after.modules[index].pathInterval);
  }
});

test('a top profile edit only reaches the modules it interpolates across', () => {
  // The raise gesture writes bracketing control points at base height on either
  // side of the edit, which is what confines it. Without brackets a lone
  // control point sets the whole wall, because the profile clamps outside its
  // outermost point — so this test uses the shape the gesture actually emits.
  const lastSegmentId = record().path.segments.at(-1).id;
  const withPeak = (height) => {
    const source = record();
    source.top = {
      style: 'flat',
      base: 4,
      profile: [
        { segmentId: lastSegmentId, arcFraction: 0.55, height: 4 },
        { segmentId: lastSegmentId, arcFraction: 0.8, height },
        { segmentId: lastSegmentId, arcFraction: 0.98, height: 4 },
      ],
    };
    return source;
  };
  const before = planConstruction(withPeak(5), { maxModuleLength: 8 });
  const after = planConstruction(withPeak(7), { maxModuleLength: 8 });
  const beforeHashes = new Map(before.modules.map(({ id, contentHash }) => [id, contentHash]));
  const firstModule = after.modules[0];
  assert.equal(
    firstModule.contentHash,
    beforeHashes.get(firstModule.id),
    'a raise at the far end must not dirty the near end',
  );
  assert.notEqual(
    after.modules.at(-1).contentHash,
    beforeHashes.get(after.modules.at(-1).id),
  );
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
