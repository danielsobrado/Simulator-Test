const DIAGONAL_COST = Math.SQRT2;
const DISTANCE_INFINITY = 1e9;

function floorDiv(value, divisor) {
  return Math.floor(value / divisor);
}

function gridIndex(x, z, width) {
  return z * width + x;
}

export class WaterDistanceField {
  constructor({
    isWaterCell,
    blockSize = 64,
    maxDistanceCells,
    cacheLimit = 64,
  }) {
    if (typeof isWaterCell !== 'function') {
      throw new Error('Water distance field requires an isWaterCell callback.');
    }
    if (!Number.isInteger(blockSize) || blockSize < 1) {
      throw new Error('Water distance field blockSize must be a positive integer.');
    }
    if (!Number.isInteger(maxDistanceCells) || maxDistanceCells < 1) {
      throw new Error('Water distance field maxDistanceCells must be a positive integer.');
    }
    if (!Number.isInteger(cacheLimit) || cacheLimit < 1) {
      throw new Error('Water distance field cacheLimit must be a positive integer.');
    }
    this.isWaterCell = isWaterCell;
    this.blockSize = blockSize;
    this.maxDistanceCells = maxDistanceCells;
    this.cacheLimit = cacheLimit;
    this.cache = new Map();
  }

  sample(cellX, cellZ) {
    if (!Number.isFinite(cellX) || !Number.isFinite(cellZ)) {
      throw new Error('Water distance field coordinates must be finite.');
    }
    const x = Math.floor(cellX);
    const z = Math.floor(cellZ);
    const blockX = floorDiv(x, this.blockSize);
    const blockZ = floorDiv(z, this.blockSize);
    const block = this.getBlock(blockX, blockZ);
    const localX = x - blockX * this.blockSize;
    const localZ = z - blockZ * this.blockSize;
    return block[gridIndex(localX, localZ, this.blockSize)];
  }

  getBlock(blockX, blockZ) {
    const key = `${blockX}:${blockZ}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const block = this.buildBlock(blockX, blockZ);
    this.cache.set(key, block);
    while (this.cache.size > this.cacheLimit) {
      this.cache.delete(this.cache.keys().next().value);
    }
    return block;
  }

  buildBlock(blockX, blockZ) {
    const halo = this.maxDistanceCells + 2;
    const width = this.blockSize + halo * 2;
    const originX = blockX * this.blockSize - halo;
    const originZ = blockZ * this.blockSize - halo;
    const distances = new Float32Array(width * width);

    for (let z = 0; z < width; z += 1) {
      for (let x = 0; x < width; x += 1) {
        distances[gridIndex(x, z, width)] = this.isWaterCell(originX + x, originZ + z)
          ? DISTANCE_INFINITY
          : 0;
      }
    }

    for (let z = 0; z < width; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = gridIndex(x, z, width);
        let distance = distances[index];
        if (x > 0) distance = Math.min(distance, distances[index - 1] + 1);
        if (z > 0) distance = Math.min(distance, distances[index - width] + 1);
        if (x > 0 && z > 0) {
          distance = Math.min(distance, distances[index - width - 1] + DIAGONAL_COST);
        }
        if (x + 1 < width && z > 0) {
          distance = Math.min(distance, distances[index - width + 1] + DIAGONAL_COST);
        }
        distances[index] = distance;
      }
    }

    for (let z = width - 1; z >= 0; z -= 1) {
      for (let x = width - 1; x >= 0; x -= 1) {
        const index = gridIndex(x, z, width);
        let distance = distances[index];
        if (x + 1 < width) distance = Math.min(distance, distances[index + 1] + 1);
        if (z + 1 < width) distance = Math.min(distance, distances[index + width] + 1);
        if (x + 1 < width && z + 1 < width) {
          distance = Math.min(distance, distances[index + width + 1] + DIAGONAL_COST);
        }
        if (x > 0 && z + 1 < width) {
          distance = Math.min(distance, distances[index + width - 1] + DIAGONAL_COST);
        }
        distances[index] = distance;
      }
    }

    const result = new Float32Array(this.blockSize * this.blockSize);
    for (let z = 0; z < this.blockSize; z += 1) {
      for (let x = 0; x < this.blockSize; x += 1) {
        result[gridIndex(x, z, this.blockSize)] = Math.min(
          this.maxDistanceCells,
          distances[gridIndex(x + halo, z + halo, width)],
        );
      }
    }
    return result;
  }

  clear() {
    this.cache.clear();
  }
}
