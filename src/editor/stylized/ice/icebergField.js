/**
 * Where icebergs float: a deterministic jittered grid over cold open sea. Pure,
 * so the same world always grows the same bergs and streaming cannot change them.
 */
export const ICEBERG_CELL_METERS = 320;
export const ICEBERG_KINDS = 3;
const SHARE_OF_CELLS = 0.45;
const MIN_SCALE = 14;
const MAX_SCALE = 46;
/** Open water this many berg radii out, so none grounds on a beach. */
const CLEARANCE_RADII = 1.6;
const CLEARANCE_DIRECTIONS = 8;

function hash(cellX, cellZ, salt) {
  let h = Math.imul(cellX, 0x9e3779b1) ^ Math.imul(cellZ, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** The berg a grid cell could hold, before asking the world about it, or null. */
export function icebergCandidate(cellX, cellZ, seed = 0) {
  if (hash(cellX, cellZ, seed + 1) >= SHARE_OF_CELLS) return null;
  const size = hash(cellX, cellZ, seed + 2);
  return {
    x: (cellX + 0.15 + 0.7 * hash(cellX, cellZ, seed + 3)) * ICEBERG_CELL_METERS,
    z: (cellZ + 0.15 + 0.7 * hash(cellX, cellZ, seed + 4)) * ICEBERG_CELL_METERS,
    // Squared: many small bergs, a few big ones.
    scale: MIN_SCALE + (MAX_SCALE - MIN_SCALE) * size * size,
    yaw: hash(cellX, cellZ, seed + 5) * Math.PI * 2,
    kind: Math.floor(hash(cellX, cellZ, seed + 6) * ICEBERG_KINDS),
  };
}

/** @param {(x: number, z: number) => boolean} isSea canonical metres */
export function icebergHasRoom(candidate, isSea) {
  if (!isSea(candidate.x, candidate.z)) return false;
  const reach = candidate.scale * CLEARANCE_RADII;
  for (let i = 0; i < CLEARANCE_DIRECTIONS; i += 1) {
    const angle = (i / CLEARANCE_DIRECTIONS) * Math.PI * 2;
    if (!isSea(candidate.x + Math.cos(angle) * reach, candidate.z + Math.sin(angle) * reach)) return false;
  }
  return true;
}
