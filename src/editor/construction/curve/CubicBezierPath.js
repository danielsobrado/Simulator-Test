import {
  CUBIC_BEZIER_PATH_VERSION,
  normalizeConstructionPath,
} from '../ConstructionSchema.js';

const DEFAULT_CHORD_ERROR = 0.05;
const DEFAULT_MAX_SPACING = 0.75;
const DEFAULT_MAX_DEPTH = 12;
const DEFAULT_MAX_SAMPLES = 4096;
const EPSILON = 1e-9;

function point(value) {
  return { x: value[0], z: value[1] };
}

function array(value) {
  return [Object.is(value.x, -0) ? 0 : value.x, Object.is(value.z, -0) ? 0 : value.z];
}

function lerp(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function distanceToLine(p, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= EPSILON) return distance(p, a);
  const t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSquared;
  const projected = { x: a.x + dx * t, z: a.z + dz * t };
  return distance(p, projected);
}

function anchorMap(path) {
  return new Map(path.anchors.map((anchor) => [anchor.id, point(anchor.position)]));
}

export function controlPointsForSegment(path, segmentOrId) {
  const segment = typeof segmentOrId === 'string'
    ? path.segments.find(({ id }) => id === segmentOrId)
    : segmentOrId;
  if (!segment) throw new Error(`Unknown cubic Bézier segment ${segmentOrId}.`);
  const anchors = anchorMap(path);
  const start = anchors.get(segment.startAnchorId);
  const end = anchors.get(segment.endAnchorId);
  return Object.freeze([
    start,
    { x: start.x + segment.startHandle[0], z: start.z + segment.startHandle[1] },
    { x: end.x + segment.endHandle[0], z: end.z + segment.endHandle[1] },
    end,
  ]);
}

export function evaluateCubicBezier(controlPoints, t) {
  const clamped = Math.max(0, Math.min(1, t));
  const [p0, p1, p2, p3] = controlPoints;
  const oneMinus = 1 - clamped;
  const a = oneMinus ** 3;
  const b = 3 * oneMinus ** 2 * clamped;
  const c = 3 * oneMinus * clamped ** 2;
  const d = clamped ** 3;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    z: a * p0.z + b * p1.z + c * p2.z + d * p3.z,
  };
}

export function cubicBezierDerivative(controlPoints, t) {
  const clamped = Math.max(0, Math.min(1, t));
  const [p0, p1, p2, p3] = controlPoints;
  const oneMinus = 1 - clamped;
  return {
    x: 3 * oneMinus ** 2 * (p1.x - p0.x)
      + 6 * oneMinus * clamped * (p2.x - p1.x)
      + 3 * clamped ** 2 * (p3.x - p2.x),
    z: 3 * oneMinus ** 2 * (p1.z - p0.z)
      + 6 * oneMinus * clamped * (p2.z - p1.z)
      + 3 * clamped ** 2 * (p3.z - p2.z),
  };
}

function sampleSegment(path, segment, options) {
  const controls = controlPointsForSegment(path, segment);
  const samples = [{ ...controls[0], t: 0 }];
  const {
    chordError,
    maxSpacing,
    maxDepth,
    maxSamples,
  } = options;

  function visit(t0, p0, t1, p1, depth) {
    if (samples.length >= maxSamples) {
      throw new Error(`Cubic Bézier sampling exceeded ${maxSamples} points.`);
    }
    const middleT = (t0 + t1) / 2;
    const middle = evaluateCubicBezier(controls, middleT);
    const shouldSplit = depth < maxDepth && (
      distance(p0, p1) > maxSpacing
      || distanceToLine(middle, p0, p1) > chordError
    );
    if (shouldSplit) {
      visit(t0, p0, middleT, middle, depth + 1);
      visit(middleT, middle, t1, p1, depth + 1);
      return;
    }
    samples.push({ ...p1, t: t1 });
  }

  visit(0, controls[0], 1, controls[3], 0);
  return samples;
}

