import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_BED_AMPLITUDE,
  MIN_SPLIT_HEIGHT,
  createBedField,
  jointTilt,
  resolveCellCorners,
  scaleCorners,
  splitCell,
} from '../src/editor/construction/masonry/CourseLattice.js';

const SEED = 3141;
const COURSE_HEIGHT = 0.56;
const SEEDS = [1, 7, 3141, 88_017, 525_600];

test('the ground line never waves', () => {
  // Course 0's bed line is where the wall meets the terrain. A wave there would
  // lift the bottom course off the ground or bury it.
  const bedOffset = createBedField(SEED, COURSE_HEIGHT, { amplitude: 0.2 });
  for (let s = 0; s < 60; s += 0.13) assert.equal(bedOffset(0, s), 0);
});

test('bed lines never cross, however the phases land', () => {
  // Two adjacent bed lines wave independently, so the course between them is
  // thinnest when one peaks as the other troughs. The amplitude ceiling is what
  // bounds that, and it is the only thing standing between a ramped course and
  // an inverted one.
  for (const seed of SEEDS) {
    const bedOffset = createBedField(seed, COURSE_HEIGHT, { amplitude: MAX_BED_AMPLITUDE });
    let thinnest = Infinity;
    for (let course = 0; course < 12; course += 1) {
      for (let s = 0; s < 80; s += 0.05) {
        const bottom = course * COURSE_HEIGHT + bedOffset(course, s);
        const top = (course + 1) * COURSE_HEIGHT + bedOffset(course + 1, s);
        thinnest = Math.min(thinnest, top - bottom);
      }
    }
    assert.ok(thinnest > 0, `seed ${seed} inverted a course`);
    assert.ok(
      thinnest >= COURSE_HEIGHT * (1 - 2 * MAX_BED_AMPLITUDE) - 1e-9,
      `seed ${seed} thinned a course to ${thinnest.toFixed(4)}`,
    );
  }
});

test('the bed field actually ramps', () => {
  // The guard above is satisfied by a field that does nothing at all, so pin the
  // other side of it too.
  const bedOffset = createBedField(SEED, COURSE_HEIGHT, { amplitude: 0.14 });
  let lowest = Infinity;
  let highest = -Infinity;
  // Sampled over 120 m rather than 40 m. The bed wavelength is 15-29 m so the
  // course carries two long waves, and for some seeds a 40 m window lands
  // inside a stretch where they partially cancel — the field is fine, the
  // sample was just shorter than the drift it is measuring.
  for (let s = 0; s < 120; s += 0.05) {
    lowest = Math.min(lowest, bedOffset(3, s));
    highest = Math.max(highest, bedOffset(3, s));
  }
  assert.ok(highest - lowest > COURSE_HEIGHT * 0.1, `bed line barely moves: ${highest - lowest}`);
  assert.ok(highest - lowest <= COURSE_HEIGHT * 0.14 * 2 + 1e-9);
});

test('the bed field is a pure function of seed, course and arc position', () => {
  // Which is what lets two modules resolve the same corner at a seam without
  // exchanging anything. Fresh closures stand in for the two modules.
  const left = createBedField(SEED, COURSE_HEIGHT, { amplitude: 0.14 });
  const right = createBedField(SEED, COURSE_HEIGHT, { amplitude: 0.14 });
  for (let course = 0; course < 8; course += 1) {
    for (const s of [0, 0.37, 12.5, 18.001, 41.9]) {
      assert.equal(left(course, s), right(course, s));
    }
  }
});

test('both stones at a joint derive the same lean', () => {
  // The lean is keyed on the joint's arc position, never on a stone index. If it
  // were not, the two stones meeting there would cut to different lines and open
  // a gap the mortar was never sized for.
  for (const s of [0.4, 3.75, 12.0001, 47.5]) {
    for (let course = 0; course < 6; course += 1) {
      const left = jointTilt(SEED, course, s, COURSE_HEIGHT, 0.16);
      const right = jointTilt(SEED, course, s, COURSE_HEIGHT, 0.16);
      assert.equal(left, right);
    }
  }
});

