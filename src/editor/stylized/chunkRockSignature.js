/**
 * Per-chunk rock influence signatures so grass rebuilds only when local rocks change.
 */

const MAX_INFLUENCE_CACHE_ENTRIES = 256;
const objectBoulderCache = new WeakMap();
const influenceCache = new WeakMap();

function influenceKey(descriptor, chunkWorldSize, radius, falloff) {
  return `${descriptor.centerWorldX}:${descriptor.centerWorldZ}:${chunkWorldSize}:${radius}:${falloff}`;
}

function getInfluenceEntry(rockPlacements, key) {
  if (!Array.isArray(rockPlacements)) return null;
  return influenceCache.get(rockPlacements)?.get(key) ?? null;
}

function cacheInfluence(rockPlacements, key, local) {
  if (!Array.isArray(rockPlacements)) return null;
  let cache = influenceCache.get(rockPlacements);
  if (!cache) {
    cache = new Map();
    influenceCache.set(rockPlacements, cache);
  }
  if (cache.size >= MAX_INFLUENCE_CACHE_ENTRIES && !cache.has(key)) {
    cache.delete(cache.keys().next().value);
  }
  const entry = { local, signature: undefined };
  cache.set(key, entry);
  return entry;
}

export function collectObjectBoulderPlacements({ objectMap, tileSize, radius }) {
  const revision = Number.isInteger(objectMap?.revision) ? objectMap.revision : null;
  if (revision !== null) {
    const cached = objectBoulderCache.get(objectMap);
    if (cached
      && cached.revision === revision
      && cached.tileSize === tileSize
      && cached.radius === radius) {
      return cached.placements;
    }
  }

  const placements = [];
  for (const object of objectMap.list()) {
    if (object.definitionKey !== 'boulder') continue;
    placements.push({
      stableId: `object:${object.id}`,
      x: (object.x + 0.5) * tileSize,
      z: -(object.z + 0.5) * tileSize,
      radius,
    });
  }
  if (revision !== null) {
    objectBoulderCache.set(objectMap, { revision, tileSize, radius, placements });
  }
  return placements;
}

export function rocksInfluencingChunk({
  descriptor,
  rockPlacements,
  chunkWorldSize,
  radius,
  falloff,
}) {
  const key = influenceKey(descriptor, chunkWorldSize, radius, falloff);
  const cached = getInfluenceEntry(rockPlacements, key);
  if (cached) return cached.local;

  const half = chunkWorldSize / 2;
  const minimumX = descriptor.centerWorldX - half;
  const maximumX = descriptor.centerWorldX + half;
  const minimumZ = descriptor.centerWorldZ - half;
  const maximumZ = descriptor.centerWorldZ + half;
  const local = [];
  for (const rock of rockPlacements) {
    const rockRadius = rock.radius ?? radius;
    const expand = rockRadius + falloff;
    if (rock.x < minimumX - expand
      || rock.x > maximumX + expand
      || rock.z < minimumZ - expand
      || rock.z > maximumZ + expand) {
      continue;
    }
    local.push(rock);
  }
  cacheInfluence(rockPlacements, key, local);
  return local;
}

export function rockSignatureForChunk({
  descriptor,
  rockPlacements,
  chunkWorldSize,
  radius,
  falloff,
}) {
  const key = influenceKey(descriptor, chunkWorldSize, radius, falloff);
  const cached = getInfluenceEntry(rockPlacements, key);
  if (cached?.signature !== undefined) return cached.signature;

  const local = cached?.local ?? rocksInfluencingChunk({
    descriptor,
    rockPlacements,
    chunkWorldSize,
    radius,
    falloff,
  });
  const signature = local.length === 0
    ? ''
    : local
      .map((rock) => {
        const rockRadius = rock.radius ?? radius;
        return `${rock.stableId ?? ''}:${rock.x.toFixed(2)}:${rock.z.toFixed(2)}:${rockRadius.toFixed(2)}`;
      })
      .sort()
      .join('|');
  const entry = cached ?? getInfluenceEntry(rockPlacements, key);
  if (entry) entry.signature = signature;
  return signature;
}

export function objectBoulderSignatureForChunk({
  objectMap,
  objectPlacements = null,
  descriptor,
  tileSize,
  chunkWorldSize,
  radius,
  falloff,
}) {
  const placements = objectPlacements ?? collectObjectBoulderPlacements({
    objectMap,
    tileSize,
    radius,
  });
  return rockSignatureForChunk({
    descriptor,
    rockPlacements: placements,
    chunkWorldSize,
    radius,
    falloff,
  });
}