export function sampleCubicBezierPath(input, {
  chordError = DEFAULT_CHORD_ERROR,
  maxSpacing = DEFAULT_MAX_SPACING,
  maxDepth = DEFAULT_MAX_DEPTH,
  maxSamples = DEFAULT_MAX_SAMPLES,
} = {}) {
  const path = normalizeConstructionPath(input);
  if (path.type !== 'cubicBezier') throw new Error('Expected a cubic Bézier path.');
  if (
    !(chordError > 0)
    || !(maxSpacing > 0)
    || !Number.isInteger(maxDepth)
    || maxDepth < 1
    || !Number.isInteger(maxSamples)
    || maxSamples < 2
  ) {
    throw new Error('Cubic Bézier sampling options are invalid.');
  }
  const result = [];
  let cumulativeDistance = 0;
  for (const segment of path.segments) {
    const remainingSamples = maxSamples - result.length;
    if (remainingSamples < 1) {
      throw new Error(`Cubic Bézier sampling exceeded ${maxSamples} points.`);
    }
    const segmentSamples = sampleSegment(path, segment, {
      chordError,
      maxSpacing,
      maxDepth,
      maxSamples: remainingSamples + (result.length > 0 ? 1 : 0),
    });
    let segmentDistance = 0;
    for (let index = 0; index < segmentSamples.length; index += 1) {
      if (index === 0 && result.length > 0) continue;
      if (result.length >= maxSamples) {
        throw new Error(`Cubic Bézier sampling exceeded ${maxSamples} points.`);
      }
      const current = segmentSamples[index];
      const previous = index > 0 ? segmentSamples[index - 1] : null;
      if (previous) {
        const step = distance(previous, current);
        segmentDistance += step;
        cumulativeDistance += step;
      }
      const derivative = cubicBezierDerivative(
        controlPointsForSegment(path, segment),
        current.t,
      );
      const magnitude = Math.hypot(derivative.x, derivative.z);
      const tangentX = magnitude > EPSILON ? derivative.x / magnitude : 1;
      const tangentZ = magnitude > EPSILON ? derivative.z / magnitude : 0;
      result.push(Object.freeze({
        x: current.x,
        z: current.z,
        t: current.t,
        segmentId: segment.id,
        segmentDistance,
        distance: cumulativeDistance,
        tangentX,
        tangentZ,
        normalX: -tangentZ,
        normalZ: tangentX,
      }));
    }
  }
  return Object.freeze({
    points: Object.freeze(result),
    totalDistance: cumulativeDistance,
  });
}

function perpendicularDistance(candidate, start, end) {
  return distanceToLine(candidate, start, end);
}

function simplifyStroke(points, epsilon) {
  if (points.length <= 2) return points;
  let maximum = 0;
  let split = -1;
  for (let index = 1; index < points.length - 1; index += 1) {
    const found = perpendicularDistance(points[index], points[0], points.at(-1));
    if (found > maximum) {
      maximum = found;
      split = index;
    }
  }
  if (maximum <= epsilon) return [points[0], points.at(-1)];
  const left = simplifyStroke(points.slice(0, split + 1), epsilon);
  const right = simplifyStroke(points.slice(split), epsilon);
  return [...left.slice(0, -1), ...right];
}

