import { cellCenterToWorld } from '../world/WorldCoordinates.js';
import { hash32, overlaps, scatterRandom01 } from './scatterMath.js';

const DEFAULT_PRIORITY_CHANNEL = 23;
const SIGNATURE_SCALE = 1000;
const EMPTY_MANIFEST = Object.freeze([]);
const CANDIDATE_AUTHORITY_FIELDS = new Set([
  'stableId',
  'ownerChunkX',
  'ownerChunkZ',
  'index',
  'x',
  'z',
  'height',
  'rotationY',
  'priority',
]);

function candidateOrder(left, right) {
  if (left.priority !== right.priority) return left.priority - right.priority;
  return left.stableId.localeCompare(right.stableId);
}

function candidateWins(left, right) {
  return candidateOrder(left, right) < 0;
}

function candidateOverlaps(left, right) {
  const deltaX = left.x - right.x;
  const deltaZ = left.z - right.z;
  const clear = left.radius + right.radius;
  return deltaX * deltaX + deltaZ * deltaZ < clear * clear;
}

/**
 * Uniform bucket index over candidate positions. Buckets are sized by the
 * largest candidate radius so any overlapping pair shares a bucket or sits in
 * one of the eight neighbours — the spacing rule itself is unchanged, only the
 * pairs visited shrink from O(n²) to O(n · localDensity).
 */
