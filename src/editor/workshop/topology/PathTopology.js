import { CURVE_POINT_ID_PATTERN, CURVE_SEGMENT_ID_PATTERN } from '../curves/CurveKernelConstants.js';
import { CurvePath, normalizeCurvePath } from '../curves/CurvePath.js';
import {
  curveSegmentLength,
  splitCurveSegmentDefinition,
} from '../curves/CurveSegment.js';
import {
  finitePoint2,
  pointDistance,
  pointsNear,
  WORKSHOP_GEOMETRY_TOLERANCE,
} from '../curves/GeometryTolerancePolicy.js';
import { TopologyGraph } from './TopologyGraph.js';
import { TopologyRemap } from './TopologyRemap.js';

function requireAvailableId(value, used, pattern, field) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${field} must be a stable lowercase identifier.`);
  }
  if (used.has(value)) throw new Error(`${field} already exists: ${value}.`);
  return value;
}

function uniqueDerivedId(preferred, used, pattern, field) {
  if (typeof preferred !== 'string' || !pattern.test(preferred)) {
    throw new Error(`${field} must be a stable lowercase identifier.`);
  }
  if (!used.has(preferred)) return preferred;
  for (let suffix = 2; suffix < 10_000; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${preferred.slice(0, 64 - tail.length)}${tail}`;
    if (!used.has(candidate)) return candidate;
  }
  throw new Error(`Could not derive unique ${field.toLowerCase()}.`);
}

function defaultDerivedId(base, suffix, pattern, used, field) {
  const tail = `-${suffix}`;
  const preferred = `${base.slice(0, 64 - tail.length)}${tail}`;
  return uniqueDerivedId(preferred, used, pattern, field);
}

function serializablePath(path) {
  return path.toJSON();
}

export function assertCommittedPathTopology(pathInput, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const path = normalizeCurvePath(pathInput, { tolerance });
  const graph = new TopologyGraph(path);
  if (graph.components().length !== 1) throw new Error('Committed curve path must be connected.');
  const degrees = path.listPoints().map(({ id }) => graph.degree(id));
  if (path.closed) {
    if (degrees.some((degree) => degree !== 2)) throw new Error('Closed path points must all have degree 2.');
  } else {
    const endpoints = degrees.filter((degree) => degree === 1).length;
    if (path.segmentCount === 1) {
      if (endpoints !== 2) throw new Error('Single-segment path requires two endpoints.');
    } else if (endpoints !== 2 || degrees.some((degree) => degree < 1 || degree > 2)) {
      throw new Error('Open path requires two endpoints and degree-2 interior points.');
    }
  }
  return path;
}

export function movePathPoint(pathInput, pointId, positionInput, options = {}) {
  const tolerance = options.tolerance ?? WORKSHOP_GEOMETRY_TOLERANCE;
  const path = normalizeCurvePath(pathInput, { tolerance, preview: options.preview === true });
  if (!path.getPoint(pointId)) throw new Error(`Unknown curve point: ${pointId}.`);
  const position = finitePoint2(positionInput, `Curve point ${pointId} position`);
  const json = serializablePath(path);
  const point = json.points.find(({ id }) => id === pointId);
  point.position = [...position];
  const nextPath = new CurvePath(json, { tolerance, preview: options.preview === true });
  const remap = new TopologyRemap(path.listSegments().map(({ id }) => ({
    sourceSegmentId: id,
    sourceRange: [0, 1],
    targetSegmentId: id,
    targetRange: [0, 1],
  })));
  return Object.freeze({ path: nextPath, remap, pointId });
}

export function splitPathSegment(pathInput, segmentId, parameter, options = {}) {
  const tolerance = options.tolerance ?? WORKSHOP_GEOMETRY_TOLERANCE;
  const path = assertCommittedPathTopology(pathInput, tolerance);
  if (!Number.isFinite(parameter)
    || parameter <= tolerance.parameter
    || parameter >= 1 - tolerance.parameter) {
    throw new Error('Curve split parameter must be strictly inside the segment.');
  }
  const segment = path.getSegment(segmentId);
  if (!segment) throw new Error(`Unknown curve segment: ${segmentId}.`);

  const usedPointIds = new Set(path.listPoints().map(({ id }) => id));
  const usedSegmentIds = new Set(path.listSegments().map(({ id }) => id));
  const pointId = options.pointId
    ? requireAvailableId(options.pointId, usedPointIds, CURVE_POINT_ID_PATTERN, 'Split point id')
    : defaultDerivedId(segment.id, 'split', CURVE_POINT_ID_PATTERN, usedPointIds, 'Split point id');
  const leftId = options.leftSegmentId
    ? requireAvailableId(options.leftSegmentId, usedSegmentIds, CURVE_SEGMENT_ID_PATTERN, 'Left segment id')
    : defaultDerivedId(segment.id, 'a', CURVE_SEGMENT_ID_PATTERN, usedSegmentIds, 'Left segment id');
  usedSegmentIds.add(leftId);
  const rightId = options.rightSegmentId
    ? requireAvailableId(options.rightSegmentId, usedSegmentIds, CURVE_SEGMENT_ID_PATTERN, 'Right segment id')
    : defaultDerivedId(segment.id, 'b', CURVE_SEGMENT_ID_PATTERN, usedSegmentIds, 'Right segment id');

  const split = splitCurveSegmentDefinition(segment, parameter, pointId, leftId, rightId);
  const json = serializablePath(path);
  json.points.push({ id: pointId, position: [...split.point] });
  const index = json.segments.findIndex(({ id }) => id === segmentId);
  json.segments.splice(index, 1, split.left, split.right);
  const nextPath = new CurvePath(json, { tolerance });
  const remap = new TopologyRemap([
    {
      sourceSegmentId: segmentId,
      sourceRange: [0, parameter],
      targetSegmentId: leftId,
      targetRange: [0, 1],
    },
    {
      sourceSegmentId: segmentId,
      sourceRange: [parameter, 1],
      targetSegmentId: rightId,
      targetRange: [0, 1],
    },
  ]);
  return Object.freeze({ path: nextPath, remap, pointId, segmentIds: Object.freeze([leftId, rightId]) });
}

