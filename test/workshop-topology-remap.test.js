import assert from 'node:assert/strict';
import test from 'node:test';

import { CurvePath, curvePathMetrics } from '../src/editor/workshop/curves/index.js';
import {
  analyzeFootprintTopology,
  mergePathSegments,
  movePathPoint,
  remapHostedCoordinate,
  splitPathSegment,
  TopologyGraph,
} from '../src/editor/workshop/topology/index.js';

function linePath() {
  return new CurvePath({
    id: 'editable-path',
    points: [
      { id: 'p0', position: [0, 0] },
      { id: 'p1', position: [10, 0] },
    ],
    segments: [{ id: 'wall', kind: 'line', startId: 'p0', endId: 'p1' }],
  });
}

test('control-point edits preserve hosted segment-local coordinates', () => {
  const moved = movePathPoint(linePath(), 'p1', [12, 2]);
  const hosted = remapHostedCoordinate(moved.remap, {
    segmentId: 'wall',
    segmentParameter: 0.75,
    lateral: 0.2,
  });
  assert.deepEqual(hosted, {
    segmentId: 'wall',
    segmentParameter: 0.75,
    lateral: 0.2,
  });
  assert.deepEqual(moved.path.getPoint('p1').position, [12, 2]);
});

test('explicit split ids reject collisions instead of silently renaming', () => {
  assert.throws(() => splitPathSegment(linePath(), 'wall', 0.5, {
    pointId: 'p0',
  }), /already exists/i);
});

test('split emits deterministic remap and hosted coordinates survive', () => {
  const original = linePath();
  const split = splitPathSegment(original, 'wall', 0.4);
  assert.deepEqual(split.segmentIds, ['wall-a', 'wall-b']);
  assert.equal(split.path.segmentCount, 2);
  assert.equal(split.path.pointCount, 3);
  assert.equal(curvePathMetrics(split.path).totalLength, 10);

  const hosted = remapHostedCoordinate(split.remap, {
    segmentId: 'wall',
    segmentParameter: 0.75,
    lateral: 0.2,
  });
  assert.equal(hosted.segmentId, 'wall-b');
  assert.ok(Math.abs(hosted.segmentParameter - 7 / 12) < 1e-12);
  assert.equal(hosted.lateral, 0.2);
});

test('compatible merge restores path shape and remaps hosted coordinates', () => {
  const split = splitPathSegment(linePath(), 'wall', 0.4);
  const merged = mergePathSegments(split.path, 'wall-a', 'wall-b', { mergedSegmentId: 'wall-restored' });
  assert.equal(merged.path.segmentCount, 1);
  assert.equal(merged.path.pointCount, 2);
  assert.equal(curvePathMetrics(merged.path).totalLength, 10);

  const hostedOnRight = remapHostedCoordinate(merged.remap, {
    segmentId: 'wall-b',
    segmentParameter: 7 / 12,
    lateral: 0.2,
  });
  assert.equal(hostedOnRight.segmentId, 'wall-restored');
  assert.ok(Math.abs(hostedOnRight.segmentParameter - 0.75) < 1e-12);
});

test('topology graph and closed footprint invariants are deterministic', () => {
  const rectangle = new CurvePath({
    id: 'footprint',
    closed: true,
    points: [
      { id: 'p0', position: [0, 0] },
      { id: 'p1', position: [4, 0] },
      { id: 'p2', position: [4, 3] },
      { id: 'p3', position: [0, 3] },
    ],
    segments: [
      { id: 's0', kind: 'line', startId: 'p0', endId: 'p1' },
      { id: 's1', kind: 'line', startId: 'p1', endId: 'p2' },
      { id: 's2', kind: 'line', startId: 'p2', endId: 'p3' },
      { id: 's3', kind: 'line', startId: 'p3', endId: 'p0' },
    ],
  });
  const graph = new TopologyGraph(rectangle);
  assert.deepEqual(graph.components(), [['p0', 'p1', 'p2', 'p3']]);
  assert.equal(graph.degree('p0'), 2);
  const footprint = analyzeFootprintTopology(rectangle);
  assert.equal(footprint.simple, true);
  assert.ok(Math.abs(footprint.area - 12) < 1e-9);
});

test('footprint topology reports non-adjacent self intersections', () => {
  const bow = new CurvePath({
    id: 'bow-footprint',
    closed: true,
    points: [
      { id: 'p0', position: [0, 0] },
      { id: 'p1', position: [2, 2] },
      { id: 'p2', position: [0, 2] },
      { id: 'p3', position: [2, 0] },
    ],
    segments: [
      { id: 's0', kind: 'line', startId: 'p0', endId: 'p1' },
      { id: 's1', kind: 'line', startId: 'p1', endId: 'p2' },
      { id: 's2', kind: 'line', startId: 'p2', endId: 'p3' },
      { id: 's3', kind: 'line', startId: 'p3', endId: 'p0' },
    ],
  });
  const result = analyzeFootprintTopology(bow);
  assert.equal(result.simple, false);
  assert.ok(result.selfIntersections.some(({ leftSegmentId, rightSegmentId }) => (
    leftSegmentId === 's0' && rightSegmentId === 's2'
  )));
});

test('arc split and compatible merge preserve length and hosted identity', () => {
  const arc = new CurvePath({
    id: 'arc-edit',
    points: [
      { id: 'p0', position: [2, 0] },
      { id: 'p1', position: [0, 2] },
    ],
    segments: [{ id: 'arc', kind: 'arc', startId: 'p0', endId: 'p1', center: [0, 0] }],
  });
  const originalLength = curvePathMetrics(arc).totalLength;
  const split = splitPathSegment(arc, 'arc', 0.3);
  const hosted = remapHostedCoordinate(split.remap, {
    segmentId: 'arc',
    segmentParameter: 0.8,
    lateral: -0.1,
  });
  assert.equal(hosted.segmentId, 'arc-b');

  const merged = mergePathSegments(split.path, 'arc-a', 'arc-b', { mergedSegmentId: 'arc-restored' });
  assert.ok(Math.abs(curvePathMetrics(merged.path).totalLength - originalLength) < 1e-12);
  const restored = remapHostedCoordinate(merged.remap, hosted);
  assert.equal(restored.segmentId, 'arc-restored');
  assert.ok(Math.abs(restored.segmentParameter - 0.8) < 1e-12);
  assert.equal(restored.lateral, -0.1);
});
