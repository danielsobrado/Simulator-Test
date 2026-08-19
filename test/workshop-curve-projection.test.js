import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CurvePath,
  intersectCurveSegments,
  pathCoordinateToPoint,
  pointToPathCoordinate,
  projectPointToCurvePath,
} from '../src/editor/workshop/curves/index.js';

function horizontalPath() {
  return new CurvePath({
    id: 'horizontal',
    points: [
      { id: 'p0', position: [0, 0] },
      { id: 'p1', position: [10, 0] },
    ],
    segments: [{ id: 's0', kind: 'line', startId: 'p0', endId: 'p1' }],
  });
}

test('repeated path projection and local-surface coordinates are stable', () => {
  const path = horizontalPath();
  const first = projectPointToCurvePath(path, [4, 3]);
  const second = projectPointToCurvePath(path, [4, 3]);
  assert.deepEqual(first, second);
  assert.equal(first.segmentId, 's0');
  assert.equal(first.parameter, 0.4);
  assert.deepEqual(first.point, [4, 0]);

  const local = pointToPathCoordinate(path, [4, 3]);
  assert.equal(local.lateral, 3);
  assert.deepEqual(pathCoordinateToPoint(path, local), [4, 3]);
});

test('line-line, line-arc, and arc-arc intersections are deterministic', () => {
  const horizontal = new CurvePath({
    id: 'line-a',
    points: [
      { id: 'a0', position: [-2, 0] },
      { id: 'a1', position: [2, 0] },
    ],
    segments: [{ id: 'a', kind: 'line', startId: 'a0', endId: 'a1' }],
  }).getSegment('a');
  const vertical = new CurvePath({
    id: 'line-b',
    points: [
      { id: 'b0', position: [0, -2] },
      { id: 'b1', position: [0, 2] },
    ],
    segments: [{ id: 'b', kind: 'line', startId: 'b0', endId: 'b1' }],
  }).getSegment('b');
  assert.deepEqual(intersectCurveSegments(horizontal, vertical)[0].point, [0, 0]);

  const overlapping = new CurvePath({
    id: 'line-overlap',
    points: [
      { id: 'c0', position: [-1, 0] },
      { id: 'c1', position: [1, 0] },
    ],
    segments: [{ id: 'c', kind: 'line', startId: 'c0', endId: 'c1' }],
  }).getSegment('c');
  const overlap = intersectCurveSegments(horizontal, overlapping);
  assert.equal(overlap.length, 2);
  assert.deepEqual(overlap.map(({ point }) => point), [[-1, 0], [1, 0]]);

  const upperArc = new CurvePath({
    id: 'arc-a',
    points: [
      { id: 'p0', position: [1, 0] },
      { id: 'p1', position: [-1, 0] },
    ],
    segments: [{ id: 'arc', kind: 'arc', startId: 'p0', endId: 'p1', center: [0, 0] }],
  }).getSegment('arc');
  const lineArc = intersectCurveSegments(vertical, upperArc);
  assert.equal(lineArc.length, 1);
  assert.ok(Math.abs(lineArc[0].point[0]) < 1e-12);
  assert.ok(Math.abs(lineArc[0].point[1] - 1) < 1e-12);

  const rightArc = new CurvePath({
    id: 'arc-b',
    points: [
      { id: 'q0', position: [1, -1] },
      { id: 'q1', position: [1, 1] },
    ],
    segments: [{ id: 'other', kind: 'arc', startId: 'q0', endId: 'q1', center: [1, 0] }],
  }).getSegment('other');
  const arcArc = intersectCurveSegments(upperArc, rightArc);
  assert.ok(arcArc.every(({ point }) => point.every(Number.isFinite)));
});