export function createCubicBezierPathFromStroke(inputPoints, {
  closed = false,
  simplifyTolerance = 0.2,
  anchorPrefix = 'anchor',
  segmentPrefix = 'segment',
} = {}) {
  if (!Array.isArray(inputPoints) || inputPoints.length < 2) {
    throw new Error('A curve stroke requires at least two points.');
  }
  const source = inputPoints.map((value, index) => {
    const x = Number(value.x ?? value[0]);
    const z = Number(value.z ?? value[1]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      throw new Error(`Curve stroke point ${index + 1} is invalid.`);
    }
    return { x, z };
  });
  const simplified = simplifyStroke(source, simplifyTolerance);
  if (closed && distance(simplified[0], simplified.at(-1)) <= simplifyTolerance) {
    simplified.pop();
  }
  if (simplified.length < 2) throw new Error('Curve stroke collapsed below two anchors.');
  const anchors = simplified.map((entry, index) => ({
    id: `${anchorPrefix}-${index + 1}`,
    position: array(entry),
  }));
  const segmentCount = closed ? anchors.length : anchors.length - 1;
  const segments = [];
  for (let index = 0; index < segmentCount; index += 1) {
    const start = simplified[index];
    const endIndex = (index + 1) % simplified.length;
    const end = simplified[endIndex];
    const previous = simplified[index === 0
      ? (closed ? simplified.length - 1 : 0)
      : index - 1];
    const next = closed
      ? simplified[(endIndex + 1) % simplified.length]
      : simplified[Math.min(endIndex + 1, simplified.length - 1)];
    const startHandle = {
      x: (end.x - previous.x) / 6,
      z: (end.z - previous.z) / 6,
    };
    const endHandle = {
      x: -(next.x - start.x) / 6,
      z: -(next.z - start.z) / 6,
    };
    segments.push({
      id: `${segmentPrefix}-${index + 1}`,
      startAnchorId: anchors[index].id,
      endAnchorId: anchors[endIndex].id,
      startHandle: array(startHandle),
      endHandle: array(endHandle),
    });
  }
  return normalizeConstructionPath({
    version: CUBIC_BEZIER_PATH_VERSION,
    type: 'cubicBezier',
    closed,
    anchors,
    segments,
    features: [],
  });
}

/**
 * Re-derive every handle from anchor positions, using the same Catmull-Rom
 * formula `createCubicBezierPathFromStroke` applies when fitting a stroke.
 *
 * Because each segment's handles read the anchors *outside* it, moving anchor
 * `i` changes the handles of segments `i-2 … i+1` — four, not two. Callers
 * reporting dirty segments have to match that reach or geometry goes stale
 * beside an edit.
 */
function resolveCatmullRomHandles(path) {
  const anchors = path.anchors;
  const count = anchors.length;
  const at = (index) => point(anchors[((index % count) + count) % count].position);
  const segments = path.segments.map((segment, index) => {
    const start = at(index);
    const endIndex = index + 1;
    const end = at(endIndex);
    const previous = path.closed
      ? at(index - 1)
      : at(Math.max(0, index - 1));
    const next = path.closed
      ? at(endIndex + 1)
      : at(Math.min(count - 1, endIndex + 1));
    return {
      ...segment,
      startHandle: array({ x: (end.x - previous.x) / 6, z: (end.z - previous.z) / 6 }),
      endHandle: array({ x: -(next.x - start.x) / 6, z: -(next.z - start.z) / 6 }),
    };
  });
  return { ...path, segments };
}

/**
 * @param options.resolveHandles `'catmull-rom'` re-solves handles from the new
 *   anchor positions; `'preserve'` keeps the existing offsets. Preserving is
 *   what the code did before and it kinks the curve progressively as an anchor
 *   is dragged away from where it was fitted, so it is no longer the default.
 */
export function moveCubicBezierAnchor(input, anchorId, position, {
  resolveHandles = 'catmull-rom',
} = {}) {
  const path = normalizeConstructionPath(input);
  if (path.type !== 'cubicBezier') throw new Error('Expected a cubic Bézier path.');
  if (!path.anchors.some(({ id }) => id === anchorId)) {
    throw new Error(`Unknown cubic Bézier anchor ${anchorId}.`);
  }
  const moved = {
    ...path,
    anchors: path.anchors.map((anchor) => (
      anchor.id === anchorId
        ? { ...anchor, position: [Number(position.x ?? position[0]), Number(position.z ?? position[1])] }
        : anchor
    )),
  };
  return normalizeConstructionPath(
    resolveHandles === 'catmull-rom' ? resolveCatmullRomHandles(moved) : moved,
  );
}