function lineMergeDefinition(first, second, mergedId, tolerance) {
  const firstVector = [first.end[0] - first.start[0], first.end[1] - first.start[1]];
  const secondVector = [second.end[0] - second.start[0], second.end[1] - second.start[1]];
  const firstLength = Math.hypot(...firstVector);
  const secondLength = Math.hypot(...secondVector);
  const cross = firstVector[0] * secondVector[1] - firstVector[1] * secondVector[0];
  const dot = firstVector[0] * secondVector[0] + firstVector[1] * secondVector[1];
  const normalizedCross = Math.abs(cross) / Math.max(tolerance.length, firstLength * secondLength);
  if (normalizedCross > tolerance.angle || dot <= 0) {
    throw new Error('Only collinear forward line segments can be merged without changing shape.');
  }
  return { id: mergedId, kind: 'line', startId: first.startId, endId: second.endId };
}

function arcMergeDefinition(first, second, mergedId, tolerance) {
  if (
    first.clockwise !== second.clockwise
    || !pointsNear(first.center, second.center, tolerance.position)
    || Math.abs(first.radius - second.radius) > Math.max(tolerance.position, first.radius * tolerance.relativeRadius)
  ) throw new Error('Only co-circular arcs with the same direction can be merged.');
  return {
    id: mergedId,
    kind: 'arc',
    startId: first.startId,
    endId: second.endId,
    center: [...first.center],
    clockwise: first.clockwise,
  };
}

export function mergePathSegments(pathInput, firstSegmentId, secondSegmentId, options = {}) {
  const tolerance = options.tolerance ?? WORKSHOP_GEOMETRY_TOLERANCE;
  const path = assertCommittedPathTopology(pathInput, tolerance);
  const segments = path.listSegments();
  const firstIndex = segments.findIndex(({ id }) => id === firstSegmentId);
  const secondIndex = segments.findIndex(({ id }) => id === secondSegmentId);
  if (firstIndex < 0 || secondIndex < 0) throw new Error('Both curve segments must exist before merge.');
  if (secondIndex !== firstIndex + 1) throw new Error('Curve merge requires consecutive segments in path order.');
  const first = segments[firstIndex];
  const second = segments[secondIndex];
  if (first.endId !== second.startId) throw new Error('Curve merge segments do not share one endpoint.');
  if (first.kind !== second.kind || first.kind === 'quadratic') {
    throw new Error('Compatible merge currently supports line-line and arc-arc segments.');
  }

  const usedSegmentIds = new Set(segments.map(({ id }) => id));
  usedSegmentIds.delete(first.id);
  usedSegmentIds.delete(second.id);
  const mergedId = options.mergedSegmentId
    ? requireAvailableId(options.mergedSegmentId, usedSegmentIds, CURVE_SEGMENT_ID_PATTERN, 'Merged segment id')
    : defaultDerivedId(first.id, 'merged', CURVE_SEGMENT_ID_PATTERN, usedSegmentIds, 'Merged segment id');
  const mergedDefinition = first.kind === 'line'
    ? lineMergeDefinition(first, second, mergedId, tolerance)
    : arcMergeDefinition(first, second, mergedId, tolerance);

  const firstLength = curveSegmentLength(first, tolerance);
  const secondLength = curveSegmentLength(second, tolerance);
  const totalLength = firstLength + secondLength;
  if (totalLength <= tolerance.length) throw new Error('Merged curve length is below tolerance.');
  const boundary = firstLength / totalLength;

  const json = serializablePath(path);
  json.segments.splice(firstIndex, 2, mergedDefinition);
  const removedPointId = first.endId;
  const stillReferenced = json.segments.some(({ startId, endId }) => (
    startId === removedPointId || endId === removedPointId
  ));
  if (!stillReferenced) json.points = json.points.filter(({ id }) => id !== removedPointId);
  const nextPath = new CurvePath(json, { tolerance });
  const remap = new TopologyRemap([
    {
      sourceSegmentId: first.id,
      sourceRange: [0, 1],
      targetSegmentId: mergedId,
      targetRange: [0, boundary],
    },
    {
      sourceSegmentId: second.id,
      sourceRange: [0, 1],
      targetSegmentId: mergedId,
      targetRange: [boundary, 1],
    },
  ]);
  return Object.freeze({ path: nextPath, remap, removedPointId, segmentId: mergedId });
}

export function pathEndpointDistance(pathInput, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const path = assertCommittedPathTopology(pathInput, tolerance);
  if (path.closed) return 0;
  const segments = path.listSegments();
  return pointDistance(segments[0].start, segments.at(-1).end);
}
