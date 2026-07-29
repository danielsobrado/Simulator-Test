import assert from 'node:assert/strict';
import test from 'node:test';
import {
  closeCubicBezierPath,
  controlPointsForSegment,
  createCubicBezierPathFromStroke,
  cubicBezierDirtySegments,
  evaluateCubicBezier,
  deleteCubicBezierAnchor,
  findCubicBezierSelfIntersections,
  insertCubicBezierAnchor,
  intersectCubicBezierPaths,
  moveCubicBezierAnchor,
  openCubicBezierPath,
  sampleCubicBezierPath,
  setCubicBezierHandle,
} from '../src/editor/construction/curve/CubicBezierPath.js';
import {
  flattenHandlesAround,
  resolveAnchorSnap,
} from '../src/editor/construction/curve/CurveSnapping.js';

function wavyPath() {
  return createCubicBezierPathFromStroke([
    [0, 0], [6, 4], [13, -2], [20, 3], [27, -1], [34, 2],
  ], { simplifyTolerance: 0.01 });
}

function circlePath(radius = 6, steps = 10) {
  const points = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return createCubicBezierPathFromStroke(points, { simplifyTolerance: 0.01, closed: true });
}

function sampledPoints(path) {
  return sampleCubicBezierPath(path, { chordError: 0.005, maxSpacing: 0.2 }).points;
}

/**
 * Largest distance from any point of `a` to the polyline of `b`.
 *
 * Distance to the nearest *sample point* would measure half the sample spacing
 * rather than any real difference between the curves, so it reports ~0.1 for
 * two identical curves sampled at different densities.
 */