/** Segments whose handles a move of `anchorId` can change. */
export function cubicBezierDirtySegments(input, anchorId) {
  const path = normalizeConstructionPath(input);
  const anchorIndex = path.anchors.findIndex(({ id }) => id === anchorId);
  if (anchorIndex < 0) return [];
  const count = path.segments.length;
  const ids = new Set();
  for (let offset = -2; offset <= 1; offset += 1) {
    const index = anchorIndex + offset;
    const wrapped = path.closed ? ((index % count) + count) % count : index;
    if (wrapped >= 0 && wrapped < count) ids.add(path.segments[wrapped].id);
  }
  return [...ids];
}

function uniqueId(prefix, taken) {
  let index = taken.size + 1;
  while (taken.has(`${prefix}-${index}`)) index += 1;
  return `${prefix}-${index}`;
}

/**
 * Split a segment at parameter `t`, leaving the rendered curve **exactly**
 * unchanged.
 *
 * De Casteljau, not "insert an anchor at the midpoint and re-solve" — the
 * latter moves the curve, which makes adding a control point feel like a
 * mistake. The two halves' control points are exact, so the shape is preserved
 * to floating-point precision.
 */
export function insertCubicBezierAnchor(input, segmentId, t) {
  const path = normalizeConstructionPath(input);
  if (path.type !== 'cubicBezier') throw new Error('Expected a cubic Bézier path.');
  const index = path.segments.findIndex(({ id }) => id === segmentId);
  if (index < 0) throw new Error(`Unknown cubic Bézier segment ${segmentId}.`);
  const clamped = Math.max(1e-4, Math.min(1 - 1e-4, Number(t)));
  const [p0, p1, p2, p3] = controlPointsForSegment(path, path.segments[index]);

  const a = lerp(p0, p1, clamped);
  const b = lerp(p1, p2, clamped);
  const c = lerp(p2, p3, clamped);
  const d = lerp(a, b, clamped);
  const e = lerp(b, c, clamped);
  const split = lerp(d, e, clamped);

  const anchorIds = new Set(path.anchors.map(({ id }) => id));
  const segmentIds = new Set(path.segments.map(({ id }) => id));
  const anchorId = uniqueId('anchor', anchorIds);
  const newSegmentId = uniqueId('segment', segmentIds);

  const anchors = [...path.anchors];
  anchors.splice(index + 1, 0, { id: anchorId, position: array(split) });

  const segments = [...path.segments];
  segments.splice(index, 1,
    {
      ...path.segments[index],
      endAnchorId: anchorId,
      startHandle: array({ x: a.x - p0.x, z: a.z - p0.z }),
      endHandle: array({ x: d.x - split.x, z: d.z - split.z }),
    },
    {
      id: newSegmentId,
      startAnchorId: anchorId,
      endAnchorId: path.segments[index].endAnchorId,
      startHandle: array({ x: e.x - split.x, z: e.z - split.z }),
      endHandle: array({ x: c.x - p3.x, z: c.z - p3.z }),
    });

  return normalizeConstructionPath({ ...path, anchors, segments });
}

/**
 * Remove an anchor.
 *
 * On an **open** path the two adjacent segments merge into one, keeping the
 * outer endpoints' tangents. On a **closed** path the anchor and both its
 * segments go and the path opens, leaving a C with a gap — this is the "delete
 * a sliver of a circular building" trick that turns a closed footprint back
 * into a single draggable wall.
 */
