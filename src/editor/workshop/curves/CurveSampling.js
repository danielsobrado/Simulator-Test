import { normalizeCurvePath } from './CurvePath.js';
import {
  curveSegmentLength,
  curveSegmentPointAtLength,
} from './CurveSegment.js';
import { WORKSHOP_GEOMETRY_TOLERANCE } from './GeometryTolerancePolicy.js';

export function curvePathMetrics(pathInput, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const path = normalizeCurvePath(pathInput, { tolerance });
  const segments = [];
  let totalLength = 0;
  for (const segment of path.listSegments()) {
    const length = curveSegmentLength(segment, tolerance);
    segments.push(Object.freeze({
      id: segment.id,
      offset: totalLength,
      length,
      end: totalLength + length,
    }));
    totalLength += length;
  }
  return Object.freeze({ path, totalLength, segments: Object.freeze(segments) });
}

function metricForDistance(metrics, distance) {
  if (metrics.segments.length === 0) return null;
  const clamped = Math.max(0, Math.min(metrics.totalLength, distance));
  for (let index = 0; index < metrics.segments.length; index += 1) {
    const metric = metrics.segments[index];
    if (clamped <= metric.end || index === metrics.segments.length - 1) return { metric, clamped };
  }
  return { metric: metrics.segments.at(-1), clamped };
}

export function evaluateCurvePathAtDistance(pathInput, distance, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const metrics = curvePathMetrics(pathInput, tolerance);
  const selected = metricForDistance(metrics, distance);
  if (!selected) {
    return Object.freeze({
      point: Object.freeze([0, 0]),
      tangent: Object.freeze([1, 0]),
      distance: 0,
      normalizedDistance: 0,
      segmentId: null,
      segmentDistance: 0,
      segmentParameter: 0,
    });
  }
  const segment = metrics.path.getSegment(selected.metric.id);
  const localDistance = selected.clamped - selected.metric.offset;
  const evaluated = curveSegmentPointAtLength(segment, localDistance, tolerance);
  return Object.freeze({
    ...evaluated,
    distance: selected.clamped,
    normalizedDistance: metrics.totalLength <= tolerance.length ? 0 : selected.clamped / metrics.totalLength,
    segmentId: segment.id,
    segmentDistance: localDistance,
    segmentParameter: evaluated.parameter,
  });
}

export function sampleCurvePath(pathInput, {
  spacing = 0.5,
  minimumSamples = 2,
  tolerance = WORKSHOP_GEOMETRY_TOLERANCE,
} = {}) {
  if (!Number.isFinite(spacing) || spacing <= 0) throw new Error('Curve sample spacing must be positive.');
  if (!Number.isInteger(minimumSamples) || minimumSamples < 2) {
    throw new Error('Curve minimum sample count must be at least 2.');
  }
  const metrics = curvePathMetrics(pathInput, tolerance);
  if (metrics.totalLength <= tolerance.length) {
    const start = metrics.path.listSegments()[0]?.start ?? [0, 0];
    return Object.freeze([Object.freeze({ distance: 0, point: Object.freeze([...start]) })]);
  }
  const count = Math.max(minimumSamples, Math.ceil(metrics.totalLength / spacing) + 1);
  return Object.freeze(Array.from({ length: count }, (_, index) => {
    const distance = metrics.totalLength * index / (count - 1);
    const result = evaluateCurvePathAtDistance(metrics.path, distance, tolerance);
    return Object.freeze({
      distance,
      segmentId: result.segmentId,
      segmentParameter: result.segmentParameter,
      point: result.point,
      tangent: result.tangent,
    });
  }));
}
