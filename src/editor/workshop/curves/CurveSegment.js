import {
  CURVE_SEGMENT_ID_PATTERN,
  CURVE_SEGMENT_KINDS,
  TAU,
} from './CurveKernelConstants.js';
import {
  clamp01,
  finitePoint2,
  pointDistance,
  pointsNear,
  WORKSHOP_GEOMETRY_TOLERANCE,
} from './GeometryTolerancePolicy.js';

function requireId(value, field) {
  if (typeof value !== 'string' || !CURVE_SEGMENT_ID_PATTERN.test(value)) {
    throw new Error(`${field} must be a stable curve identifier.`);
  }
  return value;
}

function normalizeAngle(value) {
  let result = value % TAU;
  if (result < 0) result += TAU;
  return result;
}

function directedSweep(startAngle, endAngle, clockwise) {
  const start = normalizeAngle(startAngle);
  const end = normalizeAngle(endAngle);
  if (clockwise) {
    let sweep = end - start;
    if (sweep >= 0) sweep -= TAU;
    return sweep;
  }
  let sweep = end - start;
  if (sweep <= 0) sweep += TAU;
  return sweep;
}

function unit(vector, fallback = [1, 0]) {
  const length = Math.hypot(vector[0], vector[1]);
  if (length === 0) return Object.freeze([...fallback]);
  return Object.freeze([vector[0] / length, vector[1] / length]);
}

function resolvePoint(points, id, field) {
  const point = points.get(id);
  if (!point) throw new Error(`${field} references missing point ${id}.`);
  return point.position;
}

export function normalizeCurveSegment(input, points, {
  tolerance = WORKSHOP_GEOMETRY_TOLERANCE,
  preview = false,
} = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Curve segment must be an object.');
  }
  if (!(points instanceof Map)) throw new Error('Curve segment points must be a Map.');
  const id = requireId(input.id, 'Curve segment id');
  if (!CURVE_SEGMENT_KINDS.includes(input.kind)) {
    throw new Error(`Unsupported curve segment kind: ${input.kind}.`);
  }
  const startId = requireId(input.startId, `Curve segment ${id} start id`);
  const endId = requireId(input.endId, `Curve segment ${id} end id`);
  const start = resolvePoint(points, startId, `Curve segment ${id}`);
  const end = resolvePoint(points, endId, `Curve segment ${id}`);
  const degenerate = pointsNear(start, end, tolerance.length);
  if (degenerate && !preview) {
    throw new Error(`Curve segment ${id} is shorter than the committed length tolerance.`);
  }

  if (input.kind === 'line') {
    return Object.freeze({ id, kind: 'line', startId, endId, start, end, degenerate });
  }

  if (input.kind === 'arc') {
    const center = finitePoint2(input.center, `Curve segment ${id} center`);
    const startRadius = pointDistance(center, start);
    const endRadius = pointDistance(center, end);
    const radius = (startRadius + endRadius) / 2;
    const radiusTolerance = Math.max(tolerance.position, radius * tolerance.relativeRadius);
    if ((radius <= tolerance.length || Math.abs(startRadius - endRadius) > radiusTolerance) && !preview) {
      throw new Error(`Curve segment ${id} has inconsistent arc radii.`);
    }
    const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
    const endAngle = Math.atan2(end[1] - center[1], end[0] - center[0]);
    const sweepAngle = degenerate ? 0 : directedSweep(startAngle, endAngle, input.clockwise === true);
    return Object.freeze({
      id,
      kind: 'arc',
      startId,
      endId,
      start,
      end,
      center,
      radius,
      startAngle,
      sweepAngle,
      clockwise: input.clockwise === true,
      degenerate: degenerate || radius <= tolerance.length,
    });
  }

  const control = finitePoint2(input.control, `Curve segment ${id} control`);
  return Object.freeze({
    id,
    kind: 'quadratic',
    startId,
    endId,
    start,
    end,
    control,
    degenerate: degenerate && pointsNear(start, control, tolerance.length),
  });
}

export function serializeCurveSegment(segment) {
  const base = {
    id: segment.id,
    kind: segment.kind,
    startId: segment.startId,
    endId: segment.endId,
  };
  if (segment.kind === 'arc') return { ...base, center: [...segment.center], clockwise: segment.clockwise };
  if (segment.kind === 'quadratic') return { ...base, control: [...segment.control] };
  return base;
}

