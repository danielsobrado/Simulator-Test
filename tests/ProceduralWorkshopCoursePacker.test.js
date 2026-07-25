import assert from 'node:assert/strict';
import test from 'node:test';
import { packCourse } from '../src/editor/workshop/ProceduralWorkshopCoursePacker.js';
import { createRandom, mixSeed } from '../src/editor/workshop/ProceduralRandom.js';

function stream(seed = 1848) {
  return createRandom(mixSeed(seed, 7));
}

const TARGET = 0.78;
const MIN = 0.28;

test('a packed course fills its span exactly, with no clipped stones', () => {
  for (const span of [1, 2.5, 4, 7.3, 8, 12, 16]) {
    const { stones } = packCourse({
      span, targetWidth: TARGET, minWidth: MIN, random: stream(),
    });
    const covered = stones.reduce((sum, stone) => sum + stone.width, 0);
    assert.ok(
      Math.abs(covered - span) < 1e-9,
      `span ${span} covered ${covered}`,
    );
    // Contiguous, in order, inside the interval.
    let cursor = -span / 2;
    for (const stone of stones) {
      assert.ok(Math.abs((stone.center - stone.width / 2) - cursor) < 1e-9);
      cursor += stone.width;
    }
    assert.ok(Math.abs(cursor - span / 2) < 1e-9);
  }
});

test('no stone is emitted below the style minimum', () => {
  // §6.8: slivers are dissolved into a neighbour rather than emitted.
  for (let seed = 0; seed < 60; seed += 1) {
    for (const span of [0.9, 1.4, 2.2, 3.7, 9.1]) {
      const { stones } = packCourse({
        span, targetWidth: TARGET, minWidth: MIN, random: stream(seed),
      });
      for (const stone of stones) {
        assert.ok(
          stone.width >= Math.min(span, MIN) - 1e-9,
          `span ${span} seed ${seed} emitted a ${stone.width} sliver`,
        );
      }
    }
  }
});

test('widths stay inside the style range for an ordinary span', () => {
  const { stones } = packCourse({
    span: 12, targetWidth: TARGET, minWidth: MIN, random: stream(),
  });
  for (const stone of stones) {
    // Merging can produce a wider stone, but nothing should be absurd.
    assert.ok(stone.width <= TARGET * 3, `stone ${stone.width} is too wide`);
  }
  const average = stones.reduce((sum, s) => sum + s.width, 0) / stones.length;
  assert.ok(Math.abs(average - TARGET) < TARGET * 0.35, `average width ${average}`);
});

test('joints break bond against the course below', () => {
  const span = 12;
  const first = packCourse({
    span, targetWidth: TARGET, minWidth: MIN, random: stream(1),
  });
  const second = packCourse({
    span,
    targetWidth: TARGET,
    minWidth: MIN,
    random: stream(2),
    forbiddenJoints: first.joints,
  });
  assert.ok(first.joints.length > 4);
  assert.ok(second.joints.length > 4);

  const band = TARGET * 0.25;
  let aligned = 0;
  for (const joint of second.joints) {
    if (first.joints.some((other) => Math.abs(joint - other) < band)) aligned += 1;
  }
  assert.equal(aligned, 0, `${aligned} joints stacked on the course below`);
});

test('an unstaggered pair of courses would stack joints', () => {
  // Guards the test above from passing trivially: without the forbidden-joint
  // input, some joints do land within a band of each other.
  const span = 12;
  let everStacked = false;
  for (let seed = 0; seed < 40 && !everStacked; seed += 1) {
    const a = packCourse({
      span, targetWidth: TARGET, minWidth: MIN, random: stream(seed),
    });
    const b = packCourse({
      span, targetWidth: TARGET, minWidth: MIN, random: stream(seed + 500),
    });
    const band = TARGET * 0.25;
    everStacked = b.joints.some(
      (joint) => a.joints.some((other) => Math.abs(joint - other) < band),
    );
  }
  assert.ok(everStacked, 'expected unstaggered courses to stack at least once');
});

test('packing is deterministic and terminates on degenerate spans', () => {
  const a = packCourse({ span: 5, targetWidth: TARGET, minWidth: MIN, random: stream() });
  const b = packCourse({ span: 5, targetWidth: TARGET, minWidth: MIN, random: stream() });
  assert.deepEqual(a, b);

  // Spans at or below the minimum collapse to a single stone rather than looping.
  for (const span of [0.05, MIN, MIN * 1.01]) {
    const { stones } = packCourse({
      span, targetWidth: TARGET, minWidth: MIN, random: stream(),
    });
    assert.equal(stones.length, 1);
    assert.ok(Math.abs(stones[0].width - span) < 1e-9);
  }
});
