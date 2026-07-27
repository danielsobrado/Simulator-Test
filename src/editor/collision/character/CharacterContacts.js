import { COLLISION_LAYER_WALKABLE } from '../CollisionLayers.js';
import {
  COLLIDER_TYPE_BOX,
  COLLIDER_TYPE_CAPSULE,
  COLLIDER_TYPE_SPHERE,
} from '../colliders/ColliderRecords.js';

const CONTACT_EPSILON = 1e-9;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalise2(x, z) {
  const length = Math.hypot(x, z);
  if (length <= CONTACT_EPSILON) return { x: 1, z: 0 };
  return { x: x / length, z: z / length };
}

function verticalOverlap(capsule, collider, skinWidth) {
  const minimum = capsule.y + Math.min(skinWidth, capsule.radius);
  const maximum = capsule.y + capsule.bodyHeight - Math.min(skinWidth, capsule.radius);
  return maximum > collider.aabb.minY + CONTACT_EPSILON
    && minimum < collider.aabb.maxY - CONTACT_EPSILON;
}

function worldToBoxLocal(collider, x, z) {
  const dx = x - collider.position[0];
  const dz = z - collider.position[2];
  const cosine = Math.cos(collider.rotationY);
  const sine = Math.sin(collider.rotationY);
  return {
    x: cosine * dx - sine * dz,
    z: sine * dx + cosine * dz,
    cosine,
    sine,
  };
}

function localNormalToWorld(localX, localZ, cosine, sine) {
  return normalise2(
    cosine * localX + sine * localZ,
    -sine * localX + cosine * localZ,
  );
}

function intervalGap(minimumA, maximumA, minimumB, maximumB) {
  if (maximumA < minimumB) return minimumB - maximumA;
  if (maximumB < minimumA) return minimumA - maximumB;
  return 0;
}

function radialContact({
  capsule,
  collider,
  colliderRadius,
  colliderSegmentMinY,
  colliderSegmentMaxY,
  skinWidth,
  out,
}) {
  const combinedRadius = capsule.radius + colliderRadius;
  const verticalGap = intervalGap(
    capsule.segmentMinY,
    capsule.segmentMaxY,
    colliderSegmentMinY,
    colliderSegmentMaxY,
  );
  if (verticalGap >= combinedRadius + skinWidth - CONTACT_EPSILON) return null;

  const effectiveRadius = combinedRadius + skinWidth;
  const allowedHorizontal = Math.sqrt(Math.max(
    0,
    effectiveRadius * effectiveRadius - verticalGap * verticalGap,
  ));
  if (allowedHorizontal <= CONTACT_EPSILON) return null;

  const dx = capsule.x - collider.position[0];
  const dz = capsule.z - collider.position[2];
  const distance = Math.hypot(dx, dz);
  const depth = allowedHorizontal - distance;
  if (!(depth > CONTACT_EPSILON)) return null;
  const normal = normalise2(dx, dz);
  out.sourceId = collider.sourceId;
  out.collider = collider;
  out.normalX = normal.x;
  out.normalY = 0;
  out.normalZ = normal.z;
  out.depth = depth;
  return out;
}