export function deleteCubicBezierAnchor(input, anchorId) {
  const path = normalizeConstructionPath(input);
  if (path.type !== 'cubicBezier') throw new Error('Expected a cubic Bézier path.');
  const index = path.anchors.findIndex(({ id }) => id === anchorId);
  if (index < 0) throw new Error(`Unknown cubic Bézier anchor ${anchorId}.`);
  // Closed loops can be as small as three anchors (close-via-snap drops one
  // endpoint). Deleting one must reopen that ring; requiring four made the
  // documented "delete a sliver" workflow fail on every minimal loop.
  const minimum = 3;
  if (path.anchors.length < minimum) {
    throw new Error('A construction path needs at least two anchors.');
  }

  const anchors = path.anchors.filter((_, position) => position !== index);

  if (path.closed) {
    // Reopen at the gap: the surviving segments start after the deleted anchor
    // and run around to the one before it.
    const count = path.segments.length;
    const ordered = [];
    for (let step = 0; step < count; step += 1) {
      const segmentIndex = (index + 1 + step) % count;
      if (segmentIndex === index) continue;
      ordered.push(path.segments[segmentIndex]);
    }
    const rotated = [];
    for (let step = 0; step < anchors.length - 1; step += 1) {
      rotated.push({
        ...ordered[step],
        startAnchorId: anchors[step].id,
        endAnchorId: anchors[step + 1].id,
      });
    }
    return normalizeConstructionPath({
      ...path,
      closed: false,
      anchors,
      segments: rotated,
    });
  }

  const segments = [];
  for (let position = 0; position < path.segments.length; position += 1) {
    const segment = path.segments[position];
    if (position === index - 1 && index > 0 && index < path.anchors.length - 1) {
      // Merge: keep this segment's start tangent and the next one's end tangent.
      segments.push({
        ...segment,
        endAnchorId: path.segments[position + 1].endAnchorId,
        endHandle: path.segments[position + 1].endHandle,
      });
      position += 1;
      continue;
    }
    if (segment.startAnchorId === anchorId || segment.endAnchorId === anchorId) continue;
    segments.push(segment);
  }
  const relinked = segments.map((segment, position) => ({
    ...segment,
    startAnchorId: anchors[position].id,
    endAnchorId: anchors[position + 1].id,
  }));
  return normalizeConstructionPath({ ...path, anchors, segments: relinked });
}

/**
 * Close an open path into a loop.
 *
 * `dropAnchorId` is the anchor being dragged onto its counterpart; it is
 * removed and the wrap-around segment takes its place, so snapping two ends
 * together produces a seamless circle rather than a doubled anchor.
 */
export function closeCubicBezierPath(input, { dropAnchorId = null } = {}) {
  const path = normalizeConstructionPath(input);
  if (path.type !== 'cubicBezier') throw new Error('Expected a cubic Bézier path.');
  if (path.closed) return path;

  let anchors = [...path.anchors];
  let segments = [...path.segments];
  if (dropAnchorId) {
    const index = anchors.findIndex(({ id }) => id === dropAnchorId);
    const isEndpoint = index === 0 || index === anchors.length - 1;
    if (!isEndpoint) throw new Error('Only an endpoint can be dropped when closing a path.');
    anchors = anchors.filter((_, position) => position !== index);
    segments = index === 0 ? segments.slice(1) : segments.slice(0, -1);
  }
  if (anchors.length < 3) throw new Error('A closed path needs at least three anchors.');

  const segmentIds = new Set(segments.map(({ id }) => id));
  segments = segments.map((segment, position) => ({
    ...segment,
    startAnchorId: anchors[position].id,
    endAnchorId: anchors[position + 1].id,
  }));
  segments.push({
    id: uniqueId('segment', segmentIds),
    startAnchorId: anchors.at(-1).id,
    endAnchorId: anchors[0].id,
    startHandle: [0, 0],
    endHandle: [0, 0],
  });

  // Re-solve across the new seam so the join is smooth rather than a corner.
  return normalizeConstructionPath(
    resolveCatmullRomHandles({ ...path, closed: true, anchors, segments }),
  );
}

/** Reopen a closed path by removing one segment. */
export function openCubicBezierPath(input, { atSegmentId = null } = {}) {
  const path = normalizeConstructionPath(input);
  if (!path.closed) return path;
  const index = atSegmentId
    ? path.segments.findIndex(({ id }) => id === atSegmentId)
    : path.segments.length - 1;
  if (index < 0) throw new Error(`Unknown cubic Bézier segment ${atSegmentId}.`);

  // Rotate so the cut lands at the ends, then drop the cut segment.
  const count = path.segments.length;
  const anchors = [];
  const segments = [];
  for (let step = 0; step < count; step += 1) {
    const segmentIndex = (index + 1 + step) % count;
    if (segmentIndex === index) continue;
    anchors.push(path.anchors[segmentIndex]);
    segments.push(path.segments[segmentIndex]);
  }
  anchors.push(path.anchors[index]);
  const relinked = segments.map((segment, position) => ({
    ...segment,
    startAnchorId: anchors[position].id,
    endAnchorId: anchors[position + 1].id,
  }));
  return normalizeConstructionPath({
    ...path,
    closed: false,
    anchors,
    segments: relinked,
  });
}

