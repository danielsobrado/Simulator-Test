function normalizeSegment(value, name) {
  const segment = String(value ?? '').trim();
  if (!segment) throw new Error(`Collision ${name} must not be empty.`);
  return encodeURIComponent(segment);
}

export function createCollisionSourceId(kind, stableId, part = null) {
  const segments = [
    normalizeSegment(kind, 'source kind'),
    normalizeSegment(stableId, 'stable id'),
  ];
  if (part !== null && part !== undefined) {
    segments.push(normalizeSegment(part, 'source part'));
  }
  return segments.join(':');
}

export function collisionChunkKey(chunkX, chunkZ) {
  if (!Number.isSafeInteger(chunkX) || !Number.isSafeInteger(chunkZ)) {
    throw new Error('Collision chunk coordinates must be safe integers.');
  }
  return `${chunkX}:${chunkZ}`;
}

export function parseCollisionChunkKey(key) {
  const match = /^(-?\d+):(-?\d+)$/.exec(String(key));
  if (!match) throw new Error(`Invalid collision chunk key: ${key}.`);
  return Object.freeze({ chunkX: Number(match[1]), chunkZ: Number(match[2]) });
}
