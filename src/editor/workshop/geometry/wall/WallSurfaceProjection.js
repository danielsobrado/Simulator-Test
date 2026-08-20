import {
  pathCoordinateToPoint,
  pointToPathCoordinate,
} from '../../curves/CurveProjection.js';
import { curvePathMetrics } from '../../curves/CurveSampling.js';
import { WORKSHOP_GEOMETRY_TOLERANCE } from '../../curves/GeometryTolerancePolicy.js';
import { normalizeWallDefinition } from './WallPath.js';

function point3(input) {
  if (!Array.isArray(input) || input.length !== 3 || input.some((value) => !Number.isFinite(value))) {
    throw new Error('Wall surface point must contain three finite coordinates.');
  }
  return input;
}

function surfaceSide(wall, coordinate, height, tolerance) {
  const insideThickness = Math.abs(coordinate.lateral) <= wall.thickness / 2 + tolerance.position;
  if (insideThickness && Math.abs(height - wall.height) <= tolerance.position) return 'top';
  if (insideThickness && Math.abs(height) <= tolerance.position) return 'bottom';
  if (Math.abs(coordinate.lateral) < tolerance.position) return 'center';
  return coordinate.lateral > 0 ? 'a' : 'b';
}

function surfaceNormal(side, pathNormal) {
  if (side === 'top') return Object.freeze([0, 1, 0]);
  if (side === 'bottom') return Object.freeze([0, -1, 0]);
  if (side === 'a') return Object.freeze([pathNormal[0], 0, pathNormal[1]]);
  if (side === 'b') return Object.freeze([-pathNormal[0], 0, -pathNormal[1]]);
  return null;
}

export function projectPointToWallSurface(wallInput, pointInput, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const wall = normalizeWallDefinition(wallInput);
  const point = point3(pointInput);
  const coordinate = pointToPathCoordinate(wall.path, [point[0], point[2]], tolerance);
  const metrics = curvePathMetrics(wall.path, tolerance);
  const height = point[1] - wall.elevation;
  const side = surfaceSide(wall, coordinate, height, tolerance);
  const surfaceId = side === 'center' ? null : `${wall.id}:${coordinate.segmentId}:${side === 'a' || side === 'b' ? `side-${side}` : side}`;
  return Object.freeze({
    wallId: wall.id,
    surfaceId,
    segmentId: coordinate.segmentId,
    segmentParameter: coordinate.segmentParameter,
    distance: coordinate.distance,
    normalizedDistance: metrics.totalLength <= tolerance.length ? 0 : coordinate.distance / metrics.totalLength,
    lateral: coordinate.lateral,
    height,
    normalizedHeight: wall.height <= tolerance.length ? 0 : height / wall.height,
    side,
    centerlinePoint: Object.freeze([coordinate.point[0], wall.elevation + height, coordinate.point[1]]),
    point: Object.freeze([...point]),
    tangent: coordinate.tangent,
    normal: coordinate.normal,
    surfaceNormal: surfaceNormal(side, coordinate.normal),
  });
}

export function wallSurfaceCoordinateToPoint(wallInput, coordinate, tolerance = WORKSHOP_GEOMETRY_TOLERANCE) {
  const wall = normalizeWallDefinition(wallInput);
  if (!coordinate || typeof coordinate !== 'object') throw new Error('Wall surface coordinate must be an object.');
  const lateral = coordinate.lateral ?? 0;
  const height = coordinate.height ?? 0;
  if (!Number.isFinite(lateral) || !Number.isFinite(height)) {
    throw new Error('Wall surface coordinate values must be finite.');
  }
  const planar = pathCoordinateToPoint(wall.path, {
    segmentId: coordinate.segmentId,
    segmentParameter: coordinate.segmentParameter,
    lateral,
  }, tolerance);
  return Object.freeze([planar[0], wall.elevation + height, planar[1]]);
}
