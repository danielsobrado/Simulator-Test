const DEFAULT_BLOCK_SIZE = 64;
const DEFAULT_CACHE_LIMIT = 64;

function blockCoordinate(value, blockSize) {
  return Math.floor(value / blockSize);
}

function localCoordinate(value, block, blockSize) {
  return value - block * blockSize;
}

export class WaterCellCache {
  constructor({
    ArrayType = Float64Array,
    blockSize = DEFAULT_BLOCK_SIZE,
    cacheLimit = DEFAULT_CACHE_LIMIT,
  } = {}) {
    if (typeof ArrayType !== 'function'
        || !Number.isInteger(ArrayType.BYTES_PER_ELEMENT)
        || ArrayType.BYTES_PER_ELEMENT < 1) {
      throw new Error('Water cell cache requires a typed-array constructor.');
    }
    if (!Number.isInteger(blockSize) || blockSize < 1) {
      throw new Error('Water cell cache blockSize must be a positive integer.');
    }
    if (!Number.isInteger(cacheLimit) || cacheLimit < 1) {
      throw new Error('Water cell cache cacheLimit must be a positive integer.');
    }
    this.ArrayType = ArrayType;
    this.blockSize = blockSize;
    this.cacheLimit = cacheLimit;
    this.blocks = new Map();
    this.lastKey = null;
    this.lastBlock = null;
  }

  get(cellX, cellZ, createValue) {
    if (!Number.isSafeInteger(cellX) || !Number.isSafeInteger(cellZ)) {
      throw new Error('Water cell cache coordinates must be safe integers.');
    }
    if (typeof createValue !== 'function') {
      throw new Error('Water cell cache requires a value callback.');
    }
    const blockX = blockCoordinate(cellX, this.blockSize);
    const blockZ = blockCoordinate(cellZ, this.blockSize);
    const key = `${blockX}:${blockZ}`;
    const block = this.getBlock(key);
    const localX = localCoordinate(cellX, blockX, this.blockSize);
    const localZ = localCoordinate(cellZ, blockZ, this.blockSize);
    const index = localZ * this.blockSize + localX;
    if (block.filled[index]) return block.values[index];
    const value = createValue(cellX, cellZ);
    block.values[index] = value;
    block.filled[index] = 1;
    return value;
  }

  getBlock(key) {
    if (key === this.lastKey && this.lastBlock) return this.lastBlock;
    let block = this.blocks.get(key);
    if (block) {
      this.blocks.delete(key);
      this.blocks.set(key, block);
    } else {
      const length = this.blockSize * this.blockSize;
      block = {
        values: new this.ArrayType(length),
        filled: new Uint8Array(length),
      };
      this.blocks.set(key, block);
      while (this.blocks.size > this.cacheLimit) {
        this.blocks.delete(this.blocks.keys().next().value);
      }
    }
    this.lastKey = key;
    this.lastBlock = block;
    return block;
  }

  clear() {
    this.blocks.clear();
    this.lastKey = null;
    this.lastBlock = null;
  }
}
