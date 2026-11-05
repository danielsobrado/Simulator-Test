const SQUARED_INFINITY = 0x3fffffff;

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
    this.pendingBlocks = new Map();
  }

  /**
   * Advance the block under a cell until it is built or `shouldYield` asks to stop.
   * @returns {boolean} whether `sample` can now read that block without building it
   */
  prepare(cellX, cellZ, shouldYield = null) {
    const blockX = floorDiv(Math.floor(cellX), this.blockSize);
    const blockZ = floorDiv(Math.floor(cellZ), this.blockSize);
    const key = `${blockX}:${blockZ}`;
    if (this.cache.has(key)) return true;
    let job = this.pendingBlocks.get(key);
    if (!job) {
      job = this.iterateBlock(blockX, blockZ);
      this.pendingBlocks.set(key, job);
    }
    for (;;) {
      if (shouldYield?.()) return false;
      let step;
      try {
        step = job.next();
      } catch (error) {
        // A thrown generator is finished: left pending, it would store `undefined` as this block.
        this.pendingBlocks.delete(key);
        throw error;
      }
      if (step.done) {
        this.storeBlock(key, step.value);
        return true;
      }
    }
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
    this.prepare(blockX * this.blockSize, blockZ * this.blockSize);
    return this.cache.get(key);
  }

  storeBlock(key, block) {
    this.pendingBlocks.delete(key);
    this.cache.set(key, block);
    while (this.cache.size > this.cacheLimit) {
      this.cache.delete(this.cache.keys().next().value);
    }
  }

  *iterateBlock(blockX, blockZ) {
    const halo = this.maxDistanceCells + 2;
    const width = this.blockSize + halo * 2;
    const originX = blockX * this.blockSize - halo;
    const originZ = blockZ * this.blockSize - halo;
    // Each cell carries the offset to its nearest land cell (8SSEDT), so the
    // distance is Euclidean. A chamfer distance drew every depth contour of the
    // sea bed as an octagon: deep water read as a dark, straight-sided diamond.
    const offsetX = new Int16Array(width * width);
    const offsetZ = new Int16Array(width * width);
    // Squared, in whole cells: exact in integers, and no root per comparison.
    const squared = new Int32Array(width * width);

    for (let z = 0; z < width; z += 1) {
      for (let x = 0; x < width; x += 1) {
        squared[gridIndex(x, z, width)] = this.isWaterCell(originX + x, originZ + z) ? SQUARED_INFINITY : 0;
      }
      yield;
    }

    // Take the neighbour's nearest land if it is nearer from here.
    const relax = (index, x, z, stepX, stepZ) => {
      const nx = x - stepX, nz = z - stepZ;
      if (nx < 0 || nz < 0 || nx >= width || nz >= width) return;
      const neighbor = gridIndex(nx, nz, width);
      if (squared[neighbor] === SQUARED_INFINITY) return;
      const candidateX = offsetX[neighbor] + stepX, candidateZ = offsetZ[neighbor] + stepZ;
      const candidate = candidateX * candidateX + candidateZ * candidateZ;
      if (candidate < squared[index]) {
        offsetX[index] = candidateX;
        offsetZ[index] = candidateZ;
        squared[index] = candidate;
      }
    };

    for (let z = 0; z < width; z += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = gridIndex(x, z, width);
        relax(index, x, z, 1, 0);
        relax(index, x, z, 1, 1);
        relax(index, x, z, 0, 1);
        relax(index, x, z, -1, 1);
      }
      for (let x = width - 1; x >= 0; x -= 1) relax(gridIndex(x, z, width), x, z, -1, 0);
    }
    yield;

    for (let z = width - 1; z >= 0; z -= 1) {
      for (let x = width - 1; x >= 0; x -= 1) {
        const index = gridIndex(x, z, width);
        relax(index, x, z, -1, 0);
        relax(index, x, z, -1, -1);
        relax(index, x, z, 0, -1);
        relax(index, x, z, 1, -1);
      }
      for (let x = 0; x < width; x += 1) relax(gridIndex(x, z, width), x, z, 1, 0);
    }
    yield;

    const result = new Float32Array(this.blockSize * this.blockSize);
    for (let z = 0; z < this.blockSize; z += 1) {
      for (let x = 0; x < this.blockSize; x += 1) {
        result[gridIndex(x, z, this.blockSize)] = Math.min(
          this.maxDistanceCells,
          Math.sqrt(squared[gridIndex(x + halo, z + halo, width)]),
        );
      }
    }
    return result;
  }

  clear() {
    this.cache.clear();
    this.pendingBlocks.clear();
  }
}
