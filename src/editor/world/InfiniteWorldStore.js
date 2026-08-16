import { ProceduralWorldGenerator } from './ProceduralWorldGenerator.js';
import { createWorldGenerator } from './WorldGeneratorFactory.js';
import {
  cellKey,
  cellToChunk,
  chunkCellBounds,
  chunkKey,
  floorDiv,
  parseCellKey,
  parseChunkKey,
  positiveModulo,
} from './WorldCoordinates.js';
import {
  INFINITE_WORLD_FORMAT_VERSION,
  WORLD_HEIGHT_EPSILON,
} from './worldConstants.js';

const VALID_SCULPT_OPERATIONS = new Set(['raise', 'lower', 'smooth']);
const VALID_SCULPT_SHAPES = new Set(['sphere', 'cube']);
const MAX_TILE_ID = 255;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function smoothFalloff(distance, radius) {
  const normalized = clamp(1 - distance / radius, 0, 1);
  return normalized * normalized * (3 - 2 * normalized);
}

function brushDistance(shape, x, z, centerX, centerZ) {
  const offsetX = Math.abs(x - centerX);
  const offsetZ = Math.abs(z - centerZ);
  return shape === 'cube' ? Math.max(offsetX, offsetZ) : Math.hypot(offsetX, offsetZ);
}

function clonePatch(patch) {
  return {
    indices: [...patch.indices],
    before: [...patch.before],
    after: [...patch.after],
  };
}

function assertPositiveInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }
}

function assertFiniteNumber(value, fieldName) {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} must be finite.`);
  }
}

function assertPositiveFiniteNumber(value, fieldName) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive finite number.`);
  }
}

function assertWorldRect(minX, maxX, minZ, maxZ) {
  cellKey(minX, minZ);
  cellKey(maxX, maxZ);
}

function tileIndex(localX, localZ, chunkSize) {
  return localZ * chunkSize + localX;
}

function heightIndex(localX, localZ, vertexSize) {
  return localZ * vertexSize + localX;
}

function groupOverridesByChunk(overrides, chunkSize, isHeight) {
  const grouped = new Map();
  for (const [key, value] of overrides.entries()) {
    const { chunkX: coordinateX, chunkZ: coordinateZ } = parseCellKey(key);
    const chunkX = floorDiv(coordinateX, chunkSize);
    const chunkZ = floorDiv(coordinateZ, chunkSize);
    const localX = positiveModulo(coordinateX, chunkSize);
    const localZ = positiveModulo(coordinateZ, chunkSize);
    const keyForChunk = chunkKey(chunkX, chunkZ);
    const entries = grouped.get(keyForChunk) ?? [];
    entries.push([
      isHeight
        ? heightIndex(localX, localZ, chunkSize + 1)
        : tileIndex(localX, localZ, chunkSize),
      value,
    ]);
    grouped.set(keyForChunk, entries);
  }
  return grouped;
}

