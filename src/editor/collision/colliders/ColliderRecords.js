import { COLLISION_LAYERS } from '../CollisionLayers.js';
import { createCanonicalAabb } from './ColliderBounds.js';

export const COLLIDER_TYPE_SPHERE = 'sphere';
export const COLLIDER_TYPE_CAPSULE = 'capsule';
export const COLLIDER_TYPE_BOX = 'box';
export const COLLIDER_TYPE_MESH_INSTANCE = 'mesh-instance';

const COLLIDER_RECORD_BRAND = Symbol('collision-record');
const COLLIDER_PROTOTYPE_BRAND = Symbol('collision-prototype');
const PRIMITIVE_TYPES = new Set([
  COLLIDER_TYPE_SPHERE,
  COLLIDER_TYPE_CAPSULE,
  COLLIDER_TYPE_BOX,
]);

export function isColliderRecordDescriptor(value) {
  return value?.[COLLIDER_RECORD_BRAND] === true;
}

export function isColliderPrototypeDescriptor(value) {
  return value?.[COLLIDER_PROTOTYPE_BRAND] === true;
}

function freezeVector(value, name, dimensions = 3, { positive = false } = {}) {
  if (!Array.isArray(value) || value.length !== dimensions
      || value.some((entry) => !Number.isFinite(entry) || (positive && entry <= 0))) {
    const qualifier = positive ? 'positive finite' : 'finite';
    throw new Error(`Collision ${name} must contain ${dimensions} ${qualifier} values.`);
  }
  return Object.freeze([...value]);
}

function cloneMetadata(value, path = 'metadata', ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Collision ${path} numbers must be finite.`);
    return value;
  }
  if (!value || typeof value !== 'object') {
    throw new Error(`Collision ${path} must contain JSON-like values.`);
  }
  if (ancestors.has(value)) throw new Error(`Collision ${path} must not contain cycles.`);

  ancestors.add(value);
  let clone;
  if (Array.isArray(value)) {
    clone = value.map((entry, index) => cloneMetadata(entry, `${path}[${index}]`, ancestors));
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`Collision ${path} must contain plain objects.`);
    }
    clone = {};
    for (const [key, entry] of Object.entries(value)) {
      Object.defineProperty(clone, key, {
        value: cloneMetadata(entry, `${path}.${key}`, ancestors),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
  }
  ancestors.delete(value);
  return Object.freeze(clone);
}

function commonRecord({ sourceId, type, layers, ownerChunkX, ownerChunkZ, aabb }) {
  if (typeof sourceId !== 'string' || !sourceId.trim()) {
    throw new Error('Collider sourceId is required.');
  }
  if (!Number.isSafeInteger(ownerChunkX) || !Number.isSafeInteger(ownerChunkZ)) {
    throw new Error('Collider owner chunk coordinates must be safe integers.');
  }
  if (!Number.isSafeInteger(layers) || layers <= 0 || layers > COLLISION_LAYERS.all) {
    throw new Error('Collider layers must contain supported collision-layer bits.');
  }
  return {
    [COLLIDER_RECORD_BRAND]: true,
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
    dimensions: freezeVector(dimensions, 'dimensions', 3, { positive: true }),
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

export function createColliderPrototype({ id, kind, bounds, metadata = {}, resource = null }) {
  if (!id) throw new Error('Collider prototype id is required.');
  if (!kind) throw new Error('Collider prototype kind is required.');
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('Collider prototype metadata must be a plain object.');
  }
  if (resource !== null && (typeof resource !== 'object' || Array.isArray(resource))) {
    throw new Error('Collider prototype resource must be an object or null.');
  }
  return Object.freeze({
    [COLLIDER_PROTOTYPE_BRAND]: true,
    id: String(id),
    kind: String(kind),
    bounds: createCanonicalAabb(bounds),
    metadata: cloneMetadata(metadata),
    resource,
  });
}
