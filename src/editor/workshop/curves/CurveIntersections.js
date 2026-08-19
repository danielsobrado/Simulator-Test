import { TAU } from './CurveKernelConstants.js';
import { normalizeCurvePath } from './CurvePath.js';
import { evaluateCurveSegment } from './CurveSegment.js';
import {
  clamp01,
  pointDistanceSquared,
  WORKSHOP_GEOMETRY_TOLERANCE,
} from './GeometryTolerancePolicy.js';

function cross(ax, az, bx, bz) {
  return ax * bz - az * bx;
}

function normalizedPositiveAngle(value) {
  let result = value % TAU;
  if (result < 0) result += TAU;
  return result;
}

function arcParameter(segment, point, tolerance) {
  if (segment.degenerate) return 0;
  const angle = Math.atan2(point[1] - segment.center[1], point[0] - segment.center[0]);
  const parameter = segment.sweepAngle > 0
    ? normalizedPositiveAngle(angle - segment.startAngle) / segment.sweepAngle
    : normalizedPositiveAngle(segment.startAngle - angle) / -segment.sweepAngle;
  if (parameter < -tolerance.parameter || parameter > 1 + tolerance.parameter) return null;
  return clamp01(parameter);
}

function makeIntersection(point, leftParameter, rightParameter) {
  return Object.freeze({
    point: Object.freeze([point[0], point[1]]),
    leftParameter: clamp01(leftParameter),
    rightParameter: clamp01(rightParameter),
  });
}

function lineLineParameters(a0, a1, b0, b1, tolerance) {
  const r = [a1[0] - a0[0], a1[1] - a0[1]];
  const s = [b1[0] - b0[0], b1[1] - b0[1]];
  const rLength = Math.hypot(r[0], r[1]);
  const sLength = Math.hypot(s[0], s[1]);
  const lengthProduct = rLength * sLength;
  if (lengthProduct <= tolerance.length * tolerance.length) return null;
  const denominator = cross(r[0], r[1], s[0], s[1]);
  if (Math.abs(denominator) / lengthProduct <= tolerance.angle) return null;
  const qp = [b0[0] - a0[0], b0[1] - a0[1]];
  const t = cross(qp[0], qp[1], s[0], s[1]) / denominator;
  const u = cross(qp[0], qp[1], r[0], r[1]) / denominator;
  if (
    t < -tolerance.parameter || t > 1 + tolerance.parameter
    || u < -tolerance.parameter || u > 1 + tolerance.parameter
  ) return null;
  return { t: clamp01(t), u: clamp01(u) };
}

function parameterOnLine(point, start, end, tolerance) {
  const dx = end[0] - start[0];
  const dz = end[1] - start[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= tolerance.length * tolerance.length) return 0;
  return ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSquared;
}

function intersectCollinearLines(left, right, tolerance) {
  const r = [left.end[0] - left.start[0], left.end[1] - left.start[1]];
  const s = [right.end[0] - right.start[0], right.end[1] - right.start[1]];
  const lengthProduct = Math.hypot(...r) * Math.hypot(...s);
  if (lengthProduct <= tolerance.length * tolerance.length) return [];
  if (Math.abs(cross(r[0], r[1], s[0], s[1])) / lengthProduct > tolerance.angle) return [];
  const offset = [right.start[0] - left.start[0], right.start[1] - left.start[1]];
  if (Math.abs(cross(offset[0], offset[1], r[0], r[1])) > tolerance.intersection * Math.hypot(...r)) {
    return [];
  }
  const rightStart = parameterOnLine(right.start, left.start, left.end, tolerance);
  const rightEnd = parameterOnLine(right.end, left.start, left.end, tolerance);
  const overlapStart = Math.max(0, Math.min(rightStart, rightEnd));
  const overlapEnd = Math.min(1, Math.max(rightStart, rightEnd));
  if (overlapEnd < overlapStart - tolerance.parameter) return [];
  const leftParameters = [clamp01(overlapStart)];
  if (overlapEnd - overlapStart > tolerance.parameter) leftParameters.push(clamp01(overlapEnd));
  return leftParameters.map((leftParameter) => {
    const point = evaluateCurveSegment(left, leftParameter).point;
    const rightParameter = parameterOnLine(point, right.start, right.end, tolerance);
    return makeIntersection(point, leftParameter, rightParameter);
  });
}

function intersectLines(left, right, tolerance) {
  const parameters = lineLineParameters(left.start, left.end, right.start, right.end, tolerance);
  if (parameters) {
    const point = evaluateCurveSegment(left, parameters.t).point;
    return [makeIntersection(point, parameters.t, parameters.u)];
  }
  return intersectCollinearLines(left, right, tolerance);
}

function lineCircleCandidates(line, circle, tolerance) {
  const dx = line.end[0] - line.start[0];
  const dz = line.end[1] - line.start[1];
  const fx = line.start[0] - circle.center[0];
  const fz = line.start[1] - circle.center[1];
  const a = dx * dx + dz * dz;
  if (a <= tolerance.length * tolerance.length) return [];
  const b = 2 * (fx * dx + fz * dz);
  const c = fx * fx + fz * fz - circle.radius * circle.radius;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -tolerance.intersection) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  const parameters = [(-b - root) / (2 * a), (-b + root) / (2 * a)];
  return [...new Set(parameters.map((value) => Math.round(value / tolerance.parameter) * tolerance.parameter))]
    .filter((value) => value >= -tolerance.parameter && value <= 1 + tolerance.parameter)
    .map(clamp01);
}

