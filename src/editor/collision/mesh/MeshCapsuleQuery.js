import { Box3, Line3, Vector3 } from 'three';
import { INTERSECTED } from 'three-mesh-bvh';
import { PerfCounters } from '../../performance/qa/PerfCounters.js';
import { COLLISION_COUNT_COUNTERS } from '../CollisionPerfCounters.js';
import { createMeshInstanceTransform } from './MeshInstanceTransform.js';

const EPSILON = 1e-8;
const SUPPORT_SAMPLE_RATIO = 0.6;
const QUERY_PADDING = 1e-5;

function normaliseHorizontal(vector) {
  const length = Math.hypot(vector.x, vector.z);
  if (length <= EPSILON) return null;
  return { x: vector.x / length, z: vector.z / length };
}

function localCapsule(capsule, instance) {
  const lower = new Vector3(capsule.x, capsule.segmentMinY, capsule.z)
    .applyMatrix4(instance.inverse);
  const upper = new Vector3(capsule.x, capsule.segmentMaxY, capsule.z)
    .applyMatrix4(instance.inverse);
  return {
    line: new Line3(lower, upper),
    radius: capsule.radius / instance.scale,
  };
}

function queryBoxForLine(line, radius) {
  return new Box3().setFromPoints([line.start, line.end]).expandByScalar(radius + QUERY_PADDING);
}

function orientTriangleNormal(normal, line, trianglePoint, scratch, bounds) {
  line.at(0.5, scratch).sub(trianglePoint);
  if (scratch.lengthSq() <= EPSILON * EPSILON) {
    scratch.set(
      trianglePoint.x - (bounds.minX + bounds.maxX) * 0.5,
      trianglePoint.y - (bounds.minY + bounds.maxY) * 0.5,
      trianglePoint.z - (bounds.minZ + bounds.maxZ) * 0.5,
    );
  }
  if (scratch.lengthSq() > EPSILON * EPSILON && normal.dot(scratch) < 0) normal.negate();
  return normal;
}

export function findMeshSideContact({ capsule, collider, prototype, skinWidth = 0, out = {} }) {
  const resource = prototype?.resource;
  if (!resource?.bvh || resource.disposed) return null;
  const instance = createMeshInstanceTransform(collider.transform);
  const local = localCapsule(capsule, instance);
  const effectiveRadius = local.radius + skinWidth / instance.scale;
  const queryBounds = queryBoxForLine(local.line, effectiveRadius);
  const trianglePoint = new Vector3();
  const segmentPoint = new Vector3();
  const localNormal = new Vector3();
  const orientation = new Vector3();
  const worldNormal = new Vector3();
  let best = null;
  let triangleTests = 0;

  resource.bvh.shapecast({
    intersectsBounds: (box) => (box.intersectsBox(queryBounds) ? INTERSECTED : false),
    intersectsTriangle: (triangle, triangleIndex) => {
      triangleTests += 1;
      const distance = triangle.closestPointToSegment(local.line, trianglePoint, segmentPoint);
      const depth = effectiveRadius - distance;
      if (!(depth > EPSILON)) return false;

      localNormal.subVectors(segmentPoint, trianglePoint);
      if (localNormal.lengthSq() > EPSILON * EPSILON) {
        localNormal.normalize();
      } else {
        triangle.getNormal(localNormal);
        orientTriangleNormal(
          localNormal,
          local.line,
          trianglePoint,
          orientation,
          prototype.bounds,
        );
      }
      worldNormal.copy(localNormal).transformDirection(instance.matrix).normalize();
      const horizontal = normaliseHorizontal(worldNormal);
      if (!horizontal) return false;
      const worldDepth = depth * instance.scale;
      if (!best || worldDepth > best.depth + EPSILON
          || (Math.abs(worldDepth - best.depth) <= EPSILON && triangleIndex < best.triangleIndex)) {
        best = {
          triangleIndex,
          depth: worldDepth,
          normalX: horizontal.x,
          normalZ: horizontal.z,
        };
      }
      return false;
    },
  });

  PerfCounters.inc('collisionMeshQueries');
  PerfCounters.inc('collisionMeshTriangleTests', triangleTests);
  PerfCounters.inc(COLLISION_COUNT_COUNTERS.bvhQueries);
  PerfCounters.inc(COLLISION_COUNT_COUNTERS.triangleTests, triangleTests);
  if (!best) return null;
  PerfCounters.inc('collisionMeshContacts');
  out.sourceId = collider.sourceId;
  out.collider = collider;
  out.normalX = best.normalX;
  out.normalY = 0;
  out.normalZ = best.normalZ;
  out.depth = best.depth;
  out.triangleIndex = best.triangleIndex;
  return out;
}

