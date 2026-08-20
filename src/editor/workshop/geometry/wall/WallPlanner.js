import { curvePathMetrics, evaluateCurvePathAtDistance } from '../../curves/CurveSampling.js';
import { WORKSHOP_GEOMETRY_TOLERANCE } from '../../curves/GeometryTolerancePolicy.js';
import {
  DEFAULT_WALL_MAX_MITER_RATIO,
  DEFAULT_WALL_SAMPLE_SPACING,
  MAX_WALL_PLAN_SECTIONS,
} from './WallConstants.js';
import { createWallGeometryPlan } from './WallGeometryPlan.js';
import { resolveWallSectionOffsets } from './WallJoins.js';
import { normalizeWallDefinition, resolveWallDefinitionRecords } from './WallPath.js';

function sampleDistances(metrics, spacing, tolerance) {
  const distances = new Set([0, metrics.totalLength]);
  for (const metric of metrics.segments) {
    distances.add(metric.offset);
    distances.add(metric.end);
  }
  const count = Math.ceil(metrics.totalLength / spacing);
  if (count + metrics.segments.length + 1 > MAX_WALL_PLAN_SECTIONS) {
    throw new Error(`Wall plan exceeds ${MAX_WALL_PLAN_SECTIONS} sections.`);
  }
  for (let index = 1; index < count; index += 1) distances.add(Math.min(metrics.totalLength, index * spacing));
  return [...distances]
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right)
    .filter((value, index, values) => index === 0 || value - values[index - 1] > tolerance.length);
}

export function planWall(input, {
  sampleSpacing = DEFAULT_WALL_SAMPLE_SPACING,
  maxMiterRatio = DEFAULT_WALL_MAX_MITER_RATIO,
  tolerance = WORKSHOP_GEOMETRY_TOLERANCE,
} = {}) {
  if (!Number.isFinite(sampleSpacing) || sampleSpacing <= 0) throw new Error('Wall sample spacing must be positive.');
  const wall = normalizeWallDefinition(input);
  const metrics = curvePathMetrics(wall.path, tolerance);
  if (metrics.totalLength <= tolerance.length) throw new Error('Committed wall path is too short to plan.');
  const samples = sampleDistances(metrics, sampleSpacing, tolerance).map((distance) => {
    const evaluated = evaluateCurvePathAtDistance(wall.path, distance, tolerance);
    return Object.freeze({
      distance,
      segmentId: evaluated.segmentId,
      segmentDistance: evaluated.segmentDistance,
      segmentParameter: evaluated.segmentParameter,
      point: evaluated.point,
      tangent: evaluated.tangent,
    });
  });
  const sections = resolveWallSectionOffsets(samples, wall.thickness, { maxMiterRatio });
  return createWallGeometryPlan(wall, sections);
}

export function planWallEntity(entity, options) {
  if (!entity || entity.type !== 'composition-wall') {
    throw new Error('Wall entity planning requires a composition-wall entity.');
  }
  const wall = resolveWallDefinitionRecords(entity.properties?.wall, entity.properties?.primitive);
  if (entity.id !== `composition:${wall.id}`) {
    throw new Error('Wall entity identity does not match its semantic wall id.');
  }
  return planWall(wall, options);
}
