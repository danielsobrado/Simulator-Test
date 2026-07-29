import * as THREE from 'three';
import { objectCollisionLayers } from '../../ObjectColliderLibrary.js';
import { createCollisionSourceId } from '../CollisionIds.js';
import { COLLISION_LAYERS } from '../CollisionLayers.js';
import { collisionChunkForCanonical, createCanonicalAabb } from '../colliders/ColliderBounds.js';
import {
  COLLIDER_TYPE_BOX,
  COLLIDER_TYPE_CAPSULE,
  COLLIDER_TYPE_SPHERE,
  createPrimitiveCollider,
} from '../colliders/ColliderRecords.js';

const TILT_EPSILON = 1e-6;
const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const LOCAL_BOX = new THREE.Box3();
const WORLD_BOX = new THREE.Box3();
const CONSERVATIVE_BOX = new THREE.Box3();
const POSITION = new THREE.Vector3();
const QUATERNION = new THREE.Quaternion();
const SCALE = new THREE.Vector3();
const LOCAL_MATRIX = new THREE.Matrix4();
const WORLD_MATRIX = new THREE.Matrix4();
const LOCAL_POINT = new THREE.Vector3();
const WORLD_POINT = new THREE.Vector3();
const LOCAL_X = new THREE.Vector3(1, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const TRANSFORMED_UP = new THREE.Vector3();
const BOX_CENTER = new THREE.Vector3();
const BOX_SIZE = new THREE.Vector3();

function layersFor(definition) {
  const key = objectCollisionLayers(definition.collision.policy);
  if (!key || !COLLISION_LAYERS[key]) return null;
  return COLLISION_LAYERS[key];
}

/**
 * The third place this mapping was written by hand, and the third to omit the Z
 * mirroring. It now delegates, so a collider's owner cannot disagree with the
 * chunk `CollisionResidency` loads for the same point.
 */
function ownerChunk(rootMatrix, chunkWorldSize) {
  return Object.freeze(collisionChunkForCanonical(
    rootMatrix.elements[12],
    rootMatrix.elements[14],
    chunkWorldSize,
  ));
}

function canonicalAabbFromBox(box) {
  return createCanonicalAabb({
    minX: box.min.x,
    minY: box.min.y,
    minZ: box.min.z,
    maxX: box.max.x,
    maxY: box.max.y,
    maxZ: box.max.z,
  });
}

function yawFromQuaternion(quaternion) {
  LOCAL_X.set(1, 0, 0).applyQuaternion(quaternion);
  // `+ 0` normalises the negative zero: an unrotated part has `LOCAL_X.z === 0`,
  // and negating it hands `atan2` a -0, which it returns unchanged. That is
  // arithmetically 0 but not `Object.is` equal to it, so an unrotated collider's
  // yaw compared unequal to the 0 it should be.
  return Math.atan2(-LOCAL_X.z, LOCAL_X.x) + 0;
}

function isTilted(quaternion) {
  TRANSFORMED_UP.copy(WORLD_UP).applyQuaternion(quaternion);
  return Math.abs(TRANSFORMED_UP.y) < 1 - TILT_EPSILON;
}

function uprightBoxFromBounds(box) {
  box.getCenter(BOX_CENTER);
  box.getSize(BOX_SIZE);
  return {
    position: [BOX_CENTER.x, BOX_CENTER.y, BOX_CENTER.z],
    rotationY: 0,
    dimensions: [BOX_SIZE.x, BOX_SIZE.y, BOX_SIZE.z],
    aabb: canonicalAabbFromBox(box),
  };
}

function transformedBox(description, rootMatrix) {
  LOCAL_MATRIX.compose(
    POSITION.set(...description.position),
    QUATERNION.setFromAxisAngle(WORLD_UP, description.rotationY),
    UNIT_SCALE,
  );
  WORLD_MATRIX.multiplyMatrices(rootMatrix, LOCAL_MATRIX);
  WORLD_MATRIX.decompose(POSITION, QUATERNION, SCALE);
  LOCAL_BOX.setFromCenterAndSize(
    BOX_CENTER.set(0, 0, 0),
    BOX_SIZE.set(...description.dimensions),
  );
  WORLD_BOX.copy(LOCAL_BOX).applyMatrix4(WORLD_MATRIX);
  if (isTilted(QUATERNION)) return uprightBoxFromBounds(WORLD_BOX);
  return {
    position: [POSITION.x, POSITION.y, POSITION.z],
    rotationY: yawFromQuaternion(QUATERNION),
    dimensions: description.dimensions,
    aabb: canonicalAabbFromBox(WORLD_BOX),
  };
}

function transformedCapsule(description, rootMatrix) {
  LOCAL_POINT.set(...description.position);
  WORLD_POINT.copy(LOCAL_POINT).applyMatrix4(rootMatrix);
  const [radius, height] = description.dimensions;
  LOCAL_BOX.min.set(
    description.position[0] - radius,
    description.position[1],
    description.position[2] - radius,
  );
  LOCAL_BOX.max.set(
    description.position[0] + radius,
    description.position[1] + height,
    description.position[2] + radius,
  );
  WORLD_BOX.copy(LOCAL_BOX).applyMatrix4(rootMatrix);
  rootMatrix.decompose(POSITION, QUATERNION, SCALE);
  if (isTilted(QUATERNION)) {
    WORLD_BOX.getCenter(BOX_CENTER);
    WORLD_BOX.getSize(BOX_SIZE);
    const conservativeRadius = Math.max(BOX_SIZE.x, BOX_SIZE.z) / 2;
    CONSERVATIVE_BOX.min.set(
      BOX_CENTER.x - conservativeRadius,
      WORLD_BOX.min.y,
      BOX_CENTER.z - conservativeRadius,
    );
    CONSERVATIVE_BOX.max.set(
      BOX_CENTER.x + conservativeRadius,
      WORLD_BOX.max.y,
      BOX_CENTER.z + conservativeRadius,
    );
    return {
      position: [BOX_CENTER.x, WORLD_BOX.min.y, BOX_CENTER.z],
      rotationY: 0,
      dimensions: [conservativeRadius, BOX_SIZE.y, conservativeRadius],
      aabb: canonicalAabbFromBox(CONSERVATIVE_BOX),
    };
  }
  return {
    position: [WORLD_POINT.x, WORLD_POINT.y, WORLD_POINT.z],
    rotationY: yawFromQuaternion(QUATERNION),
    dimensions: description.dimensions,
    aabb: canonicalAabbFromBox(WORLD_BOX),
  };
}

function transformedSphere(description, rootMatrix) {
  LOCAL_POINT.set(...description.position);
  WORLD_POINT.copy(LOCAL_POINT).applyMatrix4(rootMatrix);
  const [radiusX, radiusY, radiusZ] = description.dimensions;
  LOCAL_BOX.min.set(
    description.position[0] - radiusX,
    description.position[1] - radiusY,
    description.position[2] - radiusZ,
  );
  LOCAL_BOX.max.set(
    description.position[0] + radiusX,
    description.position[1] + radiusY,
    description.position[2] + radiusZ,
  );
  WORLD_BOX.copy(LOCAL_BOX).applyMatrix4(rootMatrix);
  rootMatrix.decompose(POSITION, QUATERNION, SCALE);
  if (isTilted(QUATERNION)) {
    WORLD_BOX.getCenter(BOX_CENTER);
    WORLD_BOX.getSize(BOX_SIZE);
    return {
      position: [BOX_CENTER.x, BOX_CENTER.y, BOX_CENTER.z],
      rotationY: 0,
      dimensions: [BOX_SIZE.x / 2, BOX_SIZE.y / 2, BOX_SIZE.z / 2],
      aabb: canonicalAabbFromBox(WORLD_BOX),
    };
  }
  return {
    position: [WORLD_POINT.x, WORLD_POINT.y, WORLD_POINT.z],
    rotationY: yawFromQuaternion(QUATERNION),
    dimensions: description.dimensions,
    aabb: canonicalAabbFromBox(WORLD_BOX),
  };
}

function transformDescription(description, rootMatrix) {
  if (description.type === COLLIDER_TYPE_BOX) return transformedBox(description, rootMatrix);
  if (description.type === COLLIDER_TYPE_CAPSULE) return transformedCapsule(description, rootMatrix);
  if (description.type === COLLIDER_TYPE_SPHERE) return transformedSphere(description, rootMatrix);
  throw new Error(`Unsupported object collider type: ${description.type}.`);
}

/**
 * @param options.ownerChunk the chunk the caller has already decided owns this
 *   object. The provider picks an owner from the placement's canonical centre in
 *   order to filter candidates; deriving a second one here from the root matrix
 *   let the two disagree for an object whose centre and origin straddle a chunk
 *   boundary, and `replaceOwnerChunk` rejects the whole batch when they do.
 */
export function createObjectColliderRecords({
  object,
  definition,
  placementResolver,
  placement = null,
  descriptions,
  chunkWorldSize,
  ownerChunk: ownerChunkOverride = null,
}) {
  const layers = layersFor(definition);
  if (layers === null || descriptions.length === 0) return Object.freeze([]);
  const resolvedPlacement = placement ?? placementResolver.resolve(object);
  const rootMatrix = placementResolver.createCanonicalObjectMatrix(
    object,
    resolvedPlacement.surface,
  );
  const owner = ownerChunkOverride ?? ownerChunk(rootMatrix, chunkWorldSize);
  const records = descriptions.map((description) => {
    const transformed = transformDescription(description, rootMatrix);
    return createPrimitiveCollider({
      sourceId: createCollisionSourceId('object', object.id, description.partId),
      type: description.type,
      layers,
      ownerChunkX: owner.chunkX,
      ownerChunkZ: owner.chunkZ,
      aabb: transformed.aabb,
      position: transformed.position,
      rotationY: transformed.rotationY,
      dimensions: transformed.dimensions,
      prototypeId: `object:${definition.key}:${description.partId}`,
    });
  });
  return Object.freeze(records);
}