function maxDeviation(a, b) {
  let worst = 0;
  for (const point of a) {
    let best = Infinity;
    for (let index = 0; index < b.length - 1; index += 1) {
      const p = b[index];
      const q = b[index + 1];
      const dx = q.x - p.x;
      const dz = q.z - p.z;
      const lengthSquared = dx * dx + dz * dz;
      const t = lengthSquared > 0
        ? Math.max(0, Math.min(1, ((point.x - p.x) * dx + (point.z - p.z) * dz) / lengthSquared))
        : 0;
      best = Math.min(best, Math.hypot(point.x - (p.x + dx * t), point.z - (p.z + dz * t)));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

test('moving an anchor re-solves its handles instead of dragging stale ones', () => {
  const path = wavyPath();
  const anchorId = path.anchors[2].id;
  const moved = moveCubicBezierAnchor(path, anchorId, { x: 13, z: 9 });
  const preserved = moveCubicBezierAnchor(path, anchorId, { x: 13, z: 9 }, {
    resolveHandles: 'preserve',
  });

  assert.deepEqual(moved.anchors[2].position, [13, 9]);
  // Moving anchor i changes segment i-1's end handle and segment i's start
  // handle (and the same one segment further out). `segments[1].endHandle`
  // reads anchors 1 and 3, so it legitimately does *not* move — picking it
  // would test nothing.
  assert.notDeepEqual(moved.segments[1].startHandle, preserved.segments[1].startHandle);
  assert.notDeepEqual(moved.segments[0].endHandle, preserved.segments[0].endHandle);

  // The re-solved path must match a fresh fit through the same anchor
  // positions — that is the definition of "the handles describe these anchors".
  const refit = createCubicBezierPathFromStroke(
    moved.anchors.map(({ position }) => position),
    { simplifyTolerance: 0 },
  );
  for (let index = 0; index < moved.segments.length; index += 1) {
    for (const key of ['startHandle', 'endHandle']) {
      assert.ok(
        Math.abs(moved.segments[index][key][0] - refit.segments[index][key][0]) < 1e-9
        && Math.abs(moved.segments[index][key][1] - refit.segments[index][key][1]) < 1e-9,
        `segment ${index} ${key} does not match a fresh fit`,
      );
    }
  }
  assert.ok(
    maxDeviation(sampledPoints(preserved), sampledPoints(moved)) > 0.1,
    'the two behaviours must produce visibly different curves',
  );
});

test('an anchor move reaches four segments, two at an endpoint', () => {
  const path = wavyPath();
  assert.equal(cubicBezierDirtySegments(path, path.anchors[3].id).length, 4);
  assert.equal(cubicBezierDirtySegments(path, path.anchors[0].id).length, 2);
  assert.deepEqual(cubicBezierDirtySegments(path, 'anchor-nope'), []);
});

test('a move only touches the anchor it names', () => {
  const path = wavyPath();
  const moved = moveCubicBezierAnchor(path, path.anchors[2].id, { x: 13, z: 9 });
  for (let index = 0; index < path.anchors.length; index += 1) {
    if (index === 2) continue;
    assert.deepEqual(moved.anchors[index].position, path.anchors[index].position);
  }
});

test('inserting an anchor leaves the curve exactly where it was', () => {
  const path = wavyPath();
  const t = 0.37;
  const original = controlPointsForSegment(path, path.segments[1]);
  const split = insertCubicBezierAnchor(path, path.segments[1].id, t);

  assert.equal(split.anchors.length, path.anchors.length + 1);
  assert.equal(split.segments.length, path.segments.length + 1);

  // Compare analytically rather than by sampling: two identical curves sampled
  // at different densities still differ by the sampler's chord error, which
  // would hide a real shape change of the same size.
  const left = controlPointsForSegment(split, split.segments[1]);
  const right = controlPointsForSegment(split, split.segments[2]);
  for (let step = 0; step <= 200; step += 1) {
    const local = step / 200;
    const onLeft = evaluateCubicBezier(left, local);
    const expectLeft = evaluateCubicBezier(original, local * t);
    assert.ok(Math.hypot(onLeft.x - expectLeft.x, onLeft.z - expectLeft.z) < 1e-12);

    const onRight = evaluateCubicBezier(right, local);
    const expectRight = evaluateCubicBezier(original, t + local * (1 - t));
    assert.ok(Math.hypot(onRight.x - expectRight.x, onRight.z - expectRight.z) < 1e-12);
  }

  // The untouched segments must be byte-identical.
  assert.deepEqual(split.segments[0], path.segments[0]);
  assert.deepEqual(split.segments.at(-1), path.segments.at(-1));
});

test('inserting at either extreme is clamped rather than degenerate', () => {
  const path = wavyPath();
  for (const t of [0, 1, -5, 12]) {
    const split = insertCubicBezierAnchor(path, path.segments[0].id, t);
    assert.equal(split.anchors.length, path.anchors.length + 1);
  }
});

test('deleting an interior anchor merges its two segments', () => {
  const path = wavyPath();
  const deleted = deleteCubicBezierAnchor(path, path.anchors[2].id);
  assert.equal(deleted.anchors.length, path.anchors.length - 1);
  assert.equal(deleted.segments.length, path.segments.length - 1);
  assert.equal(deleted.closed, false);
  // Both outer endpoints survive untouched.
  assert.deepEqual(deleted.anchors[0].position, path.anchors[0].position);
  assert.deepEqual(deleted.anchors.at(-1).position, path.anchors.at(-1).position);
});

test('a path refuses to shrink below two anchors', () => {
  const path = createCubicBezierPathFromStroke([[0, 0], [5, 0]], { simplifyTolerance: 0.01 });
  assert.throws(() => deleteCubicBezierAnchor(path, path.anchors[0].id), /at least two anchors/);
});

test('closing a path yields a valid loop with no self-intersection', () => {
  const path = wavyPath();
  const closed = closeCubicBezierPath(path);
  assert.equal(closed.closed, true);
  assert.equal(closed.segments.length, closed.anchors.length);
  assert.deepEqual(findCubicBezierSelfIntersections(circlePath()), []);
});

test('dragging one endpoint onto the other drops it rather than doubling up', () => {
  const path = wavyPath();
  const closed = closeCubicBezierPath(path, { dropAnchorId: path.anchors.at(-1).id });
  assert.equal(closed.closed, true);
  assert.equal(closed.anchors.length, path.anchors.length - 1);
  assert.equal(closed.segments.length, closed.anchors.length);
  assert.ok(!closed.anchors.some(({ id }) => id === path.anchors.at(-1).id));
});

test('closing refuses an interior anchor', () => {
  const path = wavyPath();
  assert.throws(
    () => closeCubicBezierPath(path, { dropAnchorId: path.anchors[2].id }),
    /endpoint/,
  );
});

test('the eraser trick: deleting from a closed loop reopens it', () => {
  const loop = circlePath();
  const opened = deleteCubicBezierAnchor(loop, loop.anchors[3].id);
  assert.equal(opened.closed, false);
  assert.equal(opened.anchors.length, loop.anchors.length - 1);
  assert.equal(opened.segments.length, opened.anchors.length - 1);
});

test('deleting from a minimal 3-anchor closed loop reopens it', () => {
  const square = createCubicBezierPathFromStroke([
    [0, 0], [4, 0], [4, 4], [0, 4],
  ], { simplifyTolerance: 0.01 });
  const loop = closeCubicBezierPath(square, { dropAnchorId: square.anchors.at(-1).id });
  assert.equal(loop.closed, true);
  assert.equal(loop.anchors.length, 3);
  const opened = deleteCubicBezierAnchor(loop, loop.anchors[1].id);
  assert.equal(opened.closed, false);
  assert.equal(opened.anchors.length, 2);
  assert.equal(opened.segments.length, 1);
});

test('open and close round-trip an anchor count', () => {
  const loop = circlePath();
  const opened = openCubicBezierPath(loop);
  assert.equal(opened.closed, false);
  assert.equal(opened.anchors.length, loop.anchors.length);
  const reclosed = closeCubicBezierPath(opened);
  assert.equal(reclosed.closed, true);
  assert.equal(reclosed.anchors.length, loop.anchors.length);
});

test('smooth handle drag mirrors its partner, corner leaves it alone', () => {
  const path = wavyPath();
  const segmentId = path.segments[2].id;
  const partnerBefore = path.segments[1].endHandle;

  const smooth = setCubicBezierHandle(path, segmentId, 'start', { x: 2, z: 3 });
  assert.deepEqual(smooth.segments[2].startHandle, [2, 3]);
  const mirrored = smooth.segments[1].endHandle;
  // Opposite direction, original length preserved.
  const length = Math.hypot(...mirrored);
  assert.ok(Math.abs(length - Math.hypot(...partnerBefore)) < 1e-9);
  assert.ok(Math.abs(mirrored[0] / length - -2 / Math.hypot(2, 3)) < 1e-9);

  const corner = setCubicBezierHandle(path, segmentId, 'start', { x: 2, z: 3 }, { mode: 'corner' });
  assert.deepEqual(corner.segments[1].endHandle, partnerBefore);
});

test('self-intersection reads `closed` from the normalized path, not the argument', () => {
  const loop = circlePath();
  // A partial object with no `closed` key: the old code read it off the raw
  // argument and reported the loop's own join as a self-intersection.
  const partial = {
    version: loop.version,
    type: loop.type,
    closed: loop.closed,
    anchors: loop.anchors,
    segments: loop.segments,
  };
  delete partial.closed;
  assert.deepEqual(findCubicBezierSelfIntersections({ ...partial, closed: true }), []);
  assert.deepEqual(findCubicBezierSelfIntersections(loop), []);
});

test('crossing paths report their crossing, parallel ones do not', () => {
  const across = createCubicBezierPathFromStroke([[10, -6], [10, 0], [10, 6]], {
    simplifyTolerance: 0.01,
  });
  const along = createCubicBezierPathFromStroke([[0, 0], [10, 0], [20, 0]], {
    simplifyTolerance: 0.01,
  });
  // These cross exactly on a shared anchor of both paths — the case an
  // endpoint-exclusive test silently drops.
  const crossings = intersectCubicBezierPaths(across, along);
  assert.equal(crossings.length, 1, 'a crossing must be reported once, not per adjacent segment');
  assert.ok(Math.abs(crossings[0].x - 10) < 0.05);
  assert.ok(Math.abs(crossings[0].z) < 0.05);
  assert.ok(crossings[0].leftSegmentId && crossings[0].rightSegmentId);
  assert.ok(crossings[0].rightDistance > 9 && crossings[0].rightDistance < 11);

  // And a crossing in the middle of a segment still works.
  const offset = createCubicBezierPathFromStroke([[7.3, -6], [7.3, 0], [7.3, 6]], {
    simplifyTolerance: 0.01,
  });
  const midCrossings = intersectCubicBezierPaths(offset, along);
  assert.equal(midCrossings.length, 1);
  assert.ok(Math.abs(midCrossings[0].x - 7.3) < 0.05);

  const parallel = createCubicBezierPathFromStroke([[0, 5], [10, 5], [20, 5]], {
    simplifyTolerance: 0.01,
  });
  assert.deepEqual(intersectCubicBezierPaths(along, parallel), []);
});

test('Ctrl suppresses every snap kind', () => {
  const path = wavyPath();
  const anchorId = path.anchors[2].id;
  const candidate = { x: path.anchors[2].position[0] + 0.01, z: path.anchors[2].position[1] };
  assert.equal(
    resolveAnchorSnap({ candidate, path, anchorId, others: [], enabled: false }),
    null,
  );
  assert.ok(resolveAnchorSnap({ candidate, path, anchorId, others: [], enabled: true }));
});

test('an endpoint join outranks a curve or grid snap', () => {
  const path = wavyPath();
  const other = createCubicBezierPathFromStroke([[40, 0], [45, 0], [50, 0]], {
    simplifyTolerance: 0.01,
  });
  const target = other.anchors[0].position;
  const snap = resolveAnchorSnap({
    candidate: { x: target[0] + 0.2, z: target[1] + 0.1 },
    path,
    anchorId: path.anchors.at(-1).id,
    others: [{ constructionId: 'construction-2', path: other }],
  });
  assert.equal(snap.kind, 'anchor');
  assert.deepEqual(snap.position, [...target]);
  assert.equal(snap.constructionId, 'construction-2');
});

test('dragging one end near the other flags a loop closure', () => {
  const path = wavyPath();
  const first = path.anchors[0].position;
  const snap = resolveAnchorSnap({
    candidate: { x: first[0] + 0.1, z: first[1] + 0.1 },
    path,
    anchorId: path.anchors.at(-1).id,
  });
  assert.equal(snap.kind, 'anchor');
  assert.equal(snap.closesLoop, true);
});

test('a T-junction snaps onto another centreline', () => {
  const path = wavyPath();
  const other = createCubicBezierPathFromStroke([[0, 20], [10, 20], [20, 20]], {
    simplifyTolerance: 0.01,
  });
  const snap = resolveAnchorSnap({
    candidate: { x: 10, z: 20.3 },
    path,
    anchorId: path.anchors.at(-1).id,
    others: [{ constructionId: 'construction-2', path: other }],
  });
  assert.equal(snap.kind, 'curve');
  assert.ok(Math.abs(snap.position[1] - 20) < 1e-6);
});

test('the straight snap makes three anchors collinear and flattens the span', () => {
  // Neighbours on a horizontal line, middle anchor nudged just off it.
  const path = createCubicBezierPathFromStroke([[0, 0], [5, 0.3], [10, 0], [15, 0]], {
    simplifyTolerance: 0.01,
  });
  const anchorId = path.anchors[1].id;
  const snap = resolveAnchorSnap({
    candidate: { x: 5, z: 0.3 },
    path,
    anchorId,
    others: [],
  });
  assert.equal(snap.kind, 'straight');
  assert.equal(snap.flattenHandles, true);

  const moved = moveCubicBezierAnchor(path, anchorId, {
    x: snap.position[0],
    z: snap.position[1],
  });
  const flattened = flattenHandlesAround(moved, anchorId);
  const a = flattened.anchors[0].position;
  const b = flattened.anchors[1].position;
  const c = flattened.anchors[2].position;
  const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  assert.ok(Math.abs(cross) < 1e-9, 'anchors must be collinear');

  // Collinear anchors are not enough — the span must not bow between them.
  const points = sampledPoints(flattened)
    .filter(({ x }) => x >= a[0] && x <= c[0]);
  for (const point of points) {
    assert.ok(Math.abs(point.z) < 1e-9, `span bows to z=${point.z}`);
  }
});
