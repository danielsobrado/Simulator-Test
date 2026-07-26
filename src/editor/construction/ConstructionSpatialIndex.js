import { cubicBezierPathBounds } from './curve/CubicBezierPath.js';

function key(x, z) {
  return `${x}:${z}`;
}

export class ConstructionSpatialIndex {
  constructor({ chunkWorldSize }) {
    if (!(chunkWorldSize > 0)) throw new Error('Construction chunk size must be positive.');
    this.chunkWorldSize = chunkWorldSize;
    this.byChunk = new Map();
    this.byConstruction = new Map();
  }

  keysFor(record) {
    if (record.path.type !== 'cubicBezier') {
      throw new Error('Construction spatial indexing currently requires a cubic Bézier path.');
    }
    const bounds = cubicBezierPathBounds(record.path);
    const margin = record.dimensions.thickness / 2;
    const minX = Math.floor((bounds.minX - margin) / this.chunkWorldSize);
    const maxX = Math.floor((bounds.maxX + margin) / this.chunkWorldSize);
    const minZ = Math.floor((bounds.minZ - margin) / this.chunkWorldSize);
    const maxZ = Math.floor((bounds.maxZ + margin) / this.chunkWorldSize);
    const result = [];
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) result.push(key(x, z));
    }
    return result;
  }

  update(record) {
    this.remove(record.id);
    const keys = this.keysFor(record);
    this.byConstruction.set(record.id, new Set(keys));
    for (const chunkKey of keys) {
      const ids = this.byChunk.get(chunkKey) ?? new Set();
      ids.add(record.id);
      this.byChunk.set(chunkKey, ids);
    }
    return Object.freeze([...keys]);
  }

  remove(constructionId) {
    const keys = this.byConstruction.get(constructionId);
    if (!keys) return;
    for (const chunkKey of keys) {
      const ids = this.byChunk.get(chunkKey);
      ids?.delete(constructionId);
      if (ids?.size === 0) this.byChunk.delete(chunkKey);
    }
    this.byConstruction.delete(constructionId);
  }

  list(chunkX, chunkZ) {
    return [...(this.byChunk.get(key(chunkX, chunkZ)) ?? [])].sort();
  }

  clear() {
    this.byChunk.clear();
    this.byConstruction.clear();
  }
}