function ellipsoidContact(capsule, collider, skinWidth, out) {
  const local = worldToBoxLocal(collider, capsule.x, capsule.z);
  const combinedY = collider.dimensions[1] + capsule.radius + skinWidth;
  const verticalGap = intervalGap(
    capsule.segmentMinY,
    capsule.segmentMaxY,
    collider.position[1],
    collider.position[1],
  );
  if (verticalGap >= combinedY - CONTACT_EPSILON) return null;
  const verticalScale = Math.sqrt(Math.max(
    0,
    1 - (verticalGap * verticalGap) / (combinedY * combinedY),
  ));
  const combinedX = (collider.dimensions[0] + capsule.radius + skinWidth) * verticalScale;
  const combinedZ = (collider.dimensions[2] + capsule.radius + skinWidth) * verticalScale;
  if (combinedX <= CONTACT_EPSILON || combinedZ <= CONTACT_EPSILON) return null;

  const normalized = Math.hypot(local.x / combinedX, local.z / combinedZ);
  if (normalized >= 1 - CONTACT_EPSILON) return null;

  let localNormalX;
  let localNormalZ;
  let depth;
  if (normalized <= CONTACT_EPSILON) {
    if (combinedX <= combinedZ) {
      localNormalX = 1;
      localNormalZ = 0;
      depth = combinedX;
    } else {
      localNormalX = 0;
      localNormalZ = 1;
      depth = combinedZ;
    }
  } else {
    const boundaryScale = 1 / normalized;
    const deltaX = local.x * boundaryScale - local.x;
    const deltaZ = local.z * boundaryScale - local.z;
    depth = Math.hypot(deltaX, deltaZ);
    if (!(depth > CONTACT_EPSILON)) return null;
    localNormalX = deltaX / depth;
    localNormalZ = deltaZ / depth;
  }

  const normal = localNormalToWorld(localNormalX, localNormalZ, local.cosine, local.sine);
  out.sourceId = collider.sourceId;
  out.collider = collider;
  out.normalX = normal.x;
  out.normalY = 0;
  out.normalZ = normal.z;
  out.depth = depth;
  return out;
}

function capsuleContact(capsule, collider, skinWidth, out) {
  const radius = collider.dimensions[0];
  const height = collider.dimensions[1];
  const segmentMinY = collider.position[1] + Math.min(radius, height / 2);
  const segmentMaxY = collider.position[1] + Math.max(radius, height - radius);
  return radialContact({
    capsule,
    collider,
    colliderRadius: radius,
    colliderSegmentMinY: segmentMinY,
    colliderSegmentMaxY: segmentMaxY,
    skinWidth,
    out,
  });
}

function boxContact(capsule, collider, skinWidth, out) {
  const local = worldToBoxLocal(collider, capsule.x, capsule.z);
  const halfX = collider.dimensions[0] / 2;
  const halfZ = collider.dimensions[2] / 2;
  const closestX = clamp(local.x, -halfX, halfX);
  const closestZ = clamp(local.z, -halfZ, halfZ);
  const deltaX = local.x - closestX;
  const deltaZ = local.z - closestZ;
  const effectiveRadius = capsule.radius + skinWidth;
  const distance = Math.hypot(deltaX, deltaZ);

  let localNormalX;
  let localNormalZ;
  let depth;
  if (distance > CONTACT_EPSILON) {
    depth = effectiveRadius - distance;
    if (!(depth > CONTACT_EPSILON)) return null;
    localNormalX = deltaX / distance;
    localNormalZ = deltaZ / distance;
  } else {
    const escapeX = halfX + effectiveRadius - Math.abs(local.x);
    const escapeZ = halfZ + effectiveRadius - Math.abs(local.z);
    if (escapeX <= escapeZ) {
      localNormalX = local.x < 0 ? -1 : 1;
      localNormalZ = 0;
      depth = escapeX;
    } else {
      localNormalX = 0;
      localNormalZ = local.z < 0 ? -1 : 1;
      depth = escapeZ;
    }
  }

  const normal = localNormalToWorld(localNormalX, localNormalZ, local.cosine, local.sine);
  out.sourceId = collider.sourceId;
  out.collider = collider;
  out.normalX = normal.x;
  out.normalY = 0;
  out.normalZ = normal.z;
  out.depth = depth;
  return out;
}

export function findPrimitiveSideContact(
  capsule,
  collider,
  skinWidth = 0,
  out = {},
) {
  if (!Number.isFinite(skinWidth) || skinWidth < 0) {
    throw new Error('Character contact skinWidth must be non-negative.');
  }
  if (!verticalOverlap(capsule, collider, skinWidth)) return null;

  if (collider.type === COLLIDER_TYPE_BOX) {
    return boxContact(capsule, collider, skinWidth, out);
  }
  if (collider.type === COLLIDER_TYPE_SPHERE) {
    return ellipsoidContact(capsule, collider, skinWidth, out);
  }
  if (collider.type === COLLIDER_TYPE_CAPSULE) {
    return capsuleContact(capsule, collider, skinWidth, out);
  }
  return null;
}

