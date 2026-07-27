import { InfiniteWorldStore } from './InfiniteWorldStore.js';
import {
  decodeChunkDocument,
  encodeChunkDocument,
} from './ChunkDocumentCodec.js';
import {
  createSurfaceMaskConfig,
  enrichPageRenderPixels,
  getSurfaceMaskSearchRadius,
} from './ChunkRenderPixels.js';
import { resolveWaterDomainVersion } from '../water/WaterConfig.js';
import { cellKey, chunkKey, parseCellKey } from './WorldCoordinates.js';

function tileIndex(localX, localZ, chunkSize) {
  return localZ * chunkSize + localX;
}

function heightIndex(localX, localZ, vertexSize) {
  return localZ * vertexSize + localX;
}

function assertGeneratorMetadata(actual, expected) {
  const fields = ['seed', 'version', 'heightScale', 'seaLevel'];
  for (const field of fields) {
    if (actual?.[field] !== expected[field]) {
      throw new Error(`World generator ${field} does not match the active editor configuration.`);
    }
  }
  if (resolveWaterDomainVersion(actual?.waterDomainVersion)
      !== resolveWaterDomainVersion(expected.waterDomainVersion)) {
    throw new Error('World water-domain version does not match the active editor configuration.');
  }
}

export class WorkerBackedWorldStore extends InfiniteWorldStore {
  constructor({
    chunkWorker,
    surfaceMaskConfig = null,
    contentProvider = null,
    ...options
  }) {
    super(options);
    this.chunkWorker = chunkWorker;
    this.contentProvider = contentProvider;
    this.surfaceMaskConfig = surfaceMaskConfig ?? createSurfaceMaskConfig(null);
    this.pendingChunks = new Map();
    this.baseTerrainRevision = 0;
  }

  setBaseTerrain(baseTerrain) {
    super.setBaseTerrain(baseTerrain);
    this.baseTerrainRevision = (this.baseTerrainRevision ?? 0) + 1;
    this.chunkWorker.setBaseTerrain?.(this.baseTerrain);
  }

  requestChunk(chunkX, chunkZ, { priority = 0 } = {}) {
    const key = chunkKey(chunkX, chunkZ);
    const cached = this.cache.get(key);
    if (cached) {
      this.clock += 1;
      cached.lastUsed = this.clock;
      return Promise.resolve(cached);
    }
    const pending = this.pendingChunks.get(key);
    if (pending) {
      // Already in flight — nudge its priority in case it became more urgent.
      this.chunkWorker.reprioritize?.(chunkX, chunkZ, priority);
      return pending;
    }

    const sourceRevision = this.baseTerrainRevision;
    const contentRequest = this.contentProvider
      ? this.contentProvider.getChunk(this.getContentWorldId(), chunkX, chunkZ)
      : Promise.resolve(null);
    let request;
    request = Promise.all([
      this.chunkWorker.request(chunkX, chunkZ, { priority }),
      contentRequest,
    ])
      .then(([page, content]) => {
        if (sourceRevision !== this.baseTerrainRevision) {
          const error = new Error('World chunk request superseded by a base terrain change.');
          error.cancelled = true;
          throw error;
        }
        return this.completeWorkerPage({
          ...page,
          ...(content ? { content } : {}),
        });
      })
      .finally(() => {
        if (this.pendingChunks.get(key) === request) {
          this.pendingChunks.delete(key);
        }
      });
    this.pendingChunks.set(key, request);
    return request;
  }

  getContentWorldId() {
    return String(
      this.baseTerrain?.source?.mapId
      ?? this.baseTerrain?.source?.seed
      ?? `seed-${this.generator.toMetadata().seed}`,
    );
  }

  /** Drop a not-yet-started generation request for a chunk leaving residency. */
  cancelChunk(chunkX, chunkZ) {
    return this.chunkWorker.cancel?.(chunkX, chunkZ) ?? false;
  }