export class InfiniteWorldStore {
  constructor({
    chunkSize,
    tileSize,
    cacheLimit = 169,
    generator = new ProceduralWorldGenerator(),
  }) {
    assertPositiveInteger(chunkSize, 'World chunk size');
    assertPositiveInteger(cacheLimit, 'World cache limit');
    assertFiniteNumber(tileSize, 'World tile size');
    if (tileSize <= 0) {
      throw new Error('World tile size must be positive.');
    }

    this.chunkSize = chunkSize;
    this.vertexSize = chunkSize + 1;
    this.tileSize = tileSize;
    this.cacheLimit = cacheLimit;
    this.generator = generator;
    this.baseTerrain = null;
    this.tileOverrides = new Map();
    this.heightOverrides = new Map();
    this.forestEdits = { version: 1, felled: [], planted: [], patches: [] };
    this.cache = new Map();
    // Generated-tile memo, one small typed-array block per chunk. Bounded by
    // block count rather than by cell count so it costs no per-cell bookkeeping.
    this.generatedTileBlocks = new Map();
    this.generatedTileBlockLimit = 512;
    // Heights are 8 bytes per vertex, so this cap is lower than the tile one.
    this.generatedHeightBlocks = new Map();
    this.generatedHeightBlockLimit = 256;
    // Last block touched, to keep string-key lookups off the hot path.
    this.lastTileBlock = null;
    this.lastTileBlockX = 0;
    this.lastTileBlockZ = 0;
    this.lastHeightBlock = null;
    this.lastHeightBlockX = 0;
    this.lastHeightBlockZ = 0;
    this.clock = 0;
    this.revision = 0;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(change) {
    this.revision += 1;
    const snapshot = Object.freeze({ revision: this.revision, ...change });
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('Infinite-world change listener failed.', error);
      }
    }
  }

  /**
   * Memoized procedural tile lookup.
   *
   * `sampleTile` runs fractal noise plus a climate sample per call, and the
   * canonical distance fields scan a chunk plus a wide halo, so neighbouring
   * chunks re-request the same halo cells. Caching the *generated* value is
   * safe without edit invalidation: it depends only on the generator, and
   * overrides are consulted ahead of it. Only replacing the generator
   * (`setBaseTerrain`) can stale it.
   *
   * Cells are memoized in per-chunk typed-array blocks with a `filled` mask, so
   * a lone lookup still costs one sample while a contiguous scan reuses
   * everything its neighbours already generated.
   */
  generatedTileBlock(blockX, blockZ) {
    if (this.lastTileBlock !== null
        && blockX === this.lastTileBlockX
        && blockZ === this.lastTileBlockZ) {
      return this.lastTileBlock;
    }
    const key = chunkKey(blockX, blockZ);
    let block = this.generatedTileBlocks.get(key);
    if (!block) {
      const size = this.chunkSize;
      block = { tiles: new Uint8Array(size * size), filled: new Uint8Array(size * size) };
      if (this.generatedTileBlocks.size >= this.generatedTileBlockLimit) {
        const oldest = this.generatedTileBlocks.keys().next().value;
        this.generatedTileBlocks.delete(oldest);
      }
      this.generatedTileBlocks.set(key, block);
    }
    this.lastTileBlockX = blockX;
    this.lastTileBlockZ = blockZ;
    this.lastTileBlock = block;
    return block;
  }

  generatedTile(cellX, cellZ) {
    const size = this.chunkSize;
    const blockX = Math.floor(cellX / size);
    const blockZ = Math.floor(cellZ / size);
    const block = this.generatedTileBlock(blockX, blockZ);
    const index = (cellZ - blockZ * size) * size + (cellX - blockX * size);
    if (block.filled[index]) return block.tiles[index];
    const tileId = this.generator.sampleTile(cellX, cellZ);
    block.tiles[index] = tileId;
    block.filled[index] = 1;
    return tileId;
  }

  getTile(cellX, cellZ) {
    // Building the string cell key costs an allocation per lookup, and the
    // canonical distance fields make millions of them per frame. An unedited
    // world has no overrides to consult, so skip the key entirely.
    if (this.tileOverrides.size > 0) {
      const override = this.tileOverrides.get(cellKey(cellX, cellZ));
      if (override !== undefined) return override;
    }
    return this.generatedTile(cellX, cellZ);
  }

  setBaseTerrain(baseTerrain) {
    const cloned = baseTerrain ? structuredClone(baseTerrain) : null;
    this.generator = createWorldGenerator(this.generator.toMetadata(), cloned);
    this.baseTerrain = cloned;
    this.cache.clear();
    this.generatedTileBlocks.clear();
    this.generatedHeightBlocks.clear();
    this.lastTileBlock = null;
    this.lastHeightBlock = null;
  }

  /**
   * Height counterpart to `generatedTile`. Slope sampling asks for four heights
   * around every candidate, and each of those bilinearly interpolates four
   * vertices, so a single scatter candidate can drive sixteen `sampleHeight`
   * calls — with heavy overlap between neighbouring candidates. Float64 storage
   * keeps values bit-identical to the generator's output.
   */
  generatedHeightBlock(blockX, blockZ) {
    // Terrain access is strongly spatially coherent, and the Map lookup needs a
    // string key. Remembering the last block keeps that allocation off the hot
    // path — without it, the key churn costs more than the memo saves.
    if (this.lastHeightBlock !== null
        && blockX === this.lastHeightBlockX
        && blockZ === this.lastHeightBlockZ) {
      return this.lastHeightBlock;
    }
    const key = chunkKey(blockX, blockZ);
    let block = this.generatedHeightBlocks.get(key);
    if (!block) {
      const size = this.chunkSize;
      block = { heights: new Float64Array(size * size), filled: new Uint8Array(size * size) };
      if (this.generatedHeightBlocks.size >= this.generatedHeightBlockLimit) {
        const oldest = this.generatedHeightBlocks.keys().next().value;
        this.generatedHeightBlocks.delete(oldest);
      }
      this.generatedHeightBlocks.set(key, block);
    }
    this.lastHeightBlockX = blockX;
    this.lastHeightBlockZ = blockZ;
    this.lastHeightBlock = block;
    return block;
  }

  generatedHeight(vertexX, vertexZ) {
    const size = this.chunkSize;
    const blockX = Math.floor(vertexX / size);
    const blockZ = Math.floor(vertexZ / size);
    const block = this.generatedHeightBlock(blockX, blockZ);
    const index = (vertexZ - blockZ * size) * size + (vertexX - blockX * size);
    if (block.filled[index]) return block.heights[index];
    const height = this.generator.sampleHeight(vertexX, vertexZ);
    block.heights[index] = height;
    block.filled[index] = 1;
    return height;
  }

  getHeight(vertexX, vertexZ) {
    // Same reasoning as `getTile`: an unedited world has no overrides, so skip
    // building the string key on a path that runs millions of times per frame.
    if (this.heightOverrides.size > 0) {
      const override = this.heightOverrides.get(cellKey(vertexX, vertexZ));
      if (override !== undefined) return override;
    }
    return this.generatedHeight(vertexX, vertexZ);
  }

  sampleHeight(cellX, cellZ) {
    const x0 = Math.floor(cellX);
    const z0 = Math.floor(cellZ);
    const x1 = x0 + 1;
    const z1 = z0 + 1;
    const tx = cellX - x0;
    const tz = cellZ - z0;
    // Four distinct corners, read once each — the previous form asked for two of
    // them twice.
    const northWest = this.getHeight(x0, z0);
    const northEast = this.getHeight(x1, z0);
    const southWest = this.getHeight(x0, z1);
    const southEast = this.getHeight(x1, z1);
    const north = northWest + (northEast - northWest) * tx;
    const south = southWest + (southEast - southWest) * tx;
    return north + (south - north) * tz;
  }

  getCellHeight(cellX, cellZ) {
    return this.sampleHeight(cellX + 0.5, cellZ + 0.5);
  }

  setTile(cellX, cellZ, tileId, { silent = false } = {}) {
    if (!Number.isInteger(tileId) || tileId < 0 || tileId > MAX_TILE_ID) {
      throw new Error('Tile id must be an unsigned byte integer.');
    }
    const key = cellKey(cellX, cellZ);
    const before = this.getTile(cellX, cellZ);
    const base = this.generator.sampleTile(cellX, cellZ);
    if (tileId === base) {
      this.tileOverrides.delete(key);
    } else {
      this.tileOverrides.set(key, tileId);
    }
    this.updateCachedTile(cellX, cellZ, tileId);
    if (!silent && before !== tileId) {
      this.emit({ kind: 'tile', cells: Object.freeze([{ x: cellX, z: cellZ }]) });
    }
    return before;
  }

  setHeight(vertexX, vertexZ, value, { silent = false } = {}) {
    assertFiniteNumber(value, 'Height');
    const key = cellKey(vertexX, vertexZ);
    const before = this.getHeight(vertexX, vertexZ);
    const base = this.generator.sampleHeight(vertexX, vertexZ);
    if (Math.abs(value - base) <= WORLD_HEIGHT_EPSILON) {
      this.heightOverrides.delete(key);
    } else {
      this.heightOverrides.set(key, value);
    }
    this.updateCachedHeight(vertexX, vertexZ, value);
    if (!silent && Math.abs(before - value) > WORLD_HEIGHT_EPSILON) {
      this.emit({ kind: 'height', vertices: Object.freeze([{ x: vertexX, z: vertexZ }]) });
    }
    return before;
  }

  paintSquare(centerX, centerZ, brushSize, tileId, canPaint = null) {
    assertWorldRect(centerX, centerX, centerZ, centerZ);
    assertPositiveFiniteNumber(brushSize, 'Paint brush size');
    const radius = Math.floor(brushSize / 2);
    const minimumX = centerX - radius;
    const maximumX = centerX + radius;
    const minimumZ = centerZ - radius;
    const maximumZ = centerZ + radius;
    assertWorldRect(minimumX, maximumX, minimumZ, maximumZ);

    const patch = { indices: [], before: [], after: [] };
    const changedCells = [];
    for (let z = minimumZ; z <= maximumZ; z += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        if (canPaint && !canPaint(x, z, null, tileId)) {
          continue;
        }
        const before = this.getTile(x, z);
        if (before === tileId) {
          continue;
        }
        this.setTile(x, z, tileId, { silent: true });
        patch.indices.push(cellKey(x, z));
        patch.before.push(before);
        patch.after.push(tileId);
        changedCells.push(Object.freeze({ x, z }));
      }
    }
    if (changedCells.length > 0) {
      this.emit({ kind: 'tile', cells: Object.freeze(changedCells) });
    }
    return patch;
  }

  sculpt({
    centerX,
    centerZ,
    brushSize,
    shape = 'sphere',
    operation,
    strength,
    smoothFactor,
    minHeight,
    maxHeight,
    canEdit = null,
  }) {
    if (!VALID_SCULPT_OPERATIONS.has(operation)) {
      throw new Error(`Unknown heightfield operation: ${operation}.`);
    }
    if (!VALID_SCULPT_SHAPES.has(shape)) {
      throw new Error(`Unknown heightfield brush shape: ${shape}.`);
    }
    assertWorldRect(centerX, centerX, centerZ, centerZ);
    assertPositiveFiniteNumber(brushSize, 'Heightfield brush size');
    assertFiniteNumber(strength, 'Heightfield strength');
    assertFiniteNumber(smoothFactor, 'Heightfield smooth factor');
    assertFiniteNumber(minHeight, 'Heightfield minimum height');
    assertFiniteNumber(maxHeight, 'Heightfield maximum height');
    if (minHeight > maxHeight) {
      throw new Error('Heightfield minimum height must not exceed maximum height.');
    }

    const radius = Math.max(1, (brushSize + 1) / 2);
    const centerVertexX = centerX + 0.5;
    const centerVertexZ = centerZ + 0.5;
    const minimumX = Math.floor(centerVertexX - radius);
    const maximumX = Math.ceil(centerVertexX + radius);
    const minimumZ = Math.floor(centerVertexZ - radius);
    const maximumZ = Math.ceil(centerVertexZ + radius);
    const halo = operation === 'smooth' ? 1 : 0;
    assertWorldRect(
      minimumX - halo,
      maximumX + halo,
      minimumZ - halo,
      maximumZ + halo,
    );

    const source = new Map();
    if (operation === 'smooth') {
      for (let z = minimumZ - 1; z <= maximumZ + 1; z += 1) {
        for (let x = minimumX - 1; x <= maximumX + 1; x += 1) {
          source.set(cellKey(x, z), this.getHeight(x, z));
        }
      }
    }

    const patch = { indices: [], before: [], after: [] };
    const vertices = [];
    for (let z = minimumZ; z <= maximumZ; z += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        const distance = brushDistance(shape, x, z, centerVertexX, centerVertexZ);
        if (distance > radius || (canEdit && !canEdit(x, z, null))) {
          continue;
        }
        const before = this.getHeight(x, z);
        const falloff = smoothFalloff(distance, radius);
        let after = before;
        if (operation === 'raise') {
          after = clamp(before + strength * falloff, minHeight, maxHeight);
        } else if (operation === 'lower') {
          after = clamp(before - strength * falloff, minHeight, maxHeight);
        } else {
          let total = 0;
          let count = 0;
          for (let neighborZ = z - 1; neighborZ <= z + 1; neighborZ += 1) {
            for (let neighborX = x - 1; neighborX <= x + 1; neighborX += 1) {
              total += source.get(cellKey(neighborX, neighborZ));
              count += 1;
            }
          }
          after = clamp(before + (total / count - before) * smoothFactor * falloff, minHeight, maxHeight);
        }
        if (Math.abs(after - before) <= WORLD_HEIGHT_EPSILON) {
          continue;
        }
        this.setHeight(x, z, after, { silent: true });
        patch.indices.push(cellKey(x, z));
        patch.before.push(before);
        patch.after.push(after);
        vertices.push(Object.freeze({ x, z }));
      }
    }
    if (vertices.length > 0) {
      this.emit({ kind: 'height', vertices: Object.freeze(vertices) });
    }
    return patch;
  }

  applyTilePatch(patch, direction) {
    const values = direction === 'undo' ? patch.before : patch.after;
    const cells = [];
    for (let offset = 0; offset < patch.indices.length; offset += 1) {
      const { chunkX: x, chunkZ: z } = parseCellKey(patch.indices[offset]);
      this.setTile(x, z, values[offset], { silent: true });
      cells.push(Object.freeze({ x, z }));
    }
    if (cells.length > 0) {
      this.emit({ kind: 'tile', cells: Object.freeze(cells) });
    }
  }

  applyHeightPatch(patch, direction) {
    const values = direction === 'undo' ? patch.before : patch.after;
    const vertices = [];
    for (let offset = 0; offset < patch.indices.length; offset += 1) {
      const { chunkX: x, chunkZ: z } = parseCellKey(patch.indices[offset]);
      this.setHeight(x, z, values[offset], { silent: true });
      vertices.push(Object.freeze({ x, z }));
    }
    if (vertices.length > 0) {
      this.emit({ kind: 'height', vertices: Object.freeze(vertices) });
    }
  }

  getChunk(chunkX, chunkZ) {
    const key = chunkKey(chunkX, chunkZ);
    let page = this.cache.get(key);
    this.clock += 1;
    if (!page) {
      page = this.generateChunk(chunkX, chunkZ);
      this.cache.set(key, page);
    }
    page.lastUsed = this.clock;
    this.evictCache();
    return page;
  }

  requestChunk(chunkX, chunkZ) {
    return Promise.resolve(this.getChunk(chunkX, chunkZ));
  }

  generateChunk(chunkX, chunkZ) {
    const { minX: originX, minZ: originZ } = chunkCellBounds(
      chunkX,
      chunkZ,
      this.chunkSize,
    );
    const tiles = new Uint8Array(this.chunkSize * this.chunkSize);
    const heights = new Float32Array(this.vertexSize * this.vertexSize);
    for (let localZ = 0; localZ < this.chunkSize; localZ += 1) {
      for (let localX = 0; localX < this.chunkSize; localX += 1) {
        tiles[tileIndex(localX, localZ, this.chunkSize)] = this.getTile(originX + localX, originZ + localZ);
      }
    }
    for (let localZ = 0; localZ <= this.chunkSize; localZ += 1) {
      for (let localX = 0; localX <= this.chunkSize; localX += 1) {
        heights[heightIndex(localX, localZ, this.vertexSize)] = this.getHeight(originX + localX, originZ + localZ);
      }
    }
    const page = {
      key: chunkKey(chunkX, chunkZ),
      chunkX,
      chunkZ,
      originX,
      originZ,
      tiles,
      heights,
      revision: this.revision,
      lastUsed: this.clock,
    };
    return page;
  }

  updateCachedTile(cellX, cellZ, tileId) {
    const location = cellToChunk(cellX, cellZ, this.chunkSize);
    const page = this.cache.get(chunkKey(location.chunkX, location.chunkZ));
    if (page) {
      page.tiles[tileIndex(location.localX, location.localZ, this.chunkSize)] = tileId;
      page.revision = this.revision + 1;
      page.renderPixelsDirty = true;
    }
  }

  updateCachedHeight(vertexX, vertexZ, value) {
    const primaryChunkX = floorDiv(vertexX, this.chunkSize);
    const primaryChunkZ = floorDiv(vertexZ, this.chunkSize);
    for (let chunkZ = primaryChunkZ - 1; chunkZ <= primaryChunkZ; chunkZ += 1) {
      for (let chunkX = primaryChunkX - 1; chunkX <= primaryChunkX; chunkX += 1) {
        const localX = vertexX - chunkX * this.chunkSize;
        const localZ = vertexZ - chunkZ * this.chunkSize;
        if (localX < 0 || localZ < 0 || localX > this.chunkSize || localZ > this.chunkSize) {
          continue;
        }
        const page = this.cache.get(chunkKey(chunkX, chunkZ));
        if (page) {
          page.heights[heightIndex(localX, localZ, this.vertexSize)] = value;
          page.revision = this.revision + 1;
          // Heights do not affect tile/surface mask pixels.
        }
      }
    }
  }

  evictCache() {
    if (this.cache.size <= this.cacheLimit) {
      return;
    }
    const pages = [...this.cache.values()].sort((left, right) => left.lastUsed - right.lastUsed || left.key.localeCompare(right.key));
    while (this.cache.size > this.cacheLimit && pages.length > 0) {
      this.cache.delete(pages.shift().key);
    }
  }

  clearOverrides() {
    const snapshot = this.createSnapshot({ cloneBaseTerrain: false });
    if (this.tileOverrides.size === 0 && this.heightOverrides.size === 0) {
      return snapshot;
    }
    this.tileOverrides.clear();
    this.heightOverrides.clear();
    this.cache.clear();
    this.emit({ kind: 'reset' });
    return snapshot;
  }

  createSnapshot({ cloneBaseTerrain = true } = {}) {
    return Object.freeze({
      tileOverrides: Object.freeze([...this.tileOverrides.entries()]),
      heightOverrides: Object.freeze([...this.heightOverrides.entries()]),
      baseTerrain: this.baseTerrain
        ? (cloneBaseTerrain ? structuredClone(this.baseTerrain) : this.baseTerrain)
        : null,
      forestEdits: structuredClone(this.forestEdits),
    });
  }

  restoreSnapshot(snapshot, { emit = true } = {}) {
    this.setBaseTerrain(snapshot?.baseTerrain ?? null);
    this.tileOverrides = new Map(snapshot?.tileOverrides ?? []);
    this.heightOverrides = new Map(snapshot?.heightOverrides ?? []);
    this.forestEdits = structuredClone(
      snapshot?.forestEdits ?? { version: 1, felled: [], planted: [], patches: [] },
    );
    this.cache.clear();
    if (emit) this.emit({ kind: 'reset' });
  }

  toDocument() {
    const tileChunks = groupOverridesByChunk(this.tileOverrides, this.chunkSize, false);
    const heightChunks = groupOverridesByChunk(this.heightOverrides, this.chunkSize, true);
    const keys = new Set([...tileChunks.keys(), ...heightChunks.keys()]);
    const chunks = [...keys].sort().map((key) => {
      const { chunkX: x, chunkZ: z } = parseChunkKey(key);
      return {
        x,
        z,
        tiles: tileChunks.get(key) ?? [],
        heights: heightChunks.get(key) ?? [],
      };
    });
    return {
      version: INFINITE_WORLD_FORMAT_VERSION,
      world: {
        chunkSize: this.chunkSize,
        tileSize: this.tileSize,
        generator: this.generator.toMetadata(),
        ...(this.baseTerrain ? { baseTerrain: structuredClone(this.baseTerrain) } : {}),
      },
      chunks,
      forestEdits: structuredClone(this.forestEdits),
      savedAt: new Date().toISOString(),
    };
  }

  loadDocument(document) {
    const previous = this.createSnapshot({ cloneBaseTerrain: false });
    try {
      if (document?.version !== INFINITE_WORLD_FORMAT_VERSION) {
        throw new Error(
          'This file uses an older dense map format that is no longer supported. '
          + 'Use a current infinite-world save, or import Azgaar Full JSON.',
        );
      }
      this.loadInfiniteDocument(document);
      this.cache.clear();
      this.emit({ kind: 'reset' });
    } catch (error) {
      try {
        this.restoreSnapshot(previous, { emit: false });
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'World load failed and the previous world could not be restored.',
        );
      }
      throw error;
    }
  }

  loadInfiniteDocument(document) {
    if (document.world?.chunkSize !== this.chunkSize || document.world?.tileSize !== this.tileSize) {
      throw new Error('Infinite world chunk or tile size does not match the editor configuration.');
    }
    if (!Array.isArray(document.chunks)) {
      throw new Error('Infinite world chunks must be an array.');
    }

    const tileOverrides = new Map();
    const heightOverrides = new Map();
    for (const chunk of document.chunks) {
      if (!Number.isSafeInteger(chunk?.x) || !Number.isSafeInteger(chunk?.z)) {
        throw new Error('Infinite world chunk coordinates must be safe integers.');
      }
      const tileEntries = chunk.tiles ?? [];
      const heightEntries = chunk.heights ?? [];
      if (!Array.isArray(tileEntries) || !Array.isArray(heightEntries)) {
        throw new Error('Infinite world chunk overrides must be arrays.');
      }
      for (const entry of tileEntries) {
        if (!Array.isArray(entry) || entry.length < 2) {
          throw new Error('Infinite world tile override must be an [index, value] pair.');
        }
        const [index, value] = entry;
        if (!Number.isInteger(index) || index < 0 || index >= this.chunkSize ** 2) {
          throw new Error('Infinite world tile override index is invalid.');
        }
        if (!Number.isInteger(value) || value < 0 || value > MAX_TILE_ID) {
          throw new Error('Infinite world tile override value must be an unsigned byte.');
        }
        const localX = index % this.chunkSize;
        const localZ = Math.floor(index / this.chunkSize);
        tileOverrides.set(
          cellKey(chunk.x * this.chunkSize + localX, chunk.z * this.chunkSize + localZ),
          value,
        );
      }
      for (const entry of heightEntries) {
        if (!Array.isArray(entry) || entry.length < 2) {
          throw new Error('Infinite world height override must be an [index, value] pair.');
        }
        const [index, value] = entry;
        if (!Number.isInteger(index) || index < 0 || index >= this.vertexSize ** 2 || !Number.isFinite(value)) {
          throw new Error('Infinite world height override is invalid.');
        }
        const localX = index % this.vertexSize;
        const localZ = Math.floor(index / this.vertexSize);
        heightOverrides.set(
          cellKey(chunk.x * this.chunkSize + localX, chunk.z * this.chunkSize + localZ),
          value,
        );
      }
    }

    this.setBaseTerrain(document.world?.baseTerrain ?? null);
    this.tileOverrides = tileOverrides;
    this.heightOverrides = heightOverrides;
    this.forestEdits = structuredClone(
      document.forestEdits ?? { version: 1, felled: [], planted: [], patches: [] },
    );
  }

  getStats() {
    return Object.freeze({
      cacheSize: this.cache.size,
      cacheLimit: this.cacheLimit,
      tileOverrideCount: this.tileOverrides.size,
      heightOverrideCount: this.heightOverrides.size,
      revision: this.revision,
      baseTerrainKind: this.baseTerrain?.kind ?? null,
    });
  }

  clonePatch(patch) {
    return clonePatch(patch);
  }
}
