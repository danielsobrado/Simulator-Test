import assert from 'node:assert/strict';
import test from 'node:test';
import { createCurveArcTable } from '../src/editor/construction/masonry/CurveArcTable.js';
import { createWallTopProfile } from '../src/editor/construction/masonry/WallTopProfile.js';
import { normalizeConstructionRecord } from '../src/editor/construction/ConstructionSchema.js';
import {
  createCubicBezierPathFromStroke,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';

function straightPath(length = 20) {
  return createCubicBezierPathFromStroke([
    [0, 0],
    [length / 2, 0],
    [length, 0],
  ], { simplifyTolerance: 0.01 });
}

function curvedPath() {
  return createCubicBezierPathFromStroke([
    [0, 0],
    [10, 6],
    [25, -2],
    [36, 4],
  ], { simplifyTolerance: 0.01 });
}

function record(overrides = {}) {
  return normalizeConstructionRecord({
    version: 1,
    id: 'construction-1',
    revision: 1,
    seed: 21,
    kind: 'wall',
    style: { key: 'coursed-rubble', version: 1 },
    dimensions: { height: 4, thickness: 1 },
    path: curvedPath(),
    features: [],
    ...overrides,
  });
}

function arcTable(path) {
  return createCurveArcTable(sampleCubicBezierPath(path));
}

test('arc and segment coordinates round-trip', () => {
  const table = arcTable(curvedPath());
  for (let step = 0; step <= 40; step += 1) {
    const s = table.totalLength * (step / 40);
    const { segmentId, arcFraction } = table.fromArc(s);
    assert.ok(Math.abs(table.toArc(segmentId, arcFraction) - s) < 1e-6);
  }
});

test('frame yaw orients local +X along the tangent and local +Z along the normal', () => {
  const table = arcTable(curvedPath());
  for (let step = 1; step < 20; step += 1) {
    const frame = table.frameAt(table.totalLength * (step / 20));
    // Three.js Ry(yaw) maps local +X to (cos yaw, -sin yaw) and +Z to
    // (sin yaw, cos yaw); both must land on the sampler's own basis.
    assert.ok(Math.abs(Math.cos(frame.yaw) - frame.tangentX) < 1e-6);
    assert.ok(Math.abs(-Math.sin(frame.yaw) - frame.tangentZ) < 1e-6);
    assert.ok(Math.abs(Math.sin(frame.yaw) - frame.normalX) < 1e-6);
    assert.ok(Math.abs(Math.cos(frame.yaw) - frame.normalZ) < 1e-6);
  }
});

test('a straight path has effectively zero curvature and a curved one does not', () => {
  const straight = arcTable(straightPath());
  assert.ok(straight.maxCurvatureOver(0, straight.totalLength) < 1e-3);
  const curved = arcTable(curvedPath());
  assert.ok(curved.maxCurvatureOver(0, curved.totalLength) > 0.02);
});

test('a flat wall with no profile points holds its base height', () => {
  const built = record();
  const profile = createWallTopProfile(built, arcTable(built.path));
  for (let step = 0; step <= 10; step += 1) {
    assert.equal(profile.heightAt(built.top.base * step), 4);
  }
  assert.equal(profile.slopeAt(5), 0);
});

test('monotone interpolation never overshoots its control points', () => {
  const built = curvedPath();
  const segmentId = built.segments[0].id;
  const source = record({
    path: built,
    top: {
      style: 'flat',
      base: 3,
      profile: [
        { segmentId, arcFraction: 0.1, height: 3 },
        { segmentId, arcFraction: 0.4, height: 8 },
        { segmentId, arcFraction: 0.7, height: 3 },
      ],
    },
  });
  const table = arcTable(built);
  const profile = createWallTopProfile(source, table);
  let maximum = 0;
  let minimum = Infinity;
  for (let step = 0; step <= 400; step += 1) {
    const height = profile.heightAt(table.totalLength * (step / 400));
    maximum = Math.max(maximum, height);
    minimum = Math.min(minimum, height);
  }
  // Catmull-Rom would ring above 8 and below 3 either side of the peak.
  assert.ok(maximum <= 8 + 1e-9, `overshot above the peak: ${maximum}`);
  assert.ok(minimum >= 3 - 1e-9, `undershot below the floor: ${minimum}`);
});

test('irregular and ruined tops are deterministic and stay above a footing', () => {
  const built = curvedPath();
  const table = arcTable(built);
  for (const style of ['irregular', 'ruined']) {
    const source = record({ path: built, top: { style, base: 4 } });
    const first = createWallTopProfile(source, table);
    const second = createWallTopProfile(record({ path: built, top: { style, base: 4 } }), table);
    let varied = false;
    for (let step = 0; step <= 100; step += 1) {
      const s = table.totalLength * (step / 100);
      assert.equal(first.heightAt(s), second.heightAt(s));
      assert.ok(first.heightAt(s) >= 0.2);
      if (Math.abs(first.heightAt(s) - 4) > 1e-6) varied = true;
    }
    assert.ok(varied, `${style} tops should not be flat`);
  }
});

test('crenellations only appear for crenellated tops and tile the arc range', () => {
  const built = curvedPath();
  const table = arcTable(built);
  const flat = createWallTopProfile(record({ path: built }), table);
  assert.deepEqual(flat.crenellationsOver(0, table.totalLength), []);

  const source = record({ path: built, top: { style: 'crenellated', base: 4 } });
  const profile = createWallTopProfile(source, table, { style: { merlonSpacing: 1.2 } });
  const merlons = profile.crenellationsOver(0, table.totalLength);
  assert.ok(merlons.length > 5);
  for (let index = 1; index < merlons.length; index += 1) {
    assert.ok(Math.abs((merlons[index].s - merlons[index - 1].s) - 1.2) < 1e-9);
  }
  // Rhythm is phase-locked to absolute arc length, so a module boundary sees
  // the same merlon centres as the whole wall does.
  const slice = profile.crenellationsOver(4, 9);
  for (const merlon of slice) {
    assert.ok(merlons.some((other) => Math.abs(other.s - merlon.s) < 1e-9));
  }
});
