import assert from 'node:assert/strict';
import test from 'node:test';
import {
  coverageWithinSpan,
  findOverlapCandidates,
  intervalOverlap,
} from '../src/editor/construction/masonry/RuinSupportIntervals.js';

test('interval overlap basics', () => {
  assert.equal(intervalOverlap(0, 1, 0.5, 1.5), 0.5);
  assert.equal(intervalOverlap(0, 1, 2, 3), 0);
});

test('full support coverage', () => {
  const coverage = coverageWithinSpan(0, 1, [[0, 1]]);
  assert.equal(coverage.covered, 1);
  assert.equal(coverage.ratio, 1);
  assert.equal(coverage.largestGap, 0);
});

test('two separated supports without double counting overlaps', () => {
  const coverage = coverageWithinSpan(0, 2, [[0, 0.4], [0.2, 0.5], [1.5, 2]]);
  assert.ok(Math.abs(coverage.covered - 1.0) < 1e-9);
  assert.ok(coverage.largestGap > 0.9);
});

test('excessive overhangs and centre gap', () => {
  const coverage = coverageWithinSpan(0, 2, [[0, 0.2], [1.8, 2]]);
  assert.ok(coverage.leftOverhang < 1e-9);
  assert.ok(coverage.rightOverhang < 1e-9);
  assert.ok(coverage.largestGap > 1.5);
});

function support(id, start, end) {
  return { id, support: { span: [start, end] } };
}

test('support lookup keeps every earlier interval that reaches the target', () => {
  const candidates = [
    support('long', 0, 10),
    support('short', 4, 6),
    support('after', 9, 11),
  ];
  assert.deepEqual(
    findOverlapCandidates(candidates, 5, 5.5).map(({ id }) => id),
    ['long', 'short'],
  );
});

test('support lookup remains correct for a course-major unsorted pool', () => {
  const candidates = [
    support('course-one-right', 4, 6),
    support('course-one-left', 0, 2),
    support('course-two', 1, 5),
  ];
  assert.deepEqual(
    findOverlapCandidates(candidates, 1.5, 1.8).map(({ id }) => id),
    ['course-one-left', 'course-two'],
  );
});
