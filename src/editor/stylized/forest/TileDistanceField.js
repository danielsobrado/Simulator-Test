import { computeRoadDistanceField } from '../../world/ChunkRenderPixels.js';

/**
 * Distance from any world position to the nearest tile of a given id, derived
 * from the canonical tile map.
 *
 * Placement must not depend on which pages happen to be resident — otherwise the
 * forest would change with approach direction — so this never reads a page's
 * surface-mask pixels. It runs the same chamfer distance transform the terrain
 * material uses, once per chunk over the chunk plus a halo, and caches the
 * result, giving O(1) lookups for every candidate in that chunk.
 *
 * Distances saturate past `maxCells`: the halo is only that wide, so anything
 * further away reports Infinity rather than a real distance. Callers must size
 * `maxCells` to the largest range they actually test.
 */
export class TileDistanceField {
  constructor({
    tileAt,
    tileSize,
    chunkSize,
    targetTileId,
    maxCells,
    label = 'tile',
    revisionProvider = null,
    maxCachedChunks = 1,
  }) {
    if (typeof tileAt !== 'function') {
      throw new Error('TileDistanceField requires a tileAt function.');
    }
    if (!Number.isInteger(maxCachedChunks) || maxCachedChunks < 1) {
      throw new Error('TileDistanceField maxCachedChunks must be a positive integer.');
    }
    this.tileAt = tileAt;
    this.tileSize = tileSize;
    this.chunkSize = chunkSize;
    this.targetTileId = targetTileId;
    this.maxCells = Math.max(0, Number(maxCells) || 0);
    this.margin = Math.ceil(this.maxCells) + 1;
    this.revisionProvider = typeof revisionProvider === 'function' ? revisionProvider : null;
    this.cacheRevision = this.revisionProvider?.() ?? 0;
    this.maxCachedChunks = maxCachedChunks;
    this.cache = new Map();
    this.lastChunkX = null;
    this.lastChunkZ = null;
    this.lastField = null;
    this.stats = { builds: 0, cacheHits: 0, cacheEvictions: 0 };
    this.signature = `${label}:${this.targetTileId}:${this.maxCells}`;
  }

  get enabled() {
    return this.maxCells > 0;
  }

  chunkField(chunkX, chunkZ) {
    const revision = this.revisionProvider?.() ?? this.cacheRevision;
    if (revision !== this.cacheRevision) {
      this.cache.clear();
      this.cacheRevision = revision;
      this.lastChunkX = null;
      this.lastChunkZ = null;
      this.lastField = null;
    }
    if (this.lastField && chunkX === this.lastChunkX && chunkZ === this.lastChunkZ) {
      this.stats.cacheHits += 1;
      return this.lastField;
    }

    const key = `${chunkX}:${chunkZ}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      this.lastChunkX = chunkX;
      this.lastChunkZ = chunkZ;
      this.lastField = cached;
      this.stats.cacheHits += 1;
      return cached;
    }

    const size = this.chunkSize + this.margin * 2;
    const tiles = new Uint8Array(size * size);
    const originX = chunkX * this.chunkSize;
    const originZ = chunkZ * this.chunkSize;
    for (let localZ = 0; localZ < size; localZ += 1) {
      for (let localX = 0; localX < size; localX += 1) {
        tiles[localZ * size + localX] = this.tileAt(
          originX + localX - this.margin,
          originZ + localZ - this.margin,
        );
      }
    }
    const field = {
      size,
      originX,
      originZ,
      distances: computeRoadDistanceField(tiles, size, size, this.targetTileId),
    };
    this.cache.set(key, field);
    this.lastChunkX = chunkX;
    this.lastChunkZ = chunkZ;
    this.lastField = field;
    while (this.cache.size > this.maxCachedChunks) {
      this.cache.delete(this.cache.keys().next().value);
      this.stats.cacheEvictions += 1;
    }
    this.stats.builds += 1;
    return field;
  }

  /** Cell distance to the nearest target tile, or Infinity beyond `maxCells`. */
  cellDistanceAt(worldX, worldZ) {
    if (!this.enabled) return Number.POSITIVE_INFINITY;
    const cellX = Math.floor(worldX / this.tileSize);
    const cellZ = Math.floor(-worldZ / this.tileSize);
    const chunkX = Math.floor(cellX / this.chunkSize);
    const chunkZ = Math.floor(cellZ / this.chunkSize);
    const field = this.chunkField(chunkX, chunkZ);
    const localX = cellX - field.originX + this.margin;
    const localZ = cellZ - field.originZ + this.margin;
    if (localX < 0 || localZ < 0 || localX >= field.size || localZ >= field.size) {
      return Number.POSITIVE_INFINITY;
    }
    const distance = field.distances[localZ * field.size + localX];
    // The chamfer pass reports a large sentinel when nothing matched in range;
    // anything past the halo is not a measurement, so report it as unknown.
    return distance > this.maxCells ? Number.POSITIVE_INFINITY : distance;
  }

  /** Distance in world units, or Infinity beyond range. */
  worldDistanceAt(worldX, worldZ) {
    const cells = this.cellDistanceAt(worldX, worldZ);
    return Number.isFinite(cells) ? cells * this.tileSize : cells;
  }
}
