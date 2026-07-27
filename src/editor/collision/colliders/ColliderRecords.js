import { COLLISION_LAYERS } from '../CollisionLayers.js';
import { createCanonicalAabb } from './ColliderBounds.js';

export const COLLIDER_TYPE_SPHERE = 'sphere';
export const COLLIDER_TYPE_CAPSULE = 'capsule';
export const COLLIDER_TYPE_BOX = 'box';
export const COLLIDER_TYPE_MESH_INSTANCE = 'mesh-instance';

const PRIMITIVE_TYPES = new Set([
  COLLIDER_TYPE_SPHERE,
  COLLIDER_TYPE_CAPSULE,
  COLLIDER_TYPE_BOX,
]);

function freezeVector(value, name, dimensions = 3) {
  if (!Array.isArray(value) || value.length !== dimensions
      || value.some((entry) => !Number.isFinite(entry))) {
    throw new Error(`Collision ${name} must contain ${dimensions} finite values.`);
  }
  return Object.freeze([...value]);
}

function commonRecord({ sourceId, type, layers, ownerChunkX, ownerChunkZ, aabb }) {
  if (!sourceId || typeof sourceId !== 'string') throw new Error('Collider sourceId is required.');
  if (!Number.isSafeInteger(ownerChunkX) || !Number.isSafeInteger(ownerChunkZ)) {
    throw new Error('Collider owner chunk coordinates must be safe integers.');
  }
  if (!Number.isInteger(layers) || layers <= 0) throw new Error('Collider layers must be positive.');
  return {
    sourceId,
    type,
    layers,
    ownerChunkX,
    ownerChunkZ,
    aabb: createCanonicalAabb(aabb),
  };
}

export function createPrimitiveCollider({
  sourceId,
  type,
  layers = COLLISION_LAYERS.blocking,
  ownerChunkX,
  ownerChunkZ,
  aabb,
  position,
  rotationY = 0,
  dimensions,
  prototypeId = null,
}) {
  if (!PRIMITIVE_TYPES.has(type)) throw new Error(`Unsupported primitive collider type: ${type}.`);
  if (!Number.isFinite(rotationY)) throw new Error('Collider rotationY must be finite.');
  return Object.freeze({
    ...commonRecord({ sourceId, type, layers, ownerChunkX, ownerChunkZ, aabb }),
    position: freezeVector(position, 'position'),
    rotationY,
    dimensions: freezeVector(dimensions, 'dimensions'),
    prototypeId: prototypeId == null ? null : String(prototypeId),
  });
}

export function createMeshInstanceCollider({
  sourceId,
  layers = COLLISION_LAYERS.solid,
  ownerChunkX,
  ownerChunkZ,
  aabb,
  prototypeId,
  transform,
}) {
  if (!prototypeId) throw new Error('Mesh-instance collider prototypeId is required.');
  return Object.freeze({
    ...commonRecord({
      sourceId,
      type: COLLIDER_TYPE_MESH_INSTANCE,
      layers,
      ownerChunkX,
      ownerChunkZ,
      aabb,
    }),
    prototypeId: String(prototypeId),
    transform: freezeVector(transform, 'transform', 16),
  });
}

export function createColliderPrototype({ id, kind, bounds, metadata = {} }) {
  if (!id) throw new Error('Collider prototype id is required.');
  if (!kind) throw new Error('Collider prototype kind is required.');
  return Object.freeze({
    id: String(id),
    kind: String(kind),
    bounds: createCanonicalAabb(bounds),
    metadata: Object.freeze({ ...metadata }),
  });
}
