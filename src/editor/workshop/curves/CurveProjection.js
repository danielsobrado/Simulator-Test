import { TAU } from './CurveKernelConstants.js';
import { normalizeCurvePath } from './CurvePath.js';
import {
  curveSegmentLength,
  curveSegmentLengthAtParameter,
  evaluateCurveSegment,
} from './CurveSegment.js';
import {
  clamp01,
  finitePoint2,
  pointDistanceSquared,
  WORKSHOP_GEOMETRY_TOLERANCE,
} from './GeometryTolerancePolicy.js';

function candidate(segment, point, parameter) {
  const evaluated = evaluateCurveSegment(segment, parameter);
  return {
    segmentId: segment.id,
    parameter: evaluated.parameter,
    point: evaluated.point,
    tangent: evaluated.tangent,
    distanceSquared: pointDistanceSquared(point, evaluated.point),
  };
}

function bestCandidate(candidates) {
  return candidates.reduce((best, current) => (
    !best
      || current.distanceSquared < best.distanceSquared
      || (current.distanceSquared === best.distanceSquared && current.parameter < best.parameter)
      ? current
      : best
  ), null);
}

function projectLine(segment, point, tolerance) {
  const dx = segment.end[0] - segment.start[0];
  const dz = segment.end[1] - segment.start[1];
  const lengthSquared = dx * dx + dz * dz;
  if (lengthSquared <= tolerance.length * tolerance.length) return candidate(segment, point, 0);
  const parameter = ((point[0] - segment.start[0]) * dx + (point[1] - segment.start[1]) * dz)
    / lengthSquared;
  return candidate(segment, point, clamp01(parameter));
}

function normalizedPositiveAngle(value) {
  let result = value % TAU;
  if (result < 0) result += TAU;
  return result;
}

function arcCandidateParameter(segment, point) {
  const angle = Math.atan2(point[1] - segment.center[1], point[0] - segment.center[0]);
  if (segment.sweepAngle > 0) {
    const delta = normalizedPositiveAngle(angle - segment.startAngle);
    const parameter = delta / segment.sweepAngle;
    return parameter >= 0 && parameter <= 1 ? parameter : null;
  }
  if (segment.sweepAngle < 0) {
    const delta = normalizedPositiveAngle(segment.startAngle - angle);
    const parameter = delta / -segment.sweepAngle;
    return parameter >= 0 && parameter <= 1 ? parameter : null;
  }
  return 0;
}

function projectArc(segment, point) {
  const parameter = arcCandidateParameter(segment, point);
  const candidates = [candidate(segment, point, 0), candidate(segment, point, 1)];
  if (parameter !== null) candidates.push(candidate(segment, point, parameter));
  return bestCandidate(candidates);
}

function projectQuadratic(segment, point, tolerance) {
  let bestIndex = 0;
  let best = candidate(segment, point, 0);
  for (let index = 1; index <= tolerance.bezierSubdivisions; index += 1) {
    const current = candidate(segment, point, index / tolerance.bezierSubdivisions);
    if (current.distanceSquared < best.distanceSquared) {
      best = current;
      bestIndex = index;
    }
  }

  let low = Math.max(0, (bestIndex - 1) / tolerance.bezierSubdivisions);
  let high = Math.min(1, (bestIndex + 1) / tolerance.bezierSubdivisions);
  for (let iteration = 0; iteration < tolerance.projectionIterations; iteration += 1) {
    const left = low + (high - low) / 3;
    const right = high - (high - low) / 3;
    const leftDistance = candidate(segment, point, left).distanceSquared;
    const rightDistance = candidate(segment, point, right).distanceSquared;
    if (leftDistance <= rightDistance) high = right;
    else low = left;
  }
  return bestCandidate([
    best,
    candidate(segment, point, (low + high) / 2),
    candidate(segment, point, low),
    candidate(segment, point, high),
  ]);
}

export function projectPointToCurveSegment(segment, pointInput, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const point = finitePoint2(pointInput, 'Projection point');
  const result = segment.kind === 'line'
    ? projectLine(segment, point, tolerance)
    : segment.kind === 'arc'
      ? projectArc(segment, point)
      : projectQuadratic(segment, point, tolerance);
  return Object.freeze({
    ...result,
    distance: Math.sqrt(result.distanceSquared),
  });
}

export function projectPointToCurvePath(pathInput, pointInput, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const path = normalizeCurvePath(pathInput, { tolerance, preview: true });
  const point = finitePoint2(pointInput, 'Projection point');
  let offset = 0;
  let best = null;
  for (const segment of path.listSegments()) {
    const projection = projectPointToCurveSegment(segment, point, tolerance);
    const segmentDistance = curveSegmentLengthAtParameter(segment, projection.parameter, tolerance);
    const pathDistance = offset + segmentDistance;
    const candidateResult = { ...projection, pathDistance, segmentDistance };
    if (
      !best
      || candidateResult.distanceSquared < best.distanceSquared
      || (candidateResult.distanceSquared === best.distanceSquared && pathDistance < best.pathDistance)
    ) best = candidateResult;
    offset += curveSegmentLength(segment, tolerance);
  }
  if (!best) {
    return Object.freeze({
      segmentId: null,
      parameter: 0,
      point: Object.freeze([0, 0]),
      tangent: Object.freeze([1, 0]),
      distance: Math.hypot(point[0], point[1]),
      distanceSquared: point[0] ** 2 + point[1] ** 2,
      pathDistance: 0,
      segmentDistance: 0,
    });
  }
  return Object.freeze(best);
}

export function pointToPathCoordinate(pathInput, pointInput, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const projection = projectPointToCurvePath(pathInput, pointInput, tolerance);
  const point = finitePoint2(pointInput, 'Path-local point');
  const normal = Object.freeze([-projection.tangent[1], projection.tangent[0]]);
  const offset = [point[0] - projection.point[0], point[1] - projection.point[1]];
  const lateral = offset[0] * normal[0] + offset[1] * normal[1];
  return Object.freeze({
    segmentId: projection.segmentId,
    segmentParameter: projection.parameter,
    distance: projection.pathDistance,
    lateral,
    point: projection.point,
    tangent: projection.tangent,
    normal,
  });
}

export function pathCoordinateToPoint(pathInput, coordinate, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  if (!coordinate || typeof coordinate !== 'object') throw new Error('Path coordinate must be an object.');
  const path = normalizeCurvePath(pathInput, { tolerance, preview: true });
  const segment = coordinate.segmentId ? path.getSegment(coordinate.segmentId) : null;
  if (!segment) throw new Error(`Unknown path-coordinate segment: ${coordinate.segmentId}.`);
  const parameter = clamp01(coordinate.segmentParameter ?? 0);
  const lateral = coordinate.lateral ?? 0;
  if (!Number.isFinite(lateral)) throw new Error('Path-coordinate lateral offset must be finite.');
  const evaluated = evaluateCurveSegment(segment, parameter);
  const normal = [-evaluated.tangent[1], evaluated.tangent[0]];
  return Object.freeze([
    evaluated.point[0] + normal[0] * lateral,
    evaluated.point[1] + normal[1] * lateral,
  ]);
}
