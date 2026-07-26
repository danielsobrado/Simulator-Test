import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStraightSkeleton } from '../src/editor/workshop/ProceduralStraightSkeleton.js';

function highestDistance(skeleton) {
  return Math.max(...skeleton.faces.flatMap(
    ({ vertices }) => vertices.map(({ distance }) => distance),
  ));
}

test('square skeleton has four faces, a central apex, and exact projected coverage', () => {
  const skeleton = buildStraightSkeleton([[0, 0], [4, 0], [4, 4], [0, 4]]);
  assert.equal(skeleton.faces.length, 4);
  assert.equal(highestDistance(skeleton), 2);
  assert.ok(Math.abs(skeleton.projectedFaceArea - skeleton.footprintArea) < 1e-9);
  assert.ok(skeleton.faces.some(({ vertices }) => (
    vertices.some(({ point, distance }) => point[0] === 2 && point[1] === 2 && distance === 2)
  )));
});

test('long rectangle skeleton produces a ridge of length long minus short', () => {
  const skeleton = buildStraightSkeleton([[0, 0], [6, 0], [6, 2], [0, 2]]);
  const ridge = new Set(skeleton.faces.flatMap(({ vertices }) => vertices
    .filter(({ distance }) => Math.abs(distance - 1) < 1e-9)
    .map(({ point }) => point.join(':'))));
  assert.deepEqual([...ridge].sort(), ['1:1', '5:1']);
});

test('L, T, and plus footprints cover their plan without gaps or overlaps', () => {
  const footprints = [
    [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]],
    [[0, 0], [6, 0], [6, 2], [4, 2], [4, 6], [2, 6], [2, 2], [0, 2]],
    [[2, 0], [4, 0], [4, 2], [6, 2], [6, 4], [4, 4],
      [4, 6], [2, 6], [2, 4], [0, 4], [0, 2], [2, 2]],
  ];
  for (const footprint of footprints) {
    const skeleton = buildStraightSkeleton(footprint);
    assert.ok(Math.abs(skeleton.projectedFaceArea - skeleton.footprintArea) < 1e-6);
    assert.equal(skeleton.faces.length, footprint.length);
  }
});

test('skeleton output is invariant to cyclic rotation and redundant collinear vertices', () => {
  const base = [[0, 0], [6, 0], [6, 2], [2, 2], [2, 6], [0, 6]];
  const rotated = [...base.slice(3), ...base.slice(0, 3)];
  const collinear = [[0, 0], [3, 0], ...base.slice(1)];
  assert.deepEqual(buildStraightSkeleton(rotated), buildStraightSkeleton(base));
  assert.deepEqual(buildStraightSkeleton(collinear), buildStraightSkeleton(base));
});

test('malformed polygons fail instead of entering the skeleton engine', () => {
  assert.throws(
    () => buildStraightSkeleton([[0, 0], [1, 0], [2, 0]]),
    /non-collinear/,
  );
});