function intersectLineArc(line, arc, tolerance, swapped = false) {
  const result = [];
  for (const lineParameter of lineCircleCandidates(line, arc, tolerance)) {
    const point = evaluateCurveSegment(line, lineParameter).point;
    const arcT = arcParameter(arc, point, tolerance);
    if (arcT === null) continue;
    result.push(swapped
      ? makeIntersection(point, arcT, lineParameter)
      : makeIntersection(point, lineParameter, arcT));
  }
  return result;
}

function circleCirclePoints(left, right, tolerance) {
  const dx = right.center[0] - left.center[0];
  const dz = right.center[1] - left.center[1];
  const distance = Math.hypot(dx, dz);
  if (distance <= tolerance.position) return [];
  if (distance > left.radius + right.radius + tolerance.intersection) return [];
  if (distance < Math.abs(left.radius - right.radius) - tolerance.intersection) return [];

  const a = (left.radius ** 2 - right.radius ** 2 + distance ** 2) / (2 * distance);
  const heightSquared = left.radius ** 2 - a ** 2;
  if (heightSquared < -tolerance.intersection) return [];
  const height = Math.sqrt(Math.max(0, heightSquared));
  const mid = [
    left.center[0] + dx * a / distance,
    left.center[1] + dz * a / distance,
  ];
  const perpendicular = [-dz / distance, dx / distance];
  const points = [[
    mid[0] + perpendicular[0] * height,
    mid[1] + perpendicular[1] * height,
  ]];
  if (height > tolerance.intersection) {
    points.push([
      mid[0] - perpendicular[0] * height,
      mid[1] - perpendicular[1] * height,
    ]);
  }
  return points;
}

function intersectArcs(left, right, tolerance) {
  const result = [];
  for (const point of circleCirclePoints(left, right, tolerance)) {
    const leftT = arcParameter(left, point, tolerance);
    const rightT = arcParameter(right, point, tolerance);
    if (leftT !== null && rightT !== null) result.push(makeIntersection(point, leftT, rightT));
  }
  return result;
}

function sampledPolyline(segment, tolerance) {
  const count = tolerance.intersectionSubdivisions;
  return Array.from({ length: count + 1 }, (_, index) => {
    const parameter = index / count;
    return { parameter, point: evaluateCurveSegment(segment, parameter).point };
  });
}

function sampledIntersections(left, right, tolerance) {
  const leftSamples = sampledPolyline(left, tolerance);
  const rightSamples = sampledPolyline(right, tolerance);
  const result = [];
  for (let leftIndex = 1; leftIndex < leftSamples.length; leftIndex += 1) {
    const leftStart = leftSamples[leftIndex - 1];
    const leftEnd = leftSamples[leftIndex];
    for (let rightIndex = 1; rightIndex < rightSamples.length; rightIndex += 1) {
      const rightStart = rightSamples[rightIndex - 1];
      const rightEnd = rightSamples[rightIndex];
      const parameters = lineLineParameters(
        leftStart.point,
        leftEnd.point,
        rightStart.point,
        rightEnd.point,
        tolerance,
      );
      if (!parameters) continue;
      const leftT = leftStart.parameter
        + (leftEnd.parameter - leftStart.parameter) * parameters.t;
      const rightT = rightStart.parameter
        + (rightEnd.parameter - rightStart.parameter) * parameters.u;
      const point = evaluateCurveSegment(left, leftT).point;
      result.push(makeIntersection(point, leftT, rightT));
    }
  }
  return result;
}

function deduplicate(intersections, tolerance) {
  const sorted = [...intersections].sort((a, b) => (
    a.leftParameter - b.leftParameter || a.rightParameter - b.rightParameter
  ));
  const result = [];
  for (const intersection of sorted) {
    const duplicate = result.some((entry) => (
      pointDistanceSquared(entry.point, intersection.point)
      <= tolerance.intersection * tolerance.intersection
    ));
    if (!duplicate) result.push(intersection);
  }
  return Object.freeze(result);
}

export function intersectCurveSegments(left, right, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  if (!left || !right) throw new Error('Curve intersection requires two resolved segments.');
  let intersections;
  if (left.kind === 'line' && right.kind === 'line') intersections = intersectLines(left, right, tolerance);
  else if (left.kind === 'line' && right.kind === 'arc') intersections = intersectLineArc(left, right, tolerance);
  else if (left.kind === 'arc' && right.kind === 'line') intersections = intersectLineArc(right, left, tolerance, true);
  else if (left.kind === 'arc' && right.kind === 'arc') intersections = intersectArcs(left, right, tolerance);
  else intersections = sampledIntersections(left, right, tolerance);
  return deduplicate(intersections, tolerance);
}

export function intersectCurvePaths(leftInput, rightInput, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const left = normalizeCurvePath(leftInput, { tolerance, preview: true });
  const right = normalizeCurvePath(rightInput, { tolerance, preview: true });
  const result = [];
  for (const leftSegment of left.listSegments()) {
    for (const rightSegment of right.listSegments()) {
      for (const intersection of intersectCurveSegments(leftSegment, rightSegment, tolerance)) {
        result.push(Object.freeze({
          ...intersection,
          leftSegmentId: leftSegment.id,
          rightSegmentId: rightSegment.id,
        }));
      }
    }
  }
  return deduplicate(result, tolerance);
}
