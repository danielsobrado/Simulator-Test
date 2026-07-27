import { Box3, Line3, Vector3 } from 'three';
import { INTERSECTED } from 'three-mesh-bvh';
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
    footY: new Vector3(capsule.x, capsule.y, capsule.z).applyMatrix4(instance.inverse).y,
  };
}

function queryBoxForLine(line, radius) {
  return new Box3().setFromPoints([line.start, line.end]).expandByScalar(radius + QUERY_PADDING);
}

function transformedWorldNormal(localNormal, matrix) {
  return localNormal.clone().transformDirection(matrix).normalize();
}

export function findMeshSideContact({ capsule, collider, prototype, skinWidth = 0, out = {} }) {
  const resource = prototype?.resource;
  if (!resource?.bvh || resource.disposed) return null;
  const instance = createMeshInstanceTransform(collider.transform);
  const local = localCapsule(capsule, instance);
  const localSkin = skinWidth / instance.scale;
  const effectiveRadius = local.radius + localSkin;
  const queryBounds = queryBoxForLine(local.line, effectiveRadius);
  const trianglePoint = new Vector3();
  const segmentPoint = new Vector3();
  const localNormal = new Vector3();
  let best = null;

  resource.bvh.shapecast({
    intersectsBounds: (box) => (box.intersectsBox(queryBounds) ? INTERSECTED : false),
    intersectsTriangle: (triangle, triangleIndex) => {
      const distance = triangle.closestPointToSegment(local.line, trianglePoint, segmentPoint);
      const depth = effectiveRadius - distance;
      if (!(depth > EPSILON)) return false;

      localNormal.subVectors(segmentPoint, trianglePoint);
      let worldNormal;
      if (localNormal.lengthSq() > EPSILON * EPSILON) {
        worldNormal = transformedWorldNormal(localNormal.normalize(), instance.matrix);
      } else {
        triangle.getNormal(localNormal);
        worldNormal = transformedWorldNormal(localNormal, instance.matrix);
      }
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

  if (!best) return null;
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
  let best = null;

  resource.bvh.shapecast({
    intersectsBounds: (box) => (box.intersectsBox(queryBounds) ? INTERSECTED : false),
    intersectsTriangle: (triangle, triangleIndex) => {
      triangle.getNormal(worldNormal);
      worldNormal.transformDirection(instance.matrix).normalize();
      if (worldNormal.y < maximumSlopeCosine) return false;

      for (const [offsetX, offsetZ] of sampleOffsets(radius)) {
        const sampleWorld = new Vector3(x + offsetX, referenceY, z + offsetZ);
        const sampleLocal = sampleWorld.applyMatrix4(instance.inverse);
        const barycentric = barycentricXZ(sampleLocal.x, sampleLocal.z, triangle);
        if (!barycentric) continue;
        const localY = triangle.a.y * barycentric.u
          + triangle.b.y * barycentric.v
          + triangle.c.y * barycentric.w;
        worldPoint.set(sampleLocal.x, localY, sampleLocal.z).applyMatrix4(instance.matrix);
        const horizontalDistance = Math.hypot(offsetX, offsetZ);
        const hemisphereRise = Math.sqrt(Math.max(0, radius * radius
          - horizontalDistance * horizontalDistance)) - radius;
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

  if (!best) return null;
  return Object.freeze({
    sourceId: collider.sourceId,
    height: best.height,
    normal: best.normal,
    collider,
    triangleIndex: best.triangleIndex,
  });
}
