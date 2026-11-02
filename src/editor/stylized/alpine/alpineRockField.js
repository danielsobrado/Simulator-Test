/**
 * Geological props for high and snowy ground, from a deterministic grid: crags
 * break out of steep faces, boulders gather in clusters on the flats. Pure, so
 * the same world always grows the same rocks and streaming cannot change them.
 */
export const ALPINE_CELL_METERS = 32;
export const ALPINE_ROCK_KINDS = 4;
/** Rise over run where a slope starts to break into rock, and where it is flat enough for boulders. */
const CRAG_SLOPE = 0.5;
const BOULDER_SLOPE = 0.3;
const CRAG_SHARE = 0.55;
const CLUSTER_SHARE = 0.1;
const CLUSTER_SIZE = 5;
const CLUSTER_SPREAD_METERS = 9;

function hash(cellX, cellZ, salt) {
  let h = Math.imul(cellX, 0x9e3779b1) ^ Math.imul(cellZ, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

function rock(cellX, cellZ, salt, x, z, scale, stretch) {
  return {
    x, z, scale,
    stretch,
    yaw: hash(cellX, cellZ, salt + 1) * Math.PI * 2,
    kind: Math.floor(hash(cellX, cellZ, salt + 2) * ALPINE_ROCK_KINDS),
  };
}

/**
 * @param {number} cellX
 * @param {number} cellZ
 * @param {(x: number, z: number) => { slope: number, allowed: boolean }} ground
 * @returns {object[]|null} rocks in canonical metres, or null for an empty cell
 */
export function alpineRocksInCell(cellX, cellZ, ground) {
  const x = (cellX + 0.1 + 0.8 * hash(cellX, cellZ, 1)) * ALPINE_CELL_METERS;
  const z = (cellZ + 0.1 + 0.8 * hash(cellX, cellZ, 2)) * ALPINE_CELL_METERS;
  const roll = hash(cellX, cellZ, 3);
  if (roll >= Math.max(CRAG_SHARE, CLUSTER_SHARE)) return null;
  const here = ground(x, z);
  if (!here.allowed) return null;
  if (here.slope >= CRAG_SLOPE) {
    const scale = 5 + 13 * hash(cellX, cellZ, 4) ** 2;
    return [rock(cellX, cellZ, 10, x, z, scale, 1.1 + hash(cellX, cellZ, 5) * 0.9)];
  }
  if (here.slope > BOULDER_SLOPE || roll >= CLUSTER_SHARE) return null;
  const rocks = [];
  for (let i = 0; i < CLUSTER_SIZE; i += 1) {
    const angle = hash(cellX, cellZ, 20 + i) * Math.PI * 2;
    const reach = CLUSTER_SPREAD_METERS * Math.sqrt(hash(cellX, cellZ, 30 + i));
    const size = hash(cellX, cellZ, 40 + i);
    // One large stone with smaller ones around it, not a sprinkle of equals.
    const scale = i === 0 ? 2.2 + size * 2.4 : 0.5 + size * size * 1.5;
    rocks.push(rock(cellX, cellZ, 50 + i * 3, x + Math.cos(angle) * reach, z + Math.sin(angle) * reach, scale, 0.75 + size * 0.3));
  }
  return rocks;
}
