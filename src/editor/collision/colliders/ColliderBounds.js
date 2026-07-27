const AXES = Object.freeze(['X', 'Y', 'Z']);
const CHUNK_BOUNDARY_EPSILON = 1e-9;

function assertFinite(value, name) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
}

export function createCanonicalAabb({ minX, minY, minZ, maxX, maxY, maxZ }) {
  const values = { minX, minY, minZ, maxX, maxY, maxZ };
  for (const [name, value] of Object.entries(values)) assertFinite(value, name);
  for (const axis of AXES) {
    if (values[`max${axis}`] < values[`min${axis}`]) {
      throw new Error(`Collider maximum ${axis} must cover its minimum.`);
    }
  }
  return Object.freeze(values);
}

export function canonicalAabbsIntersect(left, right) {
  return left.minX <= right.maxX && left.maxX >= right.minX
    && left.minY <= right.maxY && left.maxY >= right.minY
    && left.minZ <= right.maxZ && left.maxZ >= right.minZ;
}

export function collisionChunkForCanonical(canonicalX, canonicalZ, chunkWorldSize) {
  assertFinite(canonicalX, 'canonicalX');
  assertFinite(canonicalZ, 'canonicalZ');
  if (!(chunkWorldSize > 0)) throw new Error('chunkWorldSize must be positive.');
  return Object.freeze({
    chunkX: Math.floor(canonicalX / chunkWorldSize),
    chunkZ: Math.floor(-canonicalZ / chunkWorldSize),
  });
}

export function collisionChunkCanonicalBounds(chunkX, chunkZ, chunkWorldSize) {
  if (!Number.isSafeInteger(chunkX) || !Number.isSafeInteger(chunkZ)) {
    throw new Error('Collision chunk coordinates must be safe integers.');
  }
  if (!(chunkWorldSize > 0)) throw new Error('chunkWorldSize must be positive.');
  return createCanonicalAabb({
    minX: chunkX * chunkWorldSize,
    maxX: (chunkX + 1) * chunkWorldSize,
    minY: -Number.MAX_VALUE,
    maxY: Number.MAX_VALUE,
    minZ: -(chunkZ + 1) * chunkWorldSize,
    maxZ: -chunkZ * chunkWorldSize,
  });
}

export function collisionChunksForAabb(aabb, chunkWorldSize, target = []) {
  target.length = 0;
  const minChunkX = Math.floor(aabb.minX / chunkWorldSize);
  const maxChunkX = Math.floor((aabb.maxX + CHUNK_BOUNDARY_EPSILON) / chunkWorldSize);
  const minChunkZ = Math.floor((-aabb.maxZ) / chunkWorldSize);
  const maxChunkZ = Math.floor((-aabb.minZ + CHUNK_BOUNDARY_EPSILON) / chunkWorldSize);
  for (let chunkZ = minChunkZ; chunkZ <= maxChunkZ; chunkZ += 1) {
    for (let chunkX = minChunkX; chunkX <= maxChunkX; chunkX += 1) {
      target.push(Object.freeze({ chunkX, chunkZ }));
    }
  }
  return target;
}

export function createSweptCapsuleAabb({ start, end, radius, bodyHeight }) {
  if (!(radius > 0) || !(bodyHeight > radius * 2)) {
    throw new Error('Swept capsule dimensions are invalid.');
  }
  const minFootY = Math.min(start.y, end.y);
  const maxFootY = Math.max(start.y, end.y);
  return createCanonicalAabb({
    minX: Math.min(start.x, end.x) - radius,
    maxX: Math.max(start.x, end.x) + radius,
    minY: minFootY,
    maxY: maxFootY + bodyHeight,
    minZ: Math.min(start.z, end.z) - radius,
    maxZ: Math.max(start.z, end.z) + radius,
  });
}
