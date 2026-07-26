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

export function moveCubicBezierAnchor(input, anchorId, position) {
  const path = normalizeConstructionPath(input);
  if (path.type !== 'cubicBezier') throw new Error('Expected a cubic Bézier path.');
  if (!path.anchors.some(({ id }) => id === anchorId)) {
    throw new Error(`Unknown cubic Bézier anchor ${anchorId}.`);
  }
  return normalizeConstructionPath({
    ...path,
    anchors: path.anchors.map((anchor) => (
      anchor.id === anchorId
        ? { ...anchor, position: [Number(position.x ?? position[0]), Number(position.z ?? position[1])] }
        : anchor
    )),
  });
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
  const sampled = sampleCubicBezierPath(input, { chordError: 0.02, maxSpacing: 0.35 });
  const intersections = [];
  for (let left = 0; left < sampled.points.length - 1; left += 1) {
    for (let right = left + 2; right < sampled.points.length - 1; right += 1) {
      if (left === 0 && right === sampled.points.length - 2 && input.closed) continue;
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