/**
 * Move one tangent handle.
 *
 * `'smooth'` mirrors the opposite handle's direction across the shared anchor
 * while keeping its length, which is what keeps a curve C1 through an anchor.
 * `'corner'` moves this handle alone, allowing a deliberate hard corner.
 */
export function setCubicBezierHandle(input, segmentId, which, offset, { mode = 'smooth' } = {}) {
  const path = normalizeConstructionPath(input);
  if (path.type !== 'cubicBezier') throw new Error('Expected a cubic Bézier path.');
  if (which !== 'start' && which !== 'end') throw new Error('Handle must be "start" or "end".');
  const index = path.segments.findIndex(({ id }) => id === segmentId);
  if (index < 0) throw new Error(`Unknown cubic Bézier segment ${segmentId}.`);

  const next = { x: Number(offset.x ?? offset[0]), z: Number(offset.z ?? offset[1]) };
  const segments = path.segments.map((segment) => ({ ...segment }));
  segments[index][which === 'start' ? 'startHandle' : 'endHandle'] = array(next);

  if (mode === 'smooth') {
    // The opposite handle at the same anchor is the previous segment's end
    // handle (for a start handle) or the next segment's start handle.
    const count = segments.length;
    const partnerIndex = which === 'start'
      ? (path.closed ? (index - 1 + count) % count : index - 1)
      : (path.closed ? (index + 1) % count : index + 1);
    if (partnerIndex >= 0 && partnerIndex < count) {
      const key = which === 'start' ? 'endHandle' : 'startHandle';
      const partner = segments[partnerIndex][key];
      const partnerLength = Math.hypot(partner[0], partner[1]);
      const length = Math.hypot(next.x, next.z);
      if (partnerLength > EPSILON && length > EPSILON) {
        segments[partnerIndex][key] = array({
          x: (-next.x / length) * partnerLength,
          z: (-next.z / length) * partnerLength,
        });
      }
    }
  }
  return normalizeConstructionPath({ ...path, segments });
}

export function cubicBezierPathBounds(input) {
  const sampled = sampleCubicBezierPath(input);
  const bounds = {
    minX: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxZ: -Infinity,
  };
  for (const entry of sampled.points) {
    bounds.minX = Math.min(bounds.minX, entry.x);
    bounds.minZ = Math.min(bounds.minZ, entry.z);
    bounds.maxX = Math.max(bounds.maxX, entry.x);
    bounds.maxZ = Math.max(bounds.maxZ, entry.z);
  }
  return Object.freeze(bounds);
}

export function closestPointOnCubicBezierPath(input, candidate) {
  const path = normalizeConstructionPath(input);
  if (path.type !== 'cubicBezier') throw new Error('Expected a cubic Bézier path.');
  const target = point([candidate.x ?? candidate[0], candidate.z ?? candidate[1]]);
  let best = null;
  for (const segment of path.segments) {
    const controls = controlPointsForSegment(path, segment);
    for (let step = 0; step <= 64; step += 1) {
      const t = step / 64;
      const current = evaluateCubicBezier(controls, t);
      const found = distance(current, target);
      if (!best || found < best.distance) {
        best = { ...current, t, segmentId: segment.id, distance: found };
      }
    }
  }
  return Object.freeze(best);
}

function lineIntersection(a, b, c, d) {
  const r = { x: b.x - a.x, z: b.z - a.z };
  const s = { x: d.x - c.x, z: d.z - c.z };
  const cross = r.x * s.z - r.z * s.x;
  if (Math.abs(cross) <= EPSILON) return null;
  const q = { x: c.x - a.x, z: c.z - a.z };
  const t = (q.x * s.z - q.z * s.x) / cross;
  const u = (q.x * r.z - q.z * r.x) / cross;
  if (t <= EPSILON || t >= 1 - EPSILON || u <= EPSILON || u >= 1 - EPSILON) return null;
  return { x: a.x + r.x * t, z: a.z + r.z * t };
}

