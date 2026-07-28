import * as THREE from 'three';
import { objectCollisionLayers } from '../../ObjectColliderLibrary.js';
import { createCollisionSourceId } from '../CollisionIds.js';
import { COLLISION_LAYERS } from '../CollisionLayers.js';
import { createCanonicalAabb } from '../colliders/ColliderBounds.js';
import {
  COLLIDER_TYPE_BOX,
  COLLIDER_TYPE_CAPSULE,
  COLLIDER_TYPE_SPHERE,
  createPrimitiveCollider,
} from '../colliders/ColliderRecords.js';

const UNIT_SCALE = new THREE.Vector3(1, 1, 1);
const LOCAL_BOX = new THREE.Box3();
const WORLD_BOX = new THREE.Box3();
const POSITION = new THREE.Vector3();
const QUATERNION = new THREE.Quaternion();
const SCALE = new THREE.Vector3();
const LOCAL_MATRIX = new THREE.Matrix4();
const WORLD_MATRIX = new THREE.Matrix4();
const LOCAL_POINT = new THREE.Vector3();
const WORLD_POINT = new THREE.Vector3();
const LOCAL_X = new THREE.Vector3(1, 0, 0);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function layersFor(definition) {
  const key = objectCollisionLayers(definition.collision.policy);
  if (!key || !COLLISION_LAYERS[key]) return null;
  return COLLISION_LAYERS[key];
}

function ownerChunk(rootMatrix, chunkWorldSize) {
  return Object.freeze({
    chunkX: Math.floor(rootMatrix.elements[12] / chunkWorldSize),
    chunkZ: Math.floor(rootMatrix.elements[14] / chunkWorldSize),
  });
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
  return Math.atan2(-LOCAL_X.z, LOCAL_X.x);
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
    new THREE.Vector3(),
    new THREE.Vector3(...description.dimensions),
  );
  WORLD_BOX.copy(LOCAL_BOX).applyMatrix4(WORLD_MATRIX);
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
  LOCAL_BOX.min.set(description.position[0] - radius, description.position[1], description.position[2] - radius);
  LOCAL_BOX.max.set(description.position[0] + radius, description.position[1] + height, description.position[2] + radius);
  WORLD_BOX.copy(LOCAL_BOX).applyMatrix4(rootMatrix);
  rootMatrix.decompose(POSITION, QUATERNION, SCALE);
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

export function createObjectColliderRecords({
  object,
  definition,
  placementResolver,
  descriptions,
  chunkWorldSize,
}) {
  const layers = layersFor(definition);
  if (layers === null || descriptions.length === 0) return Object.freeze([]);
  const placement = placementResolver.resolve(object);
  const rootMatrix = placementResolver.createCanonicalObjectMatrix(object, placement.surface);
  const owner = ownerChunk(rootMatrix, chunkWorldSize);
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