export function capsuleOverlapsPrimitive(capsule, collider, skinWidth = 0) {
  return findPrimitiveSideContact(capsule, collider, skinWidth, {}) !== null;
}

function boxTopSupport({ x, z, radius, collider }) {
  const local = worldToBoxLocal(collider, x, z);
  const halfX = collider.dimensions[0] / 2;
  const halfZ = collider.dimensions[2] / 2;
  if (halfX < radius || halfZ < radius) return null;
  const reachX = halfX + radius * 0.25;
  const reachZ = halfZ + radius * 0.25;
  if (Math.abs(local.x) > reachX || Math.abs(local.z) > reachZ) return null;
  return {
    sourceId: collider.sourceId,
    height: collider.aabb.maxY,
    normal: Object.freeze({ x: 0, y: 1, z: 0 }),
    collider,
  };
}

function sphereTopSupport({ x, z, radius, collider }) {
  const local = worldToBoxLocal(collider, x, z);
  const radiusX = collider.dimensions[0];
  const radiusY = collider.dimensions[1];
  const radiusZ = collider.dimensions[2];
  const combinedX = radiusX + radius;
  const combinedY = radiusY + radius;
  const combinedZ = radiusZ + radius;
  const radial = (local.x * local.x) / (combinedX * combinedX)
    + (local.z * local.z) / (combinedZ * combinedZ);
  if (radial > 1) return null;
  const root = Math.sqrt(Math.max(0, 1 - radial));
  const height = collider.position[1] + combinedY * root - radius;
  const gradientX = local.x / (combinedX * combinedX);
  const gradientY = root / Math.max(CONTACT_EPSILON, combinedY);
  const gradientZ = local.z / (combinedZ * combinedZ);
  const length = Math.hypot(gradientX, gradientY, gradientZ);
  const horizontal = localNormalToWorld(gradientX, gradientZ, local.cosine, local.sine);
  return {
    sourceId: collider.sourceId,
    height,
    normal: Object.freeze({
      x: horizontal.x * Math.hypot(gradientX, gradientZ) / length,
      y: gradientY / length,
      z: horizontal.z * Math.hypot(gradientX, gradientZ) / length,
    }),
    collider,
  };
}

function capsuleTopSupport({ x, z, radius, collider }) {
  const colliderRadius = collider.dimensions[0];
  const colliderHeight = collider.dimensions[1];
  const combinedRadius = colliderRadius + radius;
  const dx = x - collider.position[0];
  const dz = z - collider.position[2];
  const radialSquared = dx * dx + dz * dz;
  if (radialSquared > combinedRadius * combinedRadius) return null;
  const vertical = Math.sqrt(Math.max(0, combinedRadius * combinedRadius - radialSquared));
  const topCenterY = collider.position[1] + Math.max(
    colliderRadius,
    colliderHeight - colliderRadius,
  );
  const normalLength = Math.max(CONTACT_EPSILON, combinedRadius);
  return {
    sourceId: collider.sourceId,
    height: topCenterY + vertical - radius,
    normal: Object.freeze({
      x: dx / normalLength,
      y: vertical / normalLength,
      z: dz / normalLength,
    }),
    collider,
  };
}

export function findPrimitiveTopSupport({
  x,
  z,
  radius,
  collider,
  maximumSlopeCosine = 0,
}) {
  if ((collider.layers & COLLISION_LAYER_WALKABLE) === 0) return null;
  let support = null;
  if (collider.type === COLLIDER_TYPE_BOX) {
    support = boxTopSupport({ x, z, radius, collider });
  } else if (collider.type === COLLIDER_TYPE_SPHERE) {
    support = sphereTopSupport({ x, z, radius, collider });
  } else if (collider.type === COLLIDER_TYPE_CAPSULE) {
    support = capsuleTopSupport({ x, z, radius, collider });
  }
  if (!support || support.normal.y < maximumSlopeCosine) return null;
  return Object.freeze(support);
}