export function findCubicBezierSelfIntersections(input) {
  // Normalize first and read `closed` off the result. Reading it off the raw
  // argument worked only when callers passed a complete path object and
  // silently reported a closed loop's own join as a self-intersection for a
  // partial one — which becomes load-bearing the moment loops are creatable.
  const path = normalizeConstructionPath(input);
  const sampled = sampleCubicBezierPath(path, { chordError: 0.02, maxSpacing: 0.35 });
  const intersections = [];
  for (let left = 0; left < sampled.points.length - 1; left += 1) {
    for (let right = left + 2; right < sampled.points.length - 1; right += 1) {
      if (left === 0 && right === sampled.points.length - 2 && path.closed) continue;
      const found = lineIntersection(
        sampled.points[left],
        sampled.points[left + 1],
        sampled.points[right],
        sampled.points[right + 1],
      );
      if (found) intersections.push(Object.freeze(found));
    }
  }
  return Object.freeze(intersections);
}

/**
 * Segment crossing with **inclusive** endpoints.
 *
 * `lineIntersection` excludes its endpoints, which is right for the
 * self-intersection sweep — it stops two adjacent segments reporting their
 * shared vertex. Across two different paths that exclusion silently drops any
 * crossing that lands on a sample point, which is exactly what happens when a
 * wall is crossed at a right angle through one of its own anchors. Duplicates
 * from adjacent segments sharing a vertex are removed afterwards instead.
 */
function inclusiveCrossing(a, b, c, d) {
  const r = { x: b.x - a.x, z: b.z - a.z };
  const s = { x: d.x - c.x, z: d.z - c.z };
  const cross = r.x * s.z - r.z * s.x;
  if (Math.abs(cross) <= EPSILON) return null;
  const q = { x: c.x - a.x, z: c.z - a.z };
  const t = (q.x * s.z - q.z * s.x) / cross;
  const u = (q.x * r.z - q.z * r.x) / cross;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON) return null;
  return { x: a.x + r.x * t, z: a.z + r.z * t, t, u };
}

/**
 * Crossings between two different paths.
 *
 * Phase 6's "draw a path through a wall to carve an arch" gesture is the
 * consumer, so a crossing must be reported once with the arc position on each
 * path — enough to resolve `{ segmentId, arcFraction }` for a feature.
 */
export function intersectCubicBezierPaths(left, right, { mergeDistance = 0.05 } = {}) {
  const a = sampleCubicBezierPath(left, { chordError: 0.02, maxSpacing: 0.35 });
  const b = sampleCubicBezierPath(right, { chordError: 0.02, maxSpacing: 0.35 });
  const crossings = [];
  for (let i = 0; i < a.points.length - 1; i += 1) {
    for (let j = 0; j < b.points.length - 1; j += 1) {
      const found = inclusiveCrossing(
        a.points[i], a.points[i + 1],
        b.points[j], b.points[j + 1],
      );
      if (!found) continue;
      const leftPoint = a.points[i];
      const rightPoint = b.points[j];
      const candidate = {
        x: found.x,
        z: found.z,
        leftSegmentId: leftPoint.segmentId,
        leftDistance: leftPoint.distance
          + (a.points[i + 1].distance - leftPoint.distance) * found.t,
        rightSegmentId: rightPoint.segmentId,
        rightDistance: rightPoint.distance
          + (b.points[j + 1].distance - rightPoint.distance) * found.u,
      };
      // Two adjacent segments sharing the crossing vertex both report it.
      const duplicate = crossings.some((other) => (
        Math.hypot(other.x - candidate.x, other.z - candidate.z) <= mergeDistance
      ));
      if (!duplicate) crossings.push(Object.freeze(candidate));
    }
  }
  return Object.freeze(crossings);
}