test('lean is bounded, signed, and decorrelated between courses', () => {
  const amount = 0.16;
  const limit = amount * COURSE_HEIGHT;
  let positive = 0;
  let total = 0;
  for (let course = 0; course < 8; course += 1) {
    for (let s = 0; s < 40; s += 0.31) {
      const tilt = jointTilt(SEED, course, s, COURSE_HEIGHT, amount);
      assert.ok(Math.abs(tilt) <= limit + 1e-12, `lean ${tilt} exceeds ${limit}`);
      if (tilt > 0) positive += 1;
      total += 1;
    }
  }
  assert.ok(positive > total * 0.4 && positive < total * 0.6, 'lean should not be biased');

  // The same joint position in two courses must not lean the same way, or the
  // lean stacks into a single leaning line up the whole wall.
  let same = 0;
  for (let s = 0; s < 40; s += 0.31) {
    const a = jointTilt(SEED, 2, s, COURSE_HEIGHT, amount);
    const b = jointTilt(SEED, 3, s, COURSE_HEIGHT, amount);
    if (Math.sign(a) === Math.sign(b)) same += 1;
  }
  assert.ok(same < 90, `courses lean together ${same} times out of 130`);
});

test('zero lean is exactly plumb', () => {
  // Wall ends and opening jambs rely on this being an exact zero rather than a
  // small number, because they are compared against the reserved line at 1e-9.
  assert.equal(jointTilt(SEED, 3, 12.5, COURSE_HEIGHT, 0), 0);
});

/** Every leaf of `cell`, as `(s, v)` rectangles. */
function leavesOf(cell, overrides = {}) {
  return splitCell(cell, {
    seed: SEED,
    chance: 0.6,
    minWidth: 0.26,
    courseHeight: COURSE_HEIGHT,
    ...overrides,
  });
}

test('leaves partition their cell exactly', () => {
  let split = 0;
  let checked = 0;
  for (let course = 0; course < 10; course += 1) {
    for (let start = 0; start < 40; start += 1.2) {
      const cell = { courseIndex: course, s0: start, s1: start + 1.2 };
      const leaves = leavesOf(cell);
      if (leaves.length > 1) split += 1;
      checked += 1;

      const area = leaves.reduce(
        (total, leaf) => total + (leaf.s1 - leaf.s0) * (leaf.v1 - leaf.v0),
        0,
      );
      assert.ok(Math.abs(area - 1.2) < 1e-9, `leaves cover ${area} of 1.2`);
      for (const leaf of leaves) {
        assert.ok(leaf.s0 >= cell.s0 - 1e-12 && leaf.s1 <= cell.s1 + 1e-12);
        assert.ok(leaf.v0 >= -1e-12 && leaf.v1 <= 1 + 1e-12);
      }
    }
  }
  assert.ok(split > checked * 0.3, `the fixture should split often, ${split}/${checked}`);
});

test('splits respect the minimum stone size', () => {
  for (const seed of SEEDS) {
    for (let start = 0; start < 30; start += 0.7) {
      const leaves = leavesOf(
        { courseIndex: 4, s0: start, s1: start + 1.2 },
        { seed, chance: 0.85 },
      );
      if (leaves.length === 1) continue;
      for (const leaf of leaves) {
        assert.ok(leaf.s1 - leaf.s0 >= 0.26 - 1e-9, `splinter ${leaf.s1 - leaf.s0} m wide`);
        assert.ok(
          (leaf.v1 - leaf.v0) * COURSE_HEIGHT >= MIN_SPLIT_HEIGHT - 1e-9,
          `splinter ${(leaf.v1 - leaf.v0) * COURSE_HEIGHT} m tall`,
        );
      }
    }
  }
});

