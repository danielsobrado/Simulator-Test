import { COLLIDER_TYPE_MESH_INSTANCE } from './colliders/ColliderRecords.js';

const HASH_QUANTUM = 1e5;

function createHasher() {
  let hash = 0x811c9dc5;
  const write = (value) => {
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    hash ^= 1;
    hash = Math.imul(hash, 0x01000193);
  };
  return {
    text: write,
    number: (value) => write(Math.round((value ?? 0) * HASH_QUANTUM)),
    digest: () => (hash >>> 0).toString(16).padStart(8, '0'),
  };
}

function writeArray(hasher, values) {
  hasher.number(values?.length ?? 0);
  for (const value of values ?? []) hasher.number(value);
}

function writeAabb(hasher, aabb) {
  for (const field of ['minX', 'minY', 'minZ', 'maxX', 'maxY', 'maxZ']) {
    hasher.number(aabb?.[field]);
  }
}

function writeCollider(hasher, collider) {
  hasher.text(collider.sourceId);
  hasher.text(collider.type);
  hasher.text(collider.prototypeId ?? '-');
  hasher.number(collider.layers);
  hasher.number(collider.ownerChunkX);
  hasher.number(collider.ownerChunkZ);
  writeAabb(hasher, collider.aabb);
  writeArray(hasher, collider.position);
  hasher.number(collider.rotationY);
  writeArray(hasher, collider.dimensions);
  writeArray(hasher, collider.transform);
}

export function getCollisionWorldComposition(world) {
  let primitiveColliders = 0;
  let meshInstances = 0;
  for (const entry of world?.registry?.values?.() ?? []) {
    if (entry.collider.type === COLLIDER_TYPE_MESH_INSTANCE) meshInstances += 1;
    else primitiveColliders += 1;
  }
  let prototypeBvhs = 0;
  for (const prototype of world?.prototypes?.values?.() ?? []) {
    if (prototype.resource?.bvh && !prototype.resource.disposed) prototypeBvhs += 1;
  }
  return Object.freeze({ primitiveColliders, meshInstances, prototypeBvhs });
}

export function canonicalCollisionSignature(world) {
  const hasher = createHasher();
  const colliders = [...(world?.registry?.values?.() ?? [])]
    .map((entry) => entry.collider)
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  hasher.number(colliders.length);
  for (const collider of colliders) writeCollider(hasher, collider);
  return hasher.digest();
}
