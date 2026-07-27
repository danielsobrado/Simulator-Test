import { MAX_COLLIDER_CHUNKS } from '../CollisionLimits.js';

const AXES = Object.freeze(['X', 'Y', 'Z']);
const CHUNK_BOUNDARY_EPSILON = 1e-9;
const CHUNK_RANGE_FIELDS = Object.freeze([
  'minChunkX',
  'maxChunkX',
  'minChunkZ',
  'maxChunkZ',
]);

function assertFinite(value, name) {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite.`);
}

function assertSafeChunkCoordinate(value) {
  if (!Number.isSafeInteger(value)) {
    throw new Error('Collision chunk coordinate is outside the safe integer range.');
  }
  return value;
}

function assertPositiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer.`);
  }
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
    chunkX: assertSafeChunkCoordinate(Math.floor(canonicalX / chunkWorldSize)),
    chunkZ: assertSafeChunkCoordinate(Math.floor(-canonicalZ / chunkWorldSize)),
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

export function collisionChunkRangeForAabb(aabb, chunkWorldSize) {
  if (!(chunkWorldSize > 0)) throw new Error('chunkWorldSize must be positive.');
  return Object.freeze({
    minChunkX: assertSafeChunkCoordinate(Math.floor(aabb.minX / chunkWorldSize)),
    maxChunkX: assertSafeChunkCoordinate(
      Math.floor((aabb.maxX + CHUNK_BOUNDARY_EPSILON) / chunkWorldSize),
    ),
    minChunkZ: assertSafeChunkCoordinate(Math.floor((-aabb.maxZ) / chunkWorldSize)),
    maxChunkZ: assertSafeChunkCoordinate(
      Math.floor((-aabb.minZ + CHUNK_BOUNDARY_EPSILON) / chunkWorldSize),
    ),
  });
}

export function collisionChunkCountForRange(range) {
  for (const field of CHUNK_RANGE_FIELDS) {
    if (!Number.isSafeInteger(range?.[field])) {
      throw new Error('Collision chunk range coordinates must be safe integers.');
    }
  }
  const columns = range.maxChunkX - range.minChunkX + 1;
  const rows = range.maxChunkZ - range.minChunkZ + 1;
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows)
      || columns < 1 || rows < 1) {
    throw new Error('Collision chunk range is too large to enumerate safely.');
  }
  if (columns > Math.floor(Number.MAX_SAFE_INTEGER / rows)) {
    throw new Error('Collision chunk range is too large to enumerate safely.');
  }
  return columns * rows;
}

export function collisionChunksForAabb(
  aabb,
  chunkWorldSize,
  target = [],
  maximumChunks = MAX_COLLIDER_CHUNKS,
) {
  assertPositiveSafeInteger(maximumChunks, 'maximumChunks');
  if (maximumChunks > MAX_COLLIDER_CHUNKS) {
    throw new Error(`maximumChunks must not exceed ${MAX_COLLIDER_CHUNKS}.`);
  }
  if (!Array.isArray(target)) throw new Error('Collision chunk target must be an array.');
  target.length = 0;
  const range = collisionChunkRangeForAabb(aabb, chunkWorldSize);
  const chunkCount = collisionChunkCountForRange(range);
  if (chunkCount > maximumChunks) {
    throw new Error(
      `Collision AABB overlaps ${chunkCount} chunks, exceeding the limit of ${maximumChunks}.`,
    );
  }
  for (let chunkZ = range.minChunkZ; chunkZ <= range.maxChunkZ; chunkZ += 1) {
    for (let chunkX = range.minChunkX; chunkX <= range.maxChunkX; chunkX += 1) {
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
