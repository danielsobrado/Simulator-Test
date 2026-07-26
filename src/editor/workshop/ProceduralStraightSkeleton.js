import straightSkeleton from 'straight-skeleton';
import { normalizeFootprintLoop, signedPolygonArea } from './ProceduralWorkshopFootprint.js';

const { SkeletonBuilder } = straightSkeleton;
const EPSILON = 1e-7;

function keyOf(point) {
  return `${point[0].toFixed(9)}:${point[1].toFixed(9)}`;
}

function projectedFaceArea(face) {
  return Math.abs(signedPolygonArea(face.points));
}

/**
 * Synchronous adapter around the pure-JavaScript straight-skeleton engine.
 * The adapter owns validation and returns plain frozen data so no third-party
 * classes leak into recipes, tests, or generated geometry.
 */
export function buildStraightSkeleton(input) {
  const polygon = normalizeFootprintLoop(input);
  let skeleton;
  try {
    skeleton = SkeletonBuilder.BuildFromGeoJSON([[polygon]]);
  } catch (error) {
    throw new Error(`Straight skeleton failed: ${error.message}`, { cause: error });
  }
  if (!skeleton?.Edges?.length) throw new Error('Straight skeleton produced no faces.');

  const distances = new Map();
  for (const [point, distance] of skeleton.Distances.entries()) {
    if (!Number.isFinite(distance) || distance < -EPSILON) {
      throw new Error('Straight skeleton produced an invalid event distance.');
    }
    distances.set(keyOf([point.X, point.Y]), Math.max(0, distance));
  }

  const faces = skeleton.Edges.map((entry, edgeIndex) => {
    const points = normalizeFootprintLoop(entry.Polygon.map((point) => [point.X, point.Y]));
    const vertices = points.map((point) => {
      const distance = distances.get(keyOf(point));
      if (!Number.isFinite(distance)) {
        throw new Error('Straight skeleton omitted a face-vertex distance.');
      }
      return Object.freeze({ point: Object.freeze(point), distance });
    });
    return Object.freeze({
      edgeIndex,
      sourceEdge: Object.freeze([
        Object.freeze([entry.Edge.Begin.X, entry.Edge.Begin.Y]),
        Object.freeze([entry.Edge.End.X, entry.Edge.End.Y]),
      ]),
      points: Object.freeze(points.map((point) => Object.freeze(point))),
      vertices: Object.freeze(vertices),
    });
  });

  const footprintArea = Math.abs(signedPolygonArea(polygon));
  const faceArea = faces.reduce((total, face) => total + projectedFaceArea(face), 0);
  const tolerance = Math.max(1e-6, footprintArea * 1e-7);
  if (Math.abs(faceArea - footprintArea) > tolerance) {
    throw new Error(
      `Straight-skeleton faces do not cover the footprint (${faceArea} vs ${footprintArea}).`,
    );
  }

  return Object.freeze({
    polygon: Object.freeze(polygon.map((point) => Object.freeze(point))),
    faces: Object.freeze(faces),
    footprintArea,
    projectedFaceArea: faceArea,
  });
}
