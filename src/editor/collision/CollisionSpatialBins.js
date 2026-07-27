import { MAX_COLLISION_BINS_PER_CHUNK } from './CollisionLimits.js';
import { COLLISION_LAYERS, collisionLayersMatch } from './CollisionLayers.js';
import { canonicalAabbsIntersect, createCanonicalAabb } from './colliders/ColliderBounds.js';

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export class CollisionSpatialBins {
  constructor({ chunkBounds, binSize, maxBinsPerCollider = 64 }) {
    if (!Number.isFinite(binSize) || binSize <= 0) {
      throw new Error('Collision binSize must be positive and finite.');
    }
    if (!Number.isSafeInteger(maxBinsPerCollider) || maxBinsPerCollider < 1) {
      throw new Error('maxBinsPerCollider must be a positive integer.');
    }
    this.chunkBounds = chunkBounds;
    this.binSize = binSize;
    this.maxBinsPerCollider = maxBinsPerCollider;
    this.columns = Math.max(1, Math.ceil((chunkBounds.maxX - chunkBounds.minX) / binSize));
    this.rows = Math.max(1, Math.ceil((chunkBounds.maxZ - chunkBounds.minZ) / binSize));
    if (!Number.isSafeInteger(this.columns) || !Number.isSafeInteger(this.rows)
        || this.columns > Math.floor(MAX_COLLISION_BINS_PER_CHUNK / this.rows)) {
      throw new Error(
        `Collision binSize creates more than ${MAX_COLLISION_BINS_PER_CHUNK} bins per chunk.`,
      );
    }
    this.bins = new Array(this.columns * this.rows).fill(null);
    this.large = [];
    this.sourceBins = new Map();
    this.rangeScratch = { minColumn: 0, maxColumn: 0, minRow: 0, maxRow: 0 };
  }

  rangeForAabb(aabb) {
    const range = this.rangeScratch;
    range.minColumn = clamp(
      Math.floor((aabb.minX - this.chunkBounds.minX) / this.binSize),
      0,
      this.columns - 1,
    );
    range.maxColumn = clamp(
      Math.floor((aabb.maxX - this.chunkBounds.minX) / this.binSize),
      0,
      this.columns - 1,
    );
    range.minRow = clamp(
      Math.floor((aabb.minZ - this.chunkBounds.minZ) / this.binSize),
      0,
      this.rows - 1,
    );
    range.maxRow = clamp(
      Math.floor((aabb.maxZ - this.chunkBounds.minZ) / this.binSize),
      0,
      this.rows - 1,
    );
    return range;
  }

  insert(collider) {
    if (!canonicalAabbsIntersect(collider.aabb, this.chunkBounds)) return false;
    this.remove(collider.sourceId);
    const range = this.rangeForAabb(collider.aabb);
    const coverage = (range.maxColumn - range.minColumn + 1)
      * (range.maxRow - range.minRow + 1);
    if (coverage > this.maxBinsPerCollider) {
      this.large.push(collider.sourceId);
      this.sourceBins.set(collider.sourceId, null);
      return true;
    }

    const keys = [];
    for (let row = range.minRow; row <= range.maxRow; row += 1) {
      for (let column = range.minColumn; column <= range.maxColumn; column += 1) {
        const key = row * this.columns + column;
        const bin = this.bins[key] ?? [];
        bin.push(collider.sourceId);
        this.bins[key] = bin;
        keys.push(key);
      }
    }
    this.sourceBins.set(collider.sourceId, keys);
    return true;
  }

  remove(sourceId) {
    if (!this.sourceBins.has(sourceId)) return false;
    const keys = this.sourceBins.get(sourceId);
    if (keys === null) {
      const index = this.large.indexOf(sourceId);
      if (index >= 0) this.large.splice(index, 1);
    } else {
      for (const key of keys) {
        const bin = this.bins[key];
        if (!bin) continue;
        const index = bin.indexOf(sourceId);
        if (index >= 0) bin.splice(index, 1);
        if (bin.length === 0) this.bins[key] = null;
      }
    }
    this.sourceBins.delete(sourceId);
    return true;
  }

  appendCandidate(sourceId, queryAabb, queryStamp, registry, out, queryLayers) {
    const entry = registry.get(sourceId);
    if (!entry || entry.lastQueryStamp === queryStamp) return;
    entry.lastQueryStamp = queryStamp;
    const collider = entry.collider;
    if (!collisionLayersMatch(collider.layers, queryLayers)) return;
    if (!canonicalAabbsIntersect(collider.aabb, queryAabb)) return;
    out.push(collider);
  }

  query(queryAabb, queryStamp, registry, out, queryLayers = COLLISION_LAYERS.all) {
    for (let index = 0; index < this.large.length; index += 1) {
      this.appendCandidate(this.large[index], queryAabb, queryStamp, registry, out, queryLayers);
    }
    const range = this.rangeForAabb(queryAabb);
    for (let row = range.minRow; row <= range.maxRow; row += 1) {
      for (let column = range.minColumn; column <= range.maxColumn; column += 1) {
        const bin = this.bins[row * this.columns + column];
        if (!bin) continue;
        for (let index = 0; index < bin.length; index += 1) {
          this.appendCandidate(bin[index], queryAabb, queryStamp, registry, out, queryLayers);
        }
      }
    }
    return out;
  }

  getStats() {
    let activeBins = 0;
    for (const bin of this.bins) if (bin?.length) activeBins += 1;
    return Object.freeze({
      activeBins,
      largeColliders: this.large.length,
      colliders: this.sourceBins.size,
    });
  }

  debugBinBounds() {
    const bounds = [];
    for (let key = 0; key < this.bins.length; key += 1) {
      if (!this.bins[key]?.length) continue;
      const row = Math.floor(key / this.columns);
      const column = key % this.columns;
      bounds.push(createCanonicalAabb({
        minX: this.chunkBounds.minX + column * this.binSize,
        maxX: Math.min(this.chunkBounds.maxX, this.chunkBounds.minX + (column + 1) * this.binSize),
        minY: -1,
        maxY: 1,
        minZ: this.chunkBounds.minZ + row * this.binSize,
        maxZ: Math.min(this.chunkBounds.maxZ, this.chunkBounds.minZ + (row + 1) * this.binSize),
      }));
    }
    return bounds;
  }
}