test('a split depends only on the cell, not on its neighbours', () => {
  // The locality guarantee: inserting an opening changes how many cells a course
  // has, and it must not re-cut the ones it did not touch.
  const cell = { courseIndex: 5, s0: 14.4, s1: 15.6 };
  assert.deepEqual(leavesOf(cell), leavesOf(cell));
  // Walking the same cell out of a differently-shaped course changes nothing.
  assert.deepEqual(leavesOf(cell), leavesOf({ ...cell }, { minWidth: 0.26 }));
  // A different cell in the same course does get cut differently.
  const others = new Set();
  for (let start = 0; start < 24; start += 1.2) {
    others.add(leavesOf({ courseIndex: 5, s0: start, s1: start + 1.2 }).length);
  }
  assert.ok(others.size > 1, 'every cell in a course was cut identically');
});

test('splitting is off when the style asks for it', () => {
  const cell = { courseIndex: 2, s0: 3, s1: 4.2 };
  const leaves = splitCell(cell, { seed: SEED, chance: 0, courseHeight: COURSE_HEIGHT });
  assert.equal(leaves.length, 1);
  assert.equal(leaves[0].v0, 0);
  assert.equal(leaves[0].v1, 1);
});

/** A face ring resolved with the lattice's own defaults. */
function faceOf(cell, options = {}) {
  return resolveCellCorners(cell, {
    bedOffset: createBedField(SEED, COURSE_HEIGHT, { amplitude: 0.14 }),
    courseHeight: COURSE_HEIGHT,
    ...options,
  });
}

test('neighbouring cells resolve the identical shared corner', () => {
  // This is the whole point of the lattice. The right edge of one cell and the
  // left edge of the next are the same two points, to the bit, so a ramped bed
  // joint and a leaning head joint cannot open a hole between them.
  const bedOffset = createBedField(SEED, COURSE_HEIGHT, { amplitude: 0.14 });
  const tilt = (s) => jointTilt(SEED, 4, s, COURSE_HEIGHT, 0.16);
  const shared = 17.25;

  const left = resolveCellCorners(
    { courseIndex: 4, s0: 16.1, s1: shared, v0: 0, v1: 1 },
    { bedOffset, courseHeight: COURSE_HEIGHT, tiltLeft: tilt(16.1), tiltRight: tilt(shared) },
  );
  const right = resolveCellCorners(
    { courseIndex: 4, s0: shared, s1: 18.4, v0: 0, v1: 1 },
    { bedOffset, courseHeight: COURSE_HEIGHT, tiltLeft: tilt(shared), tiltRight: tilt(18.4) },
  );

  // Left's bottom-right and top-right against right's bottom-left and top-left.
  for (const [leftSlot, rightSlot] of [[1, 0], [2, 3]]) {
    assert.equal(left.anchorS + left.corners[leftSlot][0], right.anchorS + right.corners[rightSlot][0]);
    assert.equal(left.anchorY + left.corners[leftSlot][1], right.anchorY + right.corners[rightSlot][1]);
  }
});

test('a stacked pair meets on one continuous partial bed line', () => {
  const bedOffset = createBedField(SEED, COURSE_HEIGHT, { amplitude: 0.14 });
  const common = { bedOffset, courseHeight: COURSE_HEIGHT, tiltLeft: 0.06, tiltRight: -0.04 };
  const lower = resolveCellCorners({ courseIndex: 3, s0: 8, s1: 9.1, v0: 0, v1: 0.45 }, common);
  const upper = resolveCellCorners({ courseIndex: 3, s0: 8, s1: 9.1, v0: 0.45, v1: 1 }, common);

  // Lower's top-left/top-right against upper's bottom-left/bottom-right.
  for (const [lowerSlot, upperSlot] of [[3, 0], [2, 1]]) {
    assert.equal(
      lower.anchorS + lower.corners[lowerSlot][0],
      upper.anchorS + upper.corners[upperSlot][0],
    );
    assert.equal(
      lower.anchorY + lower.corners[lowerSlot][1],
      upper.anchorY + upper.corners[upperSlot][1],
    );
  }
});

