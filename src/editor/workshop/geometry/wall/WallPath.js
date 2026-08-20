import { normalizeCurvePath, serializeCurvePath } from '../../curves/CurvePath.js';
import { curvePathMetrics, evaluateCurvePathAtDistance, sampleCurvePath } from '../../curves/CurveSampling.js';
import { WORKSHOP_GEOMETRY_TOLERANCE } from '../../curves/GeometryTolerancePolicy.js';
import {
  DEFAULT_WALL_LEGACY_SAMPLE_SPACING,
  MAX_WALL_LEGACY_POINTS,
  WALL_DEFINITION_VERSION,
  WALL_PROFILE_KINDS,
  WALL_TOP_FAMILIES,
} from './WallConstants.js';

const WALL_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

function finite(value, field, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function stableId(value, field) {
  if (typeof value !== 'string' || !WALL_ID_PATTERN.test(value)) {
    throw new Error(`${field} must be a stable lowercase identifier.`);
  }
  return value;
}

function enumValue(value, allowed, field) {
  if (!allowed.includes(value)) throw new Error(`${field} is unsupported.`);
  return value;
}

function sameLegacyPrimitive(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createWallDefinitionFromLegacyPrimitive(primitive) {
  if (!primitive || primitive.kind !== 'wall') {
    throw new Error('Legacy wall conversion requires a wall composition primitive.');
  }
  const points = primitive.points.map((position, index) => ({
    id: `p-${index + 1}`,
    position: [...position],
  }));
  const segments = primitive.points.slice(0, -1).map((_, index) => ({
    id: `s-${index + 1}`,
    kind: 'line',
    startId: points[index].id,
    endId: points[index + 1].id,
  }));
  return normalizeWallDefinition({
    version: WALL_DEFINITION_VERSION,
    id: primitive.id,
    path: {
      version: 1,
      id: primitive.id,
      closed: false,
      points,
      segments,
    },
    elevation: primitive.elevation,
    height: primitive.height,
    thickness: primitive.thickness,
    profile: 'rect',
    topFamily: primitive.topFamily,
    style: 'default',
  });
}

export function normalizeWallDefinition(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Wall definition must be an object.');
  }
  const version = input.version ?? WALL_DEFINITION_VERSION;
  if (version !== WALL_DEFINITION_VERSION) throw new Error(`Unsupported wall definition version: ${version}.`);
  const id = stableId(input.id, 'Wall id');
  const path = normalizeCurvePath(input.path, { tolerance: WORKSHOP_GEOMETRY_TOLERANCE });
  if (path.id !== id) throw new Error('Wall path id must match the wall id.');
  if (path.closed) throw new Error('Wall paths must be open.');
  return Object.freeze({
    version,
    id,
    path,
    elevation: finite(input.elevation ?? 0, 'Wall elevation', -32, 128),
    height: finite(input.height ?? 4, 'Wall height', 0.5, 32),
    thickness: finite(input.thickness ?? 0.45, 'Wall thickness', 0.1, 4),
    profile: enumValue(input.profile ?? 'rect', WALL_PROFILE_KINDS, 'Wall profile'),
    topFamily: enumValue(input.topFamily ?? 'plain', WALL_TOP_FAMILIES, 'Wall top family'),
    style: stableId(input.style ?? 'default', 'Wall style'),
  });
}

export function serializeWallDefinition(input) {
  const wall = normalizeWallDefinition(input);
  return {
    version: wall.version,
    id: wall.id,
    path: serializeCurvePath(wall.path),
    elevation: wall.elevation,
    height: wall.height,
    thickness: wall.thickness,
    profile: wall.profile,
    topFamily: wall.topFamily,
    style: wall.style,
  };
}

function exactLinearPoints(path) {
  const segments = path.listSegments();
  if (segments.length === 0 || segments.some(({ kind }) => kind !== 'line')) return null;
  return [segments[0].start, ...segments.map(({ end }) => end)].map((point) => [...point]);
}

function sampledLegacyPoints(path, spacing, maxPoints) {
  const metrics = curvePathMetrics(path);
  const effectiveSpacing = Math.max(spacing, metrics.totalLength / Math.max(1, maxPoints - 1));
  const samples = sampleCurvePath(path, { spacing: effectiveSpacing, minimumSamples: 2 });
  if (samples.length <= maxPoints) return samples.map(({ point }) => [...point]);
  return Array.from({ length: maxPoints }, (_, index) => (
    [...evaluateCurvePathAtDistance(path, metrics.totalLength * index / (maxPoints - 1)).point]
  ));
}

export function wallDefinitionToLegacyPrimitive(input, {
  sampleSpacing = DEFAULT_WALL_LEGACY_SAMPLE_SPACING,
  maxPoints = MAX_WALL_LEGACY_POINTS,
} = {}) {
  const wall = normalizeWallDefinition(input);
  if (!Number.isFinite(sampleSpacing) || sampleSpacing <= 0) {
    throw new Error('Legacy wall sample spacing must be positive.');
  }
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 2 || maxPoints > MAX_WALL_LEGACY_POINTS) {
    throw new Error(`Legacy wall max points must be between 2 and ${MAX_WALL_LEGACY_POINTS}.`);
  }
  const points = exactLinearPoints(wall.path) ?? sampledLegacyPoints(wall.path, sampleSpacing, maxPoints);
  return Object.freeze({
    id: wall.id,
    kind: 'wall',
    points: Object.freeze(points.map((point) => Object.freeze(point))),
    elevation: wall.elevation,
    height: wall.height,
    thickness: wall.thickness,
    topFamily: wall.topFamily,
  });
}

export function resolveWallDefinitionRecords(semanticInput, legacyPrimitive) {
  if (!semanticInput) return createWallDefinitionFromLegacyPrimitive(legacyPrimitive);
  const semantic = normalizeWallDefinition(semanticInput);
  if (!legacyPrimitive) return semantic;
  const projected = wallDefinitionToLegacyPrimitive(semantic);
  if (sameLegacyPrimitive(projected, legacyPrimitive)) return semantic;
  const promoted = createWallDefinitionFromLegacyPrimitive(legacyPrimitive);
  return normalizeWallDefinition({ ...promoted, style: semantic.style });
}
