import { cellCenterToWorld } from '../world/WorldCoordinates.js';
import { hash32, overlaps, scatterRandom01 } from './scatterMath.js';

const DEFAULT_PRIORITY_CHANNEL = 23;
const SIGNATURE_SCALE = 1000;
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

function stableId(kind, chunkX, chunkZ, index) {
  return `${kind}:${chunkX}:${chunkZ}:${index}`;
}

function quantize(value) {
  return Math.round(value * SIGNATURE_SCALE);
}

function mixHash(seed, value) {
  return hash32(seed ^ hash32(value));
}

export function placementSignature(placements) {
  let result = 0x811c9dc5;
  const ordered = [...placements].sort((left, right) => (
    String(left.stableId ?? '').localeCompare(String(right.stableId ?? ''))
  ));
  for (const placement of ordered) {
    result = mixHash(result, quantize(placement.x));
    result = mixHash(result, quantize(placement.z));
    result = mixHash(result, quantize(placement.radius ?? 0));
    result = mixHash(result, placement.prototypeIndex ?? 0);
  }
  return `${ordered.length}:${result.toString(16).padStart(8, '0')}`;
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
  minScale,
  maxScale,
  radiusForScale,
  priorityChannel,
  candidateEvaluator,
}) {
  const cellX = chunkX * chunkSize
    + Math.floor(scatterRandom01(chunkX, chunkZ, index, 0) * chunkSize);
  const cellZ = chunkZ * chunkSize
    + Math.floor(scatterRandom01(chunkX, chunkZ, index, 1) * chunkSize);
  if (!tileIds.has(tileAt(cellX, cellZ))) return null;

  const center = cellCenterToWorld(cellX, cellZ, tileSize);
  const x = center.x + (scatterRandom01(chunkX, chunkZ, index, 2) - 0.5) * tileSize;
  const z = center.z + (scatterRandom01(chunkX, chunkZ, index, 3) - 0.5) * tileSize;
  const prototypeIndex = Math.floor(
    scatterRandom01(chunkX, chunkZ, index, 4) * prototypeCount,
  ) % prototypeCount;
  const scale = minScale
    + scatterRandom01(chunkX, chunkZ, index, 5) * (maxScale - minScale);
  const rotationY = scatterRandom01(chunkX, chunkZ, index, 6) * Math.PI * 2;
  const id = stableId(kind, chunkX, chunkZ, index);
  const candidate = Object.freeze({
    stableId: id,
    ownerChunkX: chunkX,
    ownerChunkZ: chunkZ,
    index,
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

/**
 * Builds one chunk's accepted placements using a Matérn-II rule: a candidate
 * survives only when no overlapping candidate has a lower stable priority.
 * Acceptance is independent of focus-window size and traversal order.
 *
 * candidateEvaluator may reject a candidate or attach immutable domain metadata.
 * maxAccepted limits every owner chunk's authoritative candidates before spacing,
 * so candidates that cannot render never create invisible blockers.
 */
export function buildStableChunkManifest({
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
  minScale,
  maxScale,
  radiusForScale,
  blockers = [],
  haloChunks = 1,
  priorityChannel = DEFAULT_PRIORITY_CHANNEL,
  candidateEvaluator = null,
  maxAccepted = Number.POSITIVE_INFINITY,
}) {
  if (!Number.isInteger(prototypeCount) || prototypeCount < 1) return Object.freeze([]);
  const acceptedLimit = normalizeAcceptedLimit(maxAccepted);
  const eligibleTileIds = tileIds instanceof Set ? tileIds : new Set(tileIds);
  const candidates = [];

  for (let candidateChunkZ = chunkZ - haloChunks;
    candidateChunkZ <= chunkZ + haloChunks;
    candidateChunkZ += 1) {
    for (let candidateChunkX = chunkX - haloChunks;
      candidateChunkX <= chunkX + haloChunks;
      candidateChunkX += 1) {
      for (let index = 0; index < perChunk; index += 1) {
        const candidate = createCandidate({
          kind,
          chunkX: candidateChunkX,
          chunkZ: candidateChunkZ,
          index,
          chunkSize,
          tileSize,
          tileIds: eligibleTileIds,
          tileAt,
          heightAt,
          prototypeCount,
          minScale,
          maxScale,
          radiusForScale,
          priorityChannel,
          candidateEvaluator,
        });
        if (candidate) candidates.push(candidate);
      }
    }
  }

  const authoritativeCandidates = limitCandidatesByOwner(candidates, acceptedLimit);
  const accepted = authoritativeCandidates.filter((candidate) => {
    if (overlaps(candidate.x, candidate.z, blockers, candidate.radius)) return false;
    for (const other of authoritativeCandidates) {
      if (other === candidate || !candidateWins(other, candidate)) continue;
      if (candidateOverlaps(candidate, other)) return false;
    }
    return true;
  });
  const owned = accepted.filter((candidate) => (
    candidate.ownerChunkX === chunkX && candidate.ownerChunkZ === chunkZ
  ));

  return Object.freeze(owned.sort((left, right) => left.index - right.index));
}
