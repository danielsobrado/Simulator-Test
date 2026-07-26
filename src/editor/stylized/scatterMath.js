/**
 * Deterministic scatter helpers shared by rocks, trees, grass, and flowers.
 * Seed formulas must stay stable — placement is keyed off these hashes.
 */

export function hash32(value) {
  let result = value | 0;
  result = Math.imul(result ^ (result >>> 16), 0x45d9f3b);
  result = Math.imul(result ^ (result >>> 16), 0x45d9f3b);
  return (result ^ (result >>> 16)) >>> 0;
}

/** Per-attempt scatter RNG used by rocks, trees, and flowers. */
export function scatterRandom01(chunkX, chunkZ, index, channel) {
  const seed = Math.imul(chunkX, 73856093)
    ^ Math.imul(chunkZ, 19349663)
    ^ Math.imul(index + 1, 83492791)
    ^ Math.imul(channel + 1, 1597334677);
  return hash32(seed) / 0xffffffff;
}

/** Per-cell blade RNG used by grass. */
export function cellSampleRandom01(chunkX, chunkZ, cellIndex, sampleIndex, channel) {
  const seed = Math.imul(chunkX, 73856093)
    ^ Math.imul(chunkZ, 19349663)
    ^ Math.imul(cellIndex + 1, 83492791)
    ^ Math.imul(sampleIndex + 1, 2654435761)
    ^ Math.imul(channel + 1, 1597334677);
  return hash32(seed) / 0xffffffff;
}

function radicalInverse(index, base) {
  let value = index;
  let inverseBase = 1 / base;
  let result = 0;
  while (value > 0) {
    result += (value % base) * inverseBase;
    value = Math.floor(value / base);
    inverseBase /= base;
  }
  return result;
}

/**
 * Low-discrepancy clump position inside one terrain cell.
 *
 * Independent random points often bunch six clumps into two or three visible
 * tufts. A scrambled Halton prefix keeps every density band evenly distributed
 * while the per-cell rotation prevents a world-aligned grid from appearing.
 */
export function grassClumpCellOffset(chunkX, chunkZ, cellIndex, clumpIndex) {
  const rotationX = cellSampleRandom01(chunkX, chunkZ, cellIndex, 0, 6);
  const rotationZ = cellSampleRandom01(chunkX, chunkZ, cellIndex, 0, 7);
  return {
    x: (radicalInverse(clumpIndex + 1, 2) + rotationX) % 1,
    z: (radicalInverse(clumpIndex + 1, 3) + rotationZ) % 1,
  };
}

export function overlaps(x, z, placements, radius) {
  for (const placement of placements) {
    const dx = placement.x - x;
    const dz = placement.z - z;
    const clear = (placement.radius ?? 0) + radius;
    if ((dx * dx) + (dz * dz) < clear * clear) return true;
  }
  return false;
}

export function sampleHeight(page, localX, localZ, chunkSize) {
  const x0 = Math.floor(localX);
  const z0 = Math.floor(localZ);
  const x1 = Math.min(chunkSize, x0 + 1);
  const z1 = Math.min(chunkSize, z0 + 1);
  const tx = localX - x0;
  const tz = localZ - z0;
  const vertexSize = chunkSize + 1;
  const height = (x, z) => page.heights[z * vertexSize + x];
  const north = height(x0, z0) + (height(x1, z0) - height(x0, z0)) * tx;
  const south = height(x0, z1) + (height(x1, z1) - height(x0, z1)) * tx;
  return north + (south - north) * tz;
}

/**
 * Size InstancedMesh buffers for the worst-case prototype assignment
 * (all instances land on one prototype), not the average split.
 */
export function instanceCapacity({ residentRadius, perChunk }) {
  const chunkCount = (residentRadius * 2 + 1) ** 2;
  return chunkCount * perChunk;
}