function barycentricXZ(x, z, triangle) {
  const ax = triangle.a.x;
  const az = triangle.a.z;
  const bx = triangle.b.x;
  const bz = triangle.b.z;
  const cx = triangle.c.x;
  const cz = triangle.c.z;
  const denominator = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
  if (Math.abs(denominator) <= EPSILON) return null;
  const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / denominator;
  const v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / denominator;
  const w = 1 - u - v;
  if (u < -EPSILON || v < -EPSILON || w < -EPSILON) return null;
  return { u, v, w };
}

function sampleOffsets(radius) {
  const offset = radius * SUPPORT_SAMPLE_RATIO;
  return [
    [0, 0],
    [offset, 0],
    [-offset, 0],
    [0, offset],
    [0, -offset],
  ];
}

export function findMeshTopSupport({
  x,
  z,
  radius,
  referenceY,
  maximumUp,
  maximumDown,
  maximumSlopeCosine,
  collider,
  prototype,
}) {
  const resource = prototype?.resource;
  if (!resource?.bvh || resource.disposed) return null;
  const instance = createMeshInstanceTransform(collider.transform);
  const centerLocal = new Vector3(x, referenceY, z).applyMatrix4(instance.inverse);
  const localRadius = radius / instance.scale;
  const localUp = maximumUp / instance.scale;
  const localDown = maximumDown / instance.scale;
  const queryBounds = new Box3(
    new Vector3(
      centerLocal.x - localRadius,
      centerLocal.y - localDown - localRadius,
      centerLocal.z - localRadius,
    ),
    new Vector3(
      centerLocal.x + localRadius,
      centerLocal.y + localUp + localRadius,
      centerLocal.z + localRadius,
    ),
  );
  const worldNormal = new Vector3();
  const worldPoint = new Vector3();
  const samplePoint = new Vector3();
  const offsets = sampleOffsets(radius);
  let best = null;
  let triangleTests = 0;

  resource.bvh.shapecast({
    intersectsBounds: (box) => (box.intersectsBox(queryBounds) ? INTERSECTED : false),
    intersectsTriangle: (triangle, triangleIndex) => {
      triangleTests += 1;
      triangle.getNormal(worldNormal);
      worldNormal.transformDirection(instance.matrix).normalize();
      if (worldNormal.y < maximumSlopeCosine) return false;

      for (const [offsetX, offsetZ] of offsets) {
        samplePoint.set(x + offsetX, referenceY, z + offsetZ).applyMatrix4(instance.inverse);
        const barycentric = barycentricXZ(samplePoint.x, samplePoint.z, triangle);
        if (!barycentric) continue;
        const localY = triangle.a.y * barycentric.u
          + triangle.b.y * barycentric.v
          + triangle.c.y * barycentric.w;
        worldPoint.set(samplePoint.x, localY, samplePoint.z).applyMatrix4(instance.matrix);
        const horizontalDistance = Math.hypot(offsetX, offsetZ);
        const hemisphereRise = Math.sqrt(Math.max(
          0,
          radius * radius - horizontalDistance * horizontalDistance,
        )) - radius;
        const height = worldPoint.y + hemisphereRise;
        if (height > referenceY + maximumUp + EPSILON
            || height < referenceY - maximumDown - EPSILON) {
          continue;
        }
        if (!best || height > best.height + EPSILON
            || (Math.abs(height - best.height) <= EPSILON
              && triangleIndex < best.triangleIndex)) {
          best = {
            triangleIndex,
            height,
            normal: Object.freeze({ x: worldNormal.x, y: worldNormal.y, z: worldNormal.z }),
          };
        }
      }
      return false;
    },
  });

  PerfCounters.inc('collisionMeshSupportQueries');
  PerfCounters.inc('collisionMeshSupportTriangleTests', triangleTests);
  PerfCounters.inc(COLLISION_COUNT_COUNTERS.bvhQueries);
  PerfCounters.inc(COLLISION_COUNT_COUNTERS.triangleTests, triangleTests);
  if (!best) return null;
  PerfCounters.inc('collisionMeshSupportHits');
  return Object.freeze({
    sourceId: collider.sourceId,
    height: best.height,
    normal: best.normal,
    collider,
    triangleIndex: best.triangleIndex,
  });
}
