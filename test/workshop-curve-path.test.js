import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CurvePath,
  curvePathMetrics,
  evaluateCurvePathAtDistance,
  evaluateCurveSegment,
  serializeCurvePath,
} from '../src/editor/workshop/curves/index.js';

function linePath() {
  return {
    id: 'line-path',
    points: [
      { id: 'p1', position: [10, 0] },
      { id: 'p0', position: [0, 0] },
    ],
    segments: [{ id: 's0', kind: 'line', startId: 'p0', endId: 'p1' }],
  };
}

test('curve path serializes deterministically and uses stable ids', () => {
  const first = serializeCurvePath(linePath());
  const second = serializeCurvePath(JSON.parse(JSON.stringify(linePath())));
  assert.deepEqual(first, second);
  assert.deepEqual(first.points.map(({ id }) => id), ['p0', 'p1']);
  assert.deepEqual(first.segments.map(({ id }) => id), ['s0']);
});

test('line, arc, and quadratic segments evaluate with finite deterministic arc lengths', () => {
  const line = new CurvePath(linePath());
  assert.equal(curvePathMetrics(line).totalLength, 10);
  assert.deepEqual(evaluateCurvePathAtDistance(line, 4).point, [4, 0]);

  const arc = new CurvePath({
    id: 'arc-path',
    points: [
      { id: 'p0', position: [2, 0] },
      { id: 'p1', position: [0, 2] },
    ],
    segments: [{ id: 'arc', kind: 'arc', startId: 'p0', endId: 'p1', center: [0, 0] }],
  });
  assert.ok(Math.abs(curvePathMetrics(arc).totalLength - Math.PI) < 1e-12);
  const arcMid = evaluateCurvePathAtDistance(arc, Math.PI / 2).point;
  assert.ok(Math.abs(arcMid[0] - Math.SQRT2) < 1e-12);
  assert.ok(Math.abs(arcMid[1] - Math.SQRT2) < 1e-12);

  const quadratic = new CurvePath({
    id: 'bezier-path',
    points: [
      { id: 'p0', position: [0, 0] },
      { id: 'p1', position: [2, 0] },
    ],
    segments: [{
      id: 'curve',
      kind: 'quadratic',
      startId: 'p0',
      endId: 'p1',
      control: [1, 1],
    }],
  });
  const length = curvePathMetrics(quadratic).totalLength;
  assert.ok(length > 2 && length < 3);
  const middle = evaluateCurveSegment(quadratic.getSegment('curve'), 0.5);
  assert.deepEqual(middle.point, [1, 0.5]);
  assert.ok(middle.tangent.every(Number.isFinite));
});

test('committed degenerates are rejected while preview degenerates remain finite', () => {
  const input = {
    id: 'preview-path',
    points: [
      { id: 'p0', position: [1, 1] },
      { id: 'p1', position: [1, 1] },
    ],
    segments: [{ id: 's0', kind: 'line', startId: 'p0', endId: 'p1' }],
  };
  assert.throws(() => new CurvePath(input), /committed length tolerance/i);
  const preview = new CurvePath(input, { preview: true });
  const evaluated = evaluateCurveSegment(preview.getSegment('s0'), 0.73);
  assert.deepEqual(evaluated.point, [1, 1]);
  assert.ok(evaluated.tangent.every(Number.isFinite));
});
