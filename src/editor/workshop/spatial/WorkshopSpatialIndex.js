import {
  DEFAULT_WORKSHOP_SPATIAL_CELL_SIZE,
  DEFAULT_WORKSHOP_SPATIAL_MAX_QUERY_CELLS,
} from './WorkshopSpatialConstants.js';
import {
  normalizeWorkshopSpatialBounds,
  workshopBoundsIntersect,
  workshopEntitySpatialBounds,
} from './WorkshopSpatialBounds.js';

function positive(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive finite number.`);
  }
  return value;
}

function positiveInteger(value, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive safe integer.`);
  return value;
}

function normalizeDocument(document) {
  if (!document || typeof document.listEntities !== 'function' || typeof document.getEntity !== 'function') {
    throw new Error('Workshop spatial index requires a workshop document.');
  }
  return document;
}

function cellKey(x, z) {
  return `${x}:${z}`;
}

function compareCellKeys(left, right) {
  const [lx, lz] = left.split(':').map(Number);
  const [rx, rz] = right.split(':').map(Number);
  return lx - rx || lz - rz;
}

export class WorkshopSpatialIndex {
  #entries = new Map();
  #cells = new Map();

  constructor(documentInput, {
    cellSize = DEFAULT_WORKSHOP_SPATIAL_CELL_SIZE,
    maxQueryCells = DEFAULT_WORKSHOP_SPATIAL_MAX_QUERY_CELLS,
  } = {}) {
    this.cellSize = positive(cellSize, 'Workshop spatial cell size');
    this.maxQueryCells = positiveInteger(maxQueryCells, 'Workshop spatial max query cells');
    const document = normalizeDocument(documentInput);
    this.revision = document.revision ?? 0;
    for (const entity of document.listEntities()) this.#upsertEntity(entity);
  }

  #keysForBounds(bounds) {
    const minX = Math.floor(bounds.min[0] / this.cellSize);
    const maxX = Math.floor(bounds.max[0] / this.cellSize);
    const minZ = Math.floor(bounds.min[1] / this.cellSize);
    const maxZ = Math.floor(bounds.max[1] / this.cellSize);
    const count = (maxX - minX + 1) * (maxZ - minZ + 1);
    if (count > this.maxQueryCells) {
      throw new Error(`Workshop spatial query exceeds ${this.maxQueryCells} cells.`);
    }
    const keys = [];
    for (let x = minX; x <= maxX; x += 1) {
      for (let z = minZ; z <= maxZ; z += 1) keys.push(cellKey(x, z));
    }
    return keys.sort(compareCellKeys);
  }

  #removeEntity(entityId) {
    const entry = this.#entries.get(entityId);
    if (!entry) return;
    for (const key of entry.cells) {
      const bucket = this.#cells.get(key);
      bucket?.delete(entityId);
      if (bucket?.size === 0) this.#cells.delete(key);
    }
    this.#entries.delete(entityId);
  }

  #upsertEntity(entity) {
    this.#removeEntity(entity.id);
    const bounds = workshopEntitySpatialBounds(entity);
    if (!bounds) return;
    const cells = this.#keysForBounds(bounds);
    this.#entries.set(entity.id, Object.freeze({ entityId: entity.id, bounds, cells: Object.freeze(cells) }));
    for (const key of cells) {
      const bucket = this.#cells.get(key) ?? new Set();
      bucket.add(entity.id);
      this.#cells.set(key, bucket);
    }
  }

  update(documentInput, entityIds) {
    const document = normalizeDocument(documentInput);
    if (!Array.isArray(entityIds)) throw new Error('Workshop spatial update ids must be an array.');
    for (const entityId of [...new Set(entityIds)].sort()) {
      this.#removeEntity(entityId);
      const entity = document.getEntity(entityId);
      if (entity) this.#upsertEntity(entity);
    }
    this.revision = document.revision ?? this.revision;
    return this;
  }

  has(entityId) {
    return this.#entries.has(entityId);
  }

  boundsOf(entityId) {
    return this.#entries.get(entityId)?.bounds ?? null;
  }

  indexedEntityIds() {
    return Object.freeze([...this.#entries.keys()].sort());
  }

  queryBounds(boundsInput, { excludeIds = [] } = {}) {
    const bounds = normalizeWorkshopSpatialBounds(boundsInput);
    const excluded = new Set(excludeIds);
    const candidateIds = new Set();
    for (const key of this.#keysForBounds(bounds)) {
      for (const entityId of this.#cells.get(key) ?? []) candidateIds.add(entityId);
    }
    return Object.freeze([...candidateIds]
      .filter((entityId) => !excluded.has(entityId) && workshopBoundsIntersect(this.#entries.get(entityId).bounds, bounds))
      .sort());
  }

  queryRadius(centerInput, radius, options = {}) {
    if (!Array.isArray(centerInput) || centerInput.length !== 2) throw new Error('Workshop spatial radius center must be a 2D point.');
    const center = centerInput.map((value) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Workshop spatial radius center must be finite.');
      return value;
    });
    positive(radius, 'Workshop spatial query radius');
    const candidates = this.queryBounds({
      min: [center[0] - radius, center[1] - radius],
      max: [center[0] + radius, center[1] + radius],
    }, options);
    const radiusSquared = radius * radius;
    return Object.freeze(candidates.filter((entityId) => {
      const bounds = this.#entries.get(entityId).bounds;
      const x = Math.max(bounds.min[0], Math.min(center[0], bounds.max[0]));
      const z = Math.max(bounds.min[1], Math.min(center[1], bounds.max[1]));
      return (x - center[0]) ** 2 + (z - center[1]) ** 2 <= radiusSquared;
    }));
  }

  neighborsOf(entityId, padding = 0) {
    if (typeof padding !== 'number' || !Number.isFinite(padding) || padding < 0) {
      throw new Error('Workshop spatial neighbor padding must be a non-negative finite number.');
    }
    const bounds = this.boundsOf(entityId);
    if (!bounds) return Object.freeze([]);
    return this.queryBounds({
      min: [bounds.min[0] - padding, bounds.min[1] - padding],
      max: [bounds.max[0] + padding, bounds.max[1] + padding],
    }, { excludeIds: [entityId] });
  }
}
