import {
  CURVE_PATH_ID_PATTERN,
  CURVE_PATH_VERSION,
  CURVE_POINT_ID_PATTERN,
  MAX_CURVE_POINTS,
  MAX_CURVE_SEGMENTS,
} from './CurveKernelConstants.js';
import { finitePoint2, WORKSHOP_GEOMETRY_TOLERANCE } from './GeometryTolerancePolicy.js';
import { normalizeCurveSegment, serializeCurveSegment } from './CurveSegment.js';

function requireId(value, pattern, field) {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error(`${field} must be a stable lowercase identifier.`);
  }
  return value;
}

function normalizePoint(input, index) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`Curve point ${index + 1} must be an object.`);
  }
  return Object.freeze({
    id: requireId(input.id, CURVE_POINT_ID_PATTERN, `Curve point ${index + 1} id`),
    position: finitePoint2(input.position, `Curve point ${index + 1} position`),
  });
}

function validatePathOrder(segments, closed) {
  for (let index = 1; index < segments.length; index += 1) {
    if (segments[index - 1].endId !== segments[index].startId) {
      throw new Error(`Curve path is disconnected between ${segments[index - 1].id} and ${segments[index].id}.`);
    }
  }
  if (closed && segments.length > 0 && segments.at(-1).endId !== segments[0].startId) {
    throw new Error('Closed curve path does not join its final segment to its first segment.');
  }
  if (!closed && segments.length > 1 && segments.at(-1).endId === segments[0].startId) {
    throw new Error('Open curve path cannot close back onto its first point.');
  }
}

export class CurvePath {
  #points;
  #segments;

  constructor(input = {}, {
    tolerance = WORKSHOP_GEOMETRY_TOLERANCE,
    preview = false,
  } = {}) {
    if (input instanceof CurvePath) return input;
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new Error('Curve path must be an object.');
    }
    const version = input.version ?? CURVE_PATH_VERSION;
    if (version !== CURVE_PATH_VERSION) throw new Error(`Unsupported curve path version: ${version}.`);
    const pointsInput = input.points ?? [];
    const segmentsInput = input.segments ?? [];
    if (!Array.isArray(pointsInput) || pointsInput.length > MAX_CURVE_POINTS) {
      throw new Error(`Curve path supports at most ${MAX_CURVE_POINTS} control points.`);
    }
    if (!Array.isArray(segmentsInput) || segmentsInput.length > MAX_CURVE_SEGMENTS) {
      throw new Error(`Curve path supports at most ${MAX_CURVE_SEGMENTS} segments.`);
    }
    if (segmentsInput.length === 0 && !preview) throw new Error('Committed curve path requires at least one segment.');

    const points = new Map();
    for (let index = 0; index < pointsInput.length; index += 1) {
      const point = normalizePoint(pointsInput[index], index);
      if (points.has(point.id)) throw new Error(`Duplicate curve point id: ${point.id}.`);
      points.set(point.id, point);
    }

    const segments = [];
    const segmentIds = new Set();
    for (const inputSegment of segmentsInput) {
      const segment = normalizeCurveSegment(inputSegment, points, { tolerance, preview });
      if (segmentIds.has(segment.id)) throw new Error(`Duplicate curve segment id: ${segment.id}.`);
      segmentIds.add(segment.id);
      segments.push(segment);
    }
    validatePathOrder(segments, input.closed === true);

    const referenced = new Set(segments.flatMap((segment) => [segment.startId, segment.endId]));
    for (const pointId of points.keys()) {
      if (!referenced.has(pointId)) throw new Error(`Curve point ${pointId} is not referenced by the path.`);
    }

    this.version = version;
    this.id = requireId(input.id, CURVE_PATH_ID_PATTERN, 'Curve path id');
    this.closed = input.closed === true;
    this.#points = points;
    this.#segments = Object.freeze(segments);
    Object.freeze(this);
  }

  get pointCount() {
    return this.#points.size;
  }

  get segmentCount() {
    return this.#segments.length;
  }

  getPoint(id) {
    return this.#points.get(id) ?? null;
  }

  getSegment(id) {
    return this.#segments.find((segment) => segment.id === id) ?? null;
  }

  listPoints() {
    return [...this.#points.values()].sort((left, right) => left.id.localeCompare(right.id));
  }

  listSegments() {
    return this.#segments;
  }

  toJSON() {
    return {
      version: this.version,
      id: this.id,
      closed: this.closed,
      points: this.listPoints().map((point) => ({ id: point.id, position: [...point.position] })),
      segments: this.#segments.map(serializeCurveSegment),
    };
  }
}

export function normalizeCurvePath(input, options) {
  return input instanceof CurvePath ? input : new CurvePath(input, options);
}

export function serializeCurvePath(input, options) {
  return normalizeCurvePath(input, options).toJSON();
}