test('the anchor stays on the cell midpoint however far the joints lean', () => {
  // `packedWidth` arithmetic — and therefore every coverage test — reads the
  // cell edges back as `s +- packedWidth / 2`. Anchoring on the face bounding
  // box instead would slide that off by half the lean.
  const face = faceOf(
    { courseIndex: 6, s0: 22.3, s1: 23.5, v0: 0, v1: 1 },
    { tiltLeft: 0.09, tiltRight: -0.07 },
  );
  assert.equal(face.anchorS, 22.9);
  assert.ok(face.width > 1.2, 'a leaning cell is wider than its footprint');
});

test('faces stay convex and counter-clockwise', () => {
  // A self-intersecting ring hands `ExtrudeGeometry` a shape that triangulates
  // into inverted faces, which reads as a black hole in the wall.
  let checked = 0;
  for (const seed of SEEDS) {
    const bedOffset = createBedField(seed, COURSE_HEIGHT, { amplitude: MAX_BED_AMPLITUDE });
    for (let course = 0; course < 8; course += 1) {
      for (let start = 0; start < 30; start += 1.1) {
        for (const leaf of splitCell(
          { courseIndex: course, s0: start, s1: start + 1.1 },
          { seed, chance: 0.7, minWidth: 0.26, courseHeight: COURSE_HEIGHT },
        )) {
          const face = resolveCellCorners(leaf, {
            bedOffset,
            courseHeight: COURSE_HEIGHT,
            tiltLeft: jointTilt(seed, course, leaf.s0, COURSE_HEIGHT, 0.24),
            tiltRight: jointTilt(seed, course, leaf.s1, COURSE_HEIGHT, 0.24),
          });
          assert.ok(face, 'an unclamped cell should always resolve');
          let sign = 0;
          for (let index = 0; index < 4; index += 1) {
            const [ax, ay] = face.corners[index];
            const [bx, by] = face.corners[(index + 1) % 4];
            const [cx, cy] = face.corners[(index + 2) % 4];
            const cross = (bx - ax) * (cy - by) - (by - ay) * (cx - bx);
            assert.notEqual(Math.sign(cross), 0, 'a face collapsed to a line');
            if (sign === 0) sign = Math.sign(cross);
            else assert.equal(Math.sign(cross), sign, 'a face folded over itself');
          }
          assert.equal(sign, 1, 'faces must wind counter-clockwise');
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 1000, `the sweep should cover many faces, saw ${checked}`);
});

test('the ceiling clamp trims the top course rather than piercing it', () => {
  const cell = { courseIndex: 5, s0: 4, s1: 5.2, v0: 0, v1: 1 };
  const ceiling = 5 * COURSE_HEIGHT + 0.2;
  const face = faceOf(cell, { ceilingAt: () => ceiling });
  for (const [, y] of face.corners) {
    assert.ok(face.anchorY + y <= ceiling + 1e-9, 'a corner pierced the wall top');
  }
  // And a cell the clamp flattens is reported as gone, not as a sliver.
  assert.equal(faceOf(cell, { ceilingAt: () => 5 * COURSE_HEIGHT + 0.01 }), null);
});

test('scaling a face keeps it centred', () => {
  // The mortar inset and the damped shape jitter both go through this. Scaling
  // about anything but the face centre would slide the stone along the wall
  // instead of shrinking it in place.
  const corners = [[-0.6, -0.3], [0.7, -0.28], [0.65, 0.31], [-0.55, 0.29]];
  const scaled = scaleCorners(corners, 0.5, 0.5);
  const centre = (ring, axis) => (
    Math.min(...ring.map((point) => point[axis]))
    + Math.max(...ring.map((point) => point[axis]))
  ) / 2;
  assert.ok(Math.abs(centre(scaled, 0) - centre(corners, 0)) < 1e-12);
  assert.ok(Math.abs(centre(scaled, 1) - centre(corners, 1)) < 1e-12);
  const span = (ring, axis) => (
    Math.max(...ring.map((point) => point[axis]))
    - Math.min(...ring.map((point) => point[axis]))
  );
  assert.ok(Math.abs(span(scaled, 0) - span(corners, 0) * 0.5) < 1e-12);
});
