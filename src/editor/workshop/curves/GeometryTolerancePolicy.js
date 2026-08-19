import { DEFAULT_GEOMETRY_TOLERANCE } from './CurveKernelConstants.js';

function positiveFinite(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive finite number.`);
  }
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isInteger(value) || value < 4 || value > 4096) {
    throw new Error(`${field} must be an integer from 4 to 4096.`);
  }
  return value;
}

export function createGeometryTolerancePolicy(overrides = {}) {
  if (overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw new Error('Geometry tolerance overrides must be an object.');
  }
  return Object.freeze({
    position: positiveFinite(overrides.position ?? DEFAULT_GEOMETRY_TOLERANCE.position, 'Position tolerance'),
    length: positiveFinite(overrides.length ?? DEFAULT_GEOMETRY_TOLERANCE.length, 'Length tolerance'),
    parameter: positiveFinite(overrides.parameter ?? DEFAULT_GEOMETRY_TOLERANCE.parameter, 'Parameter tolerance'),
    angle: positiveFinite(overrides.angle ?? DEFAULT_GEOMETRY_TOLERANCE.angle, 'Angle tolerance'),
    intersection: positiveFinite(
      overrides.intersection ?? DEFAULT_GEOMETRY_TOLERANCE.intersection,
      'Intersection tolerance',
    ),
    relativeRadius: positiveFinite(
      overrides.relativeRadius ?? DEFAULT_GEOMETRY_TOLERANCE.relativeRadius,
      'Relative radius tolerance',
    ),
    projectionIterations: positiveInteger(
      overrides.projectionIterations ?? DEFAULT_GEOMETRY_TOLERANCE.projectionIterations,
      'Projection iterations',
    ),
    bezierSubdivisions: positiveInteger(
      overrides.bezierSubdivisions ?? DEFAULT_GEOMETRY_TOLERANCE.bezierSubdivisions,
      'Bezier subdivisions',
    ),
    intersectionSubdivisions: positiveInteger(
      overrides.intersectionSubdivisions ?? DEFAULT_GEOMETRY_TOLERANCE.intersectionSubdivisions,
      'Intersection subdivisions',
    ),
  });
}

export const WORKSHOP_GEOMETRY_TOLERANCE = createGeometryTolerancePolicy();

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function nearlyEqual(left, right, tolerance = WORKSHOP_GEOMETRY_TOLERANCE.position) {
  return Math.abs(left - right) <= tolerance;
}

export function pointDistanceSquared(left, right) {
  const dx = left[0] - right[0];
  const dz = left[1] - right[1];
  return dx * dx + dz * dz;
}

export function pointDistance(left, right) {
  return Math.sqrt(pointDistanceSquared(left, right));
}

export function pointsNear(left, right, tolerance = WORKSHOP_GEOMETRY_TOLERANCE.position) {
  return pointDistanceSquared(left, right) <= tolerance * tolerance;
}

export function finitePoint2(value, field = 'Point') {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) {
    throw new Error(`${field} must contain two finite coordinates.`);
  }
  return Object.freeze([value[0], value[1]]);
}