function createSpacingIndex(candidates) {
  let maximumRadius = 0;
  for (const candidate of candidates) {
    if (candidate.radius > maximumRadius) maximumRadius = candidate.radius;
  }
  const cellSize = maximumRadius > 0 ? maximumRadius * 2 : 1;
  const buckets = new Map();
  for (const candidate of candidates) {
    const cellX = Math.floor(candidate.x / cellSize);
    const cellZ = Math.floor(candidate.z / cellSize);
    const key = `${cellX}:${cellZ}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(candidate);
    else buckets.set(key, [candidate]);
  }
  return {
    *neighbours(candidate) {
      const cellX = Math.floor(candidate.x / cellSize);
      const cellZ = Math.floor(candidate.z / cellSize);
      for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          const bucket = buckets.get(`${cellX + offsetX}:${cellZ + offsetZ}`);
          if (bucket) yield* bucket;
        }
      }
    },
  };
}

function stableId(kind, chunkX, chunkZ, index) {
  return `${kind}:${chunkX}:${chunkZ}:${index}`;
}

function quantize(value) {
  return Math.round(value * SIGNATURE_SCALE);
}

function mixHash(seed, value) {
  return hash32(seed ^ hash32(value));
}

/**
 * Order-independent digest of a placement set, used purely as an in-memory
 * change-detection key.
 */
export function placementSignature(placements) {
  let accumulator = 0;
  let count = 0;
  for (const placement of placements) {
    let hash = 0x811c9dc5;
    hash = mixHash(hash, quantize(placement.x));
    hash = mixHash(hash, quantize(placement.z));
    hash = mixHash(hash, quantize(placement.radius ?? 0));
    hash = mixHash(hash, placement.prototypeIndex ?? 0);
    accumulator = (accumulator + hash) >>> 0;
    count += 1;
  }
  return `${count}:${accumulator.toString(16).padStart(8, '0')}`;
}

export function blockersForChunk({
  placements,
  chunkX,
  chunkZ,
  chunkWorldSize,
  expand = 0,
}) {
  const minimumX = chunkX * chunkWorldSize - expand;
  const maximumX = (chunkX + 1) * chunkWorldSize + expand;
  const maximumZ = -chunkZ * chunkWorldSize + expand;
  const minimumZ = -(chunkZ + 1) * chunkWorldSize - expand;
  return placements.filter((placement) => {
    const radius = placement.radius ?? 0;
    return placement.x + radius >= minimumX
      && placement.x - radius <= maximumX
      && placement.z + radius >= minimumZ
      && placement.z - radius <= maximumZ;
  });
}

function isMetadataObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function evaluateCandidate(candidate, candidateEvaluator) {
  if (!candidateEvaluator) return candidate;
  const metadata = candidateEvaluator(candidate);
  if (!metadata) return null;
  if (metadata === true) return candidate;
  if (!isMetadataObject(metadata)) {
    throw new Error('candidateEvaluator must return a plain object, true, or a falsy rejection.');
  }
  for (const key of Object.keys(metadata)) {
    if (CANDIDATE_AUTHORITY_FIELDS.has(key)) {
      throw new Error(`candidateEvaluator cannot override canonical field "${key}".`);
    }
  }
  return Object.freeze({ ...candidate, ...metadata });
}

function normalizeAcceptedLimit(maxAccepted) {
  if (maxAccepted === Number.POSITIVE_INFINITY) return maxAccepted;
  if (!Number.isInteger(maxAccepted) || maxAccepted < 0) {
    throw new Error('maxAccepted must be a non-negative integer or Infinity.');
  }
  return maxAccepted;
}

function candidateOwnerKey(candidate) {
  return `${candidate.ownerChunkX}:${candidate.ownerChunkZ}`;
}

function limitCandidatesByOwner(candidates, acceptedLimit) {
  if (!Number.isFinite(acceptedLimit)) return candidates;

  const candidatesByOwner = new Map();
  for (const candidate of candidates) {
    const key = candidateOwnerKey(candidate);
    const owned = candidatesByOwner.get(key) ?? [];
    owned.push(candidate);
    candidatesByOwner.set(key, owned);
  }

  const limited = [];
  for (const owned of candidatesByOwner.values()) {
    limited.push(...owned.sort(candidateOrder).slice(0, acceptedLimit));
  }
  return limited;
}

function createCandidate({
  kind,
  chunkX,
  chunkZ,
  index,
  chunkSize,
  tileSize,
  tileIds,
  tileAt,
  heightAt,
  prototypeCount,
  prototypeIndexForRoll,
  minScale,
  maxScale,
  radiusForScale,
  randomChannelOffset,
  priorityChannel,
  candidateEvaluator,
}) {
  const random01 = (channel) => (
    scatterRandom01(chunkX, chunkZ, index, randomChannelOffset + channel)
  );
  const cellX = chunkX * chunkSize
    + Math.floor(random01(0) * chunkSize);
  const cellZ = chunkZ * chunkSize
    + Math.floor(random01(1) * chunkSize);
  const tileId = tileAt(cellX, cellZ);
  if (!tileIds.has(tileId)) return null;

  const center = cellCenterToWorld(cellX, cellZ, tileSize);
  const x = center.x + (random01(2) - 0.5) * tileSize;
  const z = center.z + (random01(3) - 0.5) * tileSize;
  const prototypeRoll = random01(4);
  const prototypeIndex = prototypeIndexForRoll
    ? prototypeIndexForRoll(prototypeRoll, tileId, x, z)
    : Math.floor(prototypeRoll * prototypeCount) % prototypeCount;
  if (!Number.isInteger(prototypeIndex)
      || prototypeIndex < 0
      || prototypeIndex >= prototypeCount) {
    throw new Error('prototypeIndexForRoll must return an available prototype index.');
  }
  const scale = minScale
    + random01(5) * (maxScale - minScale);
  const rotationY = random01(6) * Math.PI * 2;
  const id = stableId(kind, chunkX, chunkZ, index);
  const candidate = Object.freeze({
    stableId: id,
    ownerChunkX: chunkX,
    ownerChunkZ: chunkZ,
    index,
    tileId,
    x,
    z,
    height: heightAt(x, z),
    scale,
    rotationY,
    prototypeIndex,
    radius: radiusForScale(scale),
    priority: scatterRandom01(chunkX, chunkZ, index, priorityChannel),
  });

  return evaluateCandidate(candidate, candidateEvaluator);
}

function completedBuilder(result) {
  return Object.freeze({
    get done() {
      return true;
    },
    step() {
      return result;
    },
  });
}

/**
 * Incremental form of buildStableChunkManifest.
 *
 * A step always completes at least one candidate when work remains, then checks
 * shouldYield between candidates. This bounds expensive terrain/habitat/cluster
 * sampling without changing candidate order, RNG channels, spacing, or output.
 */
export function createStableChunkManifestBuilder({
  kind,
  chunkX,
  chunkZ,
  chunkSize,
  tileSize,
  perChunk,
  tileIds,
  tileAt,
  heightAt,
  prototypeCount,
  prototypeIndexForRoll = null,
  minScale,
  maxScale,
  radiusForScale,
  blockers = [],
  haloChunks = 1,
  randomChannelOffset = 0,
  priorityChannel = DEFAULT_PRIORITY_CHANNEL,
  candidateEvaluator = null,
  maxAccepted = Number.POSITIVE_INFINITY,
}) {
  if (!Number.isInteger(prototypeCount) || prototypeCount < 1) {
    return completedBuilder(EMPTY_MANIFEST);
  }
  if (!Number.isSafeInteger(randomChannelOffset) || randomChannelOffset < 0) {
    throw new Error('randomChannelOffset must be a non-negative safe integer.');
  }

  const acceptedLimit = normalizeAcceptedLimit(maxAccepted);
  const eligibleTileIds = tileIds instanceof Set ? tileIds : new Set(tileIds);
  const minimumChunkX = chunkX - haloChunks;
  const maximumChunkX = chunkX + haloChunks;
  const maximumChunkZ = chunkZ + haloChunks;
  let candidateChunkX = minimumChunkX;
  let candidateChunkZ = chunkZ - haloChunks;
  let candidateIndex = 0;
  let candidates = [];
  let authoritativeCandidates = null;
  let spacingIndex = null;
  let acceptanceIndex = 0;
  const owned = [];
  let result = null;

  function advanceCandidate() {
    candidateIndex += 1;
    if (candidateIndex < perChunk) return;
    candidateIndex = 0;
    candidateChunkX += 1;
    if (candidateChunkX <= maximumChunkX) return;
    candidateChunkX = minimumChunkX;
    candidateChunkZ += 1;
  }

  return Object.freeze({
    get done() {
      return result !== null;
    },

    step({ shouldYield = null } = {}) {
      if (result !== null) return result;
      const yieldRequested = typeof shouldYield === 'function' ? shouldYield : null;
      let workUnits = 0;

      while (candidateChunkZ <= maximumChunkZ) {
        if (candidateIndex >= perChunk) {
          advanceCandidate();
          continue;
        }
        const candidate = createCandidate({
          kind,
          chunkX: candidateChunkX,
          chunkZ: candidateChunkZ,
          index: candidateIndex,
          chunkSize,
          tileSize,
          tileIds: eligibleTileIds,
          tileAt,
          heightAt,
          prototypeCount,
          prototypeIndexForRoll,
          minScale,
          maxScale,
          radiusForScale,
          randomChannelOffset,
          priorityChannel,
          candidateEvaluator,
        });
        if (candidate) candidates.push(candidate);
        advanceCandidate();
        workUnits += 1;
        if (workUnits > 0 && yieldRequested?.()) return null;
      }

      if (authoritativeCandidates === null) {
        authoritativeCandidates = limitCandidatesByOwner(candidates, acceptedLimit);
        spacingIndex = createSpacingIndex(authoritativeCandidates);
        candidates = null;
      }

      while (acceptanceIndex < authoritativeCandidates.length) {
        const candidate = authoritativeCandidates[acceptanceIndex];
        acceptanceIndex += 1;
        let accepted = !overlaps(candidate.x, candidate.z, blockers, candidate.radius);
        if (accepted) {
          for (const other of spacingIndex.neighbours(candidate)) {
            if (other === candidate || !candidateWins(other, candidate)) continue;
            if (candidateOverlaps(candidate, other)) {
              accepted = false;
              break;
            }
          }
        }
        if (accepted
            && candidate.ownerChunkX === chunkX
            && candidate.ownerChunkZ === chunkZ) {
          owned.push(candidate);
        }
        workUnits += 1;
        if (workUnits > 0 && yieldRequested?.()) return null;
      }

      result = Object.freeze(owned.sort((left, right) => left.index - right.index));
      return result;
    },
  });
}

/**
 * Builds one chunk's accepted placements using a Matérn-II rule: a candidate
 * survives only when no overlapping candidate has a lower stable priority.
 * Acceptance is independent of focus-window size and traversal order.
 *
 * candidateEvaluator may reject a candidate or attach immutable domain metadata.
 * maxAccepted limits every owner chunk's authoritative candidates before spacing,
 * so candidates that cannot render never create invisible blockers.
 * randomChannelOffset gives independent scatter layers distinct deterministic
 * candidate streams without making either layer depend on the other's residency.
 */
export function buildStableChunkManifest(options) {
  const builder = createStableChunkManifestBuilder(options);
  return builder.step();
}