  refreshPageRenderPixels(page) {
    const maskConfig = this.generator.getSurfaceMaskConfig?.(this.surfaceMaskConfig)
      ?? this.surfaceMaskConfig;
    // Overrides invalidate worker-built scatter; main-thread grass/flower rebuild
    // will regenerate from tiles/heights.
    delete page.grassScatter;
    delete page.flowerScatter;
    return enrichPageRenderPixels(
      page,
      (cellX, cellZ) => this.getTile(cellX, cellZ),
      maskConfig,
      (tileId) => this.generator.getTileDefinition?.(tileId),
    );
  }

  hasHaloTileOverrides(originX, originZ) {
    if (this.tileOverrides.size === 0) {
      return false;
    }
    const searchRadius = getSurfaceMaskSearchRadius(this.surfaceMaskConfig.blendCells);
    const minX = originX - searchRadius;
    const maxX = originX + this.chunkSize - 1 + searchRadius;
    const minZ = originZ - searchRadius;
    const maxZ = originZ + this.chunkSize - 1 + searchRadius;
    for (const key of this.tileOverrides.keys()) {
      const { chunkX: cellX, chunkZ: cellZ } = parseCellKey(key);
      if (cellX >= minX && cellX <= maxX && cellZ >= minZ && cellZ <= maxZ) {
        return true;
      }
    }
    return false;
  }

  completeWorkerPage(page) {
    const current = this.cache.get(page.key);
    if (current) {
      return current;
    }
    const { originX, originZ } = page;
    let appliedOverrides = false;
    for (let localZ = 0; localZ < this.chunkSize; localZ += 1) {
      for (let localX = 0; localX < this.chunkSize; localX += 1) {
        const override = this.tileOverrides.get(cellKey(originX + localX, originZ + localZ));
        if (override !== undefined) {
          page.tiles[tileIndex(localX, localZ, this.chunkSize)] = override;
          appliedOverrides = true;
        }
      }
    }
    for (let localZ = 0; localZ <= this.chunkSize; localZ += 1) {
      for (let localX = 0; localX <= this.chunkSize; localX += 1) {
        const override = this.heightOverrides.get(cellKey(originX + localX, originZ + localZ));
        if (override !== undefined) {
          page.heights[heightIndex(localX, localZ, this.vertexSize)] = override;
        }
      }
    }

    const pixelsMissing = !page.tilePixels || !page.surfaceMaskPixels;
    // Neighbor painted roads/water sit outside this page's tiles but inside the path halo.
    const neighborHaloDirty = this.hasHaloTileOverrides(originX, originZ);
    if (appliedOverrides || pixelsMissing || page.renderPixelsDirty || neighborHaloDirty) {
      this.refreshPageRenderPixels(page);
    }

    this.clock += 1;
    const completed = {
      ...page,
      revision: this.revision,
      lastUsed: this.clock,
    };
    this.cache.set(page.key, completed);
    this.evictCache();
    return completed;
  }

  toDocument() {
    const document = super.toDocument();
    return {
      ...document,
      chunks: document.chunks.map((chunk) => encodeChunkDocument(chunk, this.chunkSize)),
    };
  }

  loadInfiniteDocument(document) {
    assertGeneratorMetadata(document.world?.generator, this.generator.toMetadata());
    super.loadInfiniteDocument({
      ...document,
      chunks: document.chunks?.map((chunk) => decodeChunkDocument(chunk, this.chunkSize)),
    });
  }

  clearOverrides() {
    this.pendingChunks.clear();
    return super.clearOverrides();
  }

  restoreSnapshot(snapshot) {
    this.pendingChunks.clear();
    super.restoreSnapshot(snapshot);
  }

  loadDocument(document) {
    this.pendingChunks.clear();
    super.loadDocument(document);
  }

  dispose() {
    this.pendingChunks.clear();
    this.chunkWorker.dispose();
  }
}