export function evaluateCurveSegment(segment, parameter) {
  const t = clamp01(parameter);
  if (segment.degenerate) {
    return Object.freeze({
      point: Object.freeze([...segment.start]),
      tangent: Object.freeze([1, 0]),
      parameter: t,
    });
  }

  if (segment.kind === 'line') {
    const dx = segment.end[0] - segment.start[0];
    const dz = segment.end[1] - segment.start[1];
    return Object.freeze({
      point: Object.freeze([segment.start[0] + dx * t, segment.start[1] + dz * t]),
      tangent: unit([dx, dz]),
      parameter: t,
    });
  }

  if (segment.kind === 'arc') {
    const angle = segment.startAngle + segment.sweepAngle * t;
    const direction = Math.sign(segment.sweepAngle) || 1;
    return Object.freeze({
      point: Object.freeze([
        segment.center[0] + Math.cos(angle) * segment.radius,
        segment.center[1] + Math.sin(angle) * segment.radius,
      ]),
      tangent: Object.freeze([-Math.sin(angle) * direction, Math.cos(angle) * direction]),
      parameter: t,
    });
  }

  const oneMinus = 1 - t;
  const point = [
    oneMinus * oneMinus * segment.start[0]
      + 2 * oneMinus * t * segment.control[0]
      + t * t * segment.end[0],
    oneMinus * oneMinus * segment.start[1]
      + 2 * oneMinus * t * segment.control[1]
      + t * t * segment.end[1],
  ];
  const derivative = [
    2 * oneMinus * (segment.control[0] - segment.start[0])
      + 2 * t * (segment.end[0] - segment.control[0]),
    2 * oneMinus * (segment.control[1] - segment.start[1])
      + 2 * t * (segment.end[1] - segment.control[1]),
  ];
  return Object.freeze({ point: Object.freeze(point), tangent: unit(derivative), parameter: t });
}

export function curveSegmentLength(segment, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  if (segment.degenerate) return 0;
  if (segment.kind === 'line') return pointDistance(segment.start, segment.end);
  if (segment.kind === 'arc') return Math.abs(segment.sweepAngle) * segment.radius;

  let length = 0;
  let previous = segment.start;
  for (let index = 1; index <= tolerance.bezierSubdivisions; index += 1) {
    const current = evaluateCurveSegment(segment, index / tolerance.bezierSubdivisions).point;
    length += pointDistance(previous, current);
    previous = current;
  }
  return length;
}

export function curveSegmentParameterAtLength(segment, distance, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const length = curveSegmentLength(segment, tolerance);
  if (length <= tolerance.length) return 0;
  const target = Math.max(0, Math.min(length, distance));
  if (segment.kind !== 'quadratic') return target / length;

  const samples = [{ t: 0, length: 0 }];
  let cumulative = 0;
  let previous = segment.start;
  for (let index = 1; index <= tolerance.bezierSubdivisions; index += 1) {
    const t = index / tolerance.bezierSubdivisions;
    const current = evaluateCurveSegment(segment, t).point;
    cumulative += pointDistance(previous, current);
    samples.push({ t, length: cumulative });
    previous = current;
  }
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index].length < target) continue;
    const before = samples[index - 1];
    const after = samples[index];
    const span = after.length - before.length;
    const ratio = span <= tolerance.length ? 0 : (target - before.length) / span;
    return before.t + (after.t - before.t) * ratio;
  }
  return 1;
}

export function curveSegmentPointAtLength(segment, distance, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  return evaluateCurveSegment(segment, curveSegmentParameterAtLength(segment, distance, tolerance));
}

export function splitCurveSegmentDefinition(segment, parameter, pointId, leftId, rightId) {
  const t = clamp01(parameter);
  const split = evaluateCurveSegment(segment, t).point;
  const left = { id: leftId, kind: segment.kind, startId: segment.startId, endId: pointId };
  const right = { id: rightId, kind: segment.kind, startId: pointId, endId: segment.endId };
  if (segment.kind === 'arc') {
    left.center = [...segment.center];
    left.clockwise = segment.clockwise;
    right.center = [...segment.center];
    right.clockwise = segment.clockwise;
  } else if (segment.kind === 'quadratic') {
    const lerp = (a, b) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const leftControl = lerp(segment.start, segment.control);
    const rightControl = lerp(segment.control, segment.end);
    left.control = leftControl;
    right.control = rightControl;
  }
  return Object.freeze({
    point: Object.freeze(split),
    left: Object.freeze(left),
    right: Object.freeze(right),
  });
}

export function curveSegmentLengthAtParameter(segment, parameter, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const t = clamp01(parameter);
  if (segment.degenerate || t <= tolerance.parameter) return 0;
  if (segment.kind === 'line' || segment.kind === 'arc') {
    return curveSegmentLength(segment, tolerance) * t;
  }
  const steps = Math.max(1, Math.ceil(tolerance.bezierSubdivisions * t));
  let length = 0;
  let previous = segment.start;
  for (let index = 1; index <= steps; index += 1) {
    const localT = t * index / steps;
    const current = evaluateCurveSegment(segment, localT).point;
    length += pointDistance(previous, current);
    previous = current;
  }
  return length;
}
