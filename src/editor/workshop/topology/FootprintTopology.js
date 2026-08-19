import { intersectCurveSegments } from '../curves/CurveIntersections.js';
import { evaluateCurveSegment } from '../curves/CurveSegment.js';
import { WORKSHOP_GEOMETRY_TOLERANCE } from '../curves/GeometryTolerancePolicy.js';
import { assertCommittedPathTopology } from './PathTopology.js';

function sampledBoundary(path, subdivisions) {
  const points = [];
  for (const segment of path.listSegments()) {
    for (let index = 0; index < subdivisions; index += 1) {
      points.push(evaluateCurveSegment(segment, index / subdivisions).point);
    }
  }
  return points;
}

function signedArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current[0] * next[1] - next[0] * current[1];
  }
  return area / 2;
}

function adjacentSegments(leftIndex, rightIndex, count) {
  return Math.abs(leftIndex - rightIndex) === 1
    || (leftIndex === 0 && rightIndex === count - 1);
}

export function analyzeFootprintTopology(pathInput, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const path = assertCommittedPathTopology(pathInput, tolerance);
  if (!path.closed) throw new Error('Footprint topology requires a closed curve path.');
  const segments = path.listSegments();
  const selfIntersections = [];
  for (let leftIndex = 0; leftIndex < segments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < segments.length; rightIndex += 1) {
      if (adjacentSegments(leftIndex, rightIndex, segments.length)) continue;
      const intersections = intersectCurveSegments(segments[leftIndex], segments[rightIndex], tolerance);
      for (const intersection of intersections) {
        selfIntersections.push(Object.freeze({
          leftSegmentId: segments[leftIndex].id,
          rightSegmentId: segments[rightIndex].id,
          point: intersection.point,
        }));
      }
    }
  }
  const boundary = sampledBoundary(path, Math.max(8, Math.floor(tolerance.intersectionSubdivisions / 4)));
  const area = signedArea(boundary);
  if (Math.abs(area) <= tolerance.length * tolerance.length && selfIntersections.length === 0) {
    throw new Error('Footprint topology encloses negligible area.');
  }
  return Object.freeze({
    path,
    signedArea: area,
    area: Math.abs(area),
    winding: area > 0 ? 'counter-clockwise' : 'clockwise',
    selfIntersections: Object.freeze(selfIntersections),
    simple: selfIntersections.length === 0,
  });
}

export function assertSimpleFootprint(pathInput, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const result = analyzeFootprintTopology(pathInput, tolerance);
  if (!result.simple) {
    throw new Error(
      `Footprint topology self-intersects between ${result.selfIntersections[0].leftSegmentId} `
      + `and ${result.selfIntersections[0].rightSegmentId}.`,
    );
  }
  return result;
}
