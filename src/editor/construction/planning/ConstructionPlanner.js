import { normalizeConstructionRecord } from '../ConstructionSchema.js';
import { sampleCubicBezierPath } from '../curve/CubicBezierPath.js';

const DEFAULT_MAX_MODULE_LENGTH = 12;

function interpolate(left, right, targetDistance) {
  const span = right.distance - left.distance;
  const t = span > 1e-9 ? (targetDistance - left.distance) / span : 0;
  const tangentX = left.tangentX + (right.tangentX - left.tangentX) * t;
  const tangentZ = left.tangentZ + (right.tangentZ - left.tangentZ) * t;
  const magnitude = Math.hypot(tangentX, tangentZ) || 1;
  return {
    x: left.x + (right.x - left.x) * t,
    z: left.z + (right.z - left.z) * t,
    tangentX: tangentX / magnitude,
    tangentZ: tangentZ / magnitude,
  };
}

function pointAtDistance(points, distance) {
  if (distance <= points[0].distance) return points[0];
  if (distance >= points.at(-1).distance) return points.at(-1);
  let low = 0;
  let high = points.length - 1;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].distance <= distance) low = middle;
    else high = middle;
  }
  return interpolate(points[low], points[high], distance);
}

function boundsForPoints(points, margin) {
  const bounds = {
    minX: Infinity,
    minZ: Infinity,
    maxX: -Infinity,
    maxZ: -Infinity,
  };
  for (const point of points) {
    bounds.minX = Math.min(bounds.minX, point.x - margin);
    bounds.minZ = Math.min(bounds.minZ, point.z - margin);
    bounds.maxX = Math.max(bounds.maxX, point.x + margin);
    bounds.maxZ = Math.max(bounds.maxZ, point.z + margin);
  }
  return bounds;
}

export function planConstruction(input, {
  maxModuleLength = DEFAULT_MAX_MODULE_LENGTH,
  terrainSamples = [],
} = {}) {
  const record = normalizeConstructionRecord(input);
  if (record.path.type !== 'cubicBezier') {
    throw new Error('The live construction planner currently requires a cubic Bézier path.');
  }
  if (!(maxModuleLength >= 1)) throw new Error('Maximum construction module length is invalid.');
  const sampled = sampleCubicBezierPath(record.path);
  const modules = [];
  for (const segment of record.path.segments) {
    const segmentPoints = sampled.points.filter(({ segmentId }) => segmentId === segment.id);
    if (segmentPoints.length < 2) continue;
    const startDistance = segmentPoints[0].distance;
    const endDistance = segmentPoints.at(-1).distance;
    const length = endDistance - startDistance;
    const count = Math.max(1, Math.ceil(length / maxModuleLength));
    for (let index = 0; index < count; index += 1) {
      const from = startDistance + length * index / count;
      const to = startDistance + length * (index + 1) / count;
      const middle = pointAtDistance(sampled.points, (from + to) / 2);
      const relevant = sampled.points.filter(({ distance }) => distance >= from && distance <= to);
      const endpoints = [pointAtDistance(sampled.points, from), pointAtDistance(sampled.points, to)];
      const modulePoints = [...endpoints.slice(0, 1), ...relevant, ...endpoints.slice(1)];
      modules.push(Object.freeze({
        id: `${segment.id}-span-${index + 1}`,
        kind: 'curved-span',
        segmentId: segment.id,
        pathInterval: Object.freeze([from, to]),
        frame: Object.freeze({
          origin: Object.freeze([middle.x, middle.z]),
          tangent: Object.freeze([middle.tangentX, middle.tangentZ]),
          outward: Object.freeze([-middle.tangentZ, middle.tangentX]),
        }),
        dimensions: record.dimensions,
        bounds: Object.freeze(boundsForPoints(modulePoints, record.dimensions.thickness / 2)),
        openingIds: Object.freeze(record.features
          .filter(({ segmentId }) => segmentId === segment.id)
          .map(({ id }) => id)),
      }));
    }
  }
  return Object.freeze({
    version: 1,
    constructionId: record.id,
    constructionRevision: record.revision,
    totalLength: sampled.totalDistance,
    modules: Object.freeze(modules),
    terrainSamples: Object.freeze(structuredClone(terrainSamples)),
    bounds: Object.freeze(boundsForPoints(
      sampled.points,
      record.dimensions.thickness / 2,
    )),
    stats: Object.freeze({
      sampleCount: sampled.points.length,
      moduleCount: modules.length,
      openingCount: record.features.length,
    }),
  });
}

