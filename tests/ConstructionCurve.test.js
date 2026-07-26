import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closestPointOnCubicBezierPath,
  createCubicBezierPathFromStroke,
  cubicBezierPathBounds,
  evaluateCubicBezier,
  findCubicBezierSelfIntersections,
  moveCubicBezierAnchor,
  sampleCubicBezierPath,
} from '../src/editor/construction/curve/CubicBezierPath.js';

test('cubic Bézier evaluation and adaptive sampling preserve endpoints', () => {
  const path = createCubicBezierPathFromStroke([
    { x: 0, z: 0 },
    { x: 4, z: 3 },
    { x: 8, z: 0 },
  ], { simplifyTolerance: 0.01 });
  const segment = path.segments[0];
  const start = path.anchors.find(({ id }) => id === segment.startAnchorId);
  const end = path.anchors.find(({ id }) => id === segment.endAnchorId);
  const controls = [
    { x: start.position[0], z: start.position[1] },
    {
      x: start.position[0] + segment.startHandle[0],
      z: start.position[1] + segment.startHandle[1],
    },
    {
      x: end.position[0] + segment.endHandle[0],
      z: end.position[1] + segment.endHandle[1],
    },
    { x: end.position[0], z: end.position[1] },
  ];
  assert.deepEqual(evaluateCubicBezier(controls, 0), { x: 0, z: 0 });
  assert.deepEqual(evaluateCubicBezier(controls, 1), { x: 4, z: 3 });

  const sampled = sampleCubicBezierPath(path);
  assert.ok(sampled.points.length > path.anchors.length);
  assert.equal(sampled.points[0].x, 0);
  assert.equal(sampled.points[0].z, 0);
  assert.equal(sampled.points.at(-1).x, 8);
  assert.equal(sampled.points.at(-1).z, 0);
  assert.ok(sampled.totalDistance > 8);
  for (let index = 1; index < sampled.points.length; index += 1) {
    assert.ok(sampled.points[index].distance >= sampled.points[index - 1].distance);
    assert.ok(Math.abs(Math.hypot(
      sampled.points[index].tangentX,
      sampled.points[index].tangentZ,
    ) - 1) < 1e-9);
  }
});

test('stroke fitting and sampling are deterministic', () => {
  const stroke = Array.from({ length: 20 }, (_, index) => ({
    x: index * 0.5,
    z: Math.sin(index * 0.35) * 2,
  }));
  const first = createCubicBezierPathFromStroke(stroke);
  const second = createCubicBezierPathFromStroke(stroke);
  assert.deepEqual(first, second);
  assert.deepEqual(sampleCubicBezierPath(first), sampleCubicBezierPath(second));
});

test('anchor movement is local and keeps segment identities', () => {
  const path = createCubicBezierPathFromStroke([
    [0, 0],
    [4, 2],
    [8, 0],
  ], { simplifyTolerance: 0.01 });
  const moved = moveCubicBezierAnchor(path, path.anchors[1].id, { x: 4, z: 4 });
  assert.deepEqual(
    moved.segments.map(({ id }) => id),
    path.segments.map(({ id }) => id),
  );
  assert.deepEqual(moved.anchors[0], path.anchors[0]);
  assert.deepEqual(moved.anchors[1].position, [4, 4]);
});

test('bounds and closest-point queries cover the fitted curve', () => {
  const path = createCubicBezierPathFromStroke([
    [10, -3],
    [14, 4],
    [18, -3],
  ], { simplifyTolerance: 0.01 });
  const bounds = cubicBezierPathBounds(path);
  assert.equal(bounds.minX, 10);
  assert.equal(bounds.maxX, 18);
  assert.ok(bounds.maxZ > 3);
  const closest = closestPointOnCubicBezierPath(path, { x: 14, z: 4.2 });
  assert.ok(closest.distance < 0.3);
  assert.equal(closest.segmentId, path.segments[0].id);
});

test('self intersections are reported without treating neighboring joins as crossings', () => {
  const simple = createCubicBezierPathFromStroke([
    [0, 0],
    [3, 2],
    [6, 0],
  ], { simplifyTolerance: 0.01 });
  assert.deepEqual(findCubicBezierSelfIntersections(simple), []);

  const crossing = createCubicBezierPathFromStroke([
    [0, 0],
    [4, 4],
    [0, 4],
    [4, 0],
  ], { simplifyTolerance: 0.01 });
  assert.ok(findCubicBezierSelfIntersections(crossing).length >= 1);
});

