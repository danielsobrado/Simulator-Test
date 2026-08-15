import { ObjectSpatialIndex } from './ObjectSpatialIndex.js';

const MAX_OBJECT_FOOTPRINT_CELLS = 65_536;

function normalizeRotation(rotation) {
  const numeric = Number(rotation ?? 0);
  if (!Number.isInteger(numeric)) {
    throw new Error('Object rotation must be an integer quarter-turn.');
  }
  return ((numeric % 4) + 4) % 4;
}

function cloneObject(object) {
  return object ? { ...object } : null;
}

function supportsTerrain(tileMap, definition, tileId) {
  if (definition.allowedTileIds.includes(tileId)) return true;
  const terrainClass = tileMap.getTileDefinition?.(tileId)?.terrainClass;
  return Boolean(terrainClass && definition.allowedTerrainClasses?.includes(terrainClass));
}

function validCellCoordinate(value) {
  return Number.isSafeInteger(value);
}

function assertValidDefinition(definition) {
  if (!definition || typeof definition !== 'object'
    || typeof definition.key !== 'string' || definition.key.length === 0
    || !definition.footprint || typeof definition.footprint !== 'object') {
    throw new Error('Cannot register an invalid object definition.');
  }
  const { width, depth } = definition.footprint;
  if (!Number.isSafeInteger(width) || width < 1
    || !Number.isSafeInteger(depth) || depth < 1) {
    throw new Error(`Object definition "${definition.key}" footprint must use positive safe integer dimensions.`);
  }
  if (width > MAX_OBJECT_FOOTPRINT_CELLS
    || depth > MAX_OBJECT_FOOTPRINT_CELLS
    || width * depth > MAX_OBJECT_FOOTPRINT_CELLS) {
    throw new Error(`Object definition "${definition.key}" footprint exceeds ${MAX_OBJECT_FOOTPRINT_CELLS} cells.`);
  }
}

export class ObjectMap {
  constructor({ tileMap, objectCatalog }) {
    this.tileMap = tileMap;
    this.catalog = objectCatalog;
    for (const definition of objectCatalog) assertValidDefinition(definition);
    this.definitionByKey = new Map(objectCatalog.map((definition) => [definition.key, definition]));
    this.objectsById = new Map();
    this.occupancy = new Map();
    this.nextId = 1;
    this.replacing = false;
    this.spatialIndex = new ObjectSpatialIndex({
      bucketSize: tileMap.chunkSize,
      boundsForObject: (object) => this.getBounds(
        object.x, object.z, object.definitionKey, object.rotation,
      ),
    });
  }

  get size() {
    return this.objectsById.size;
  }

  list() {
    return Array.from(this.objectsById.values(), cloneObject);
  }

  getById(id) {
    return cloneObject(this.objectsById.get(Number(id)) ?? null);
  }

  findAt(x, z) {
    if (!this.tileMap.inBounds(x, z)) {
      return null;
    }
    const id = this.occupancy.get(this.tileMap.indexOf(x, z));
    return id === undefined ? null : this.getById(id);
  }

  getDefinition(definitionKey) {
    const definition = this.definitionByKey.get(definitionKey);
    if (!definition) {
      throw new Error(`Unknown object definition: ${definitionKey}.`);
    }
    return definition;
  }

  registerDefinition(definition) {
    assertValidDefinition(definition);
    this.definitionByKey.set(definition.key, definition);
    return definition;
  }

  getFootprint(definitionKey, rotation) {
    const definition = this.getDefinition(definitionKey);
    assertValidDefinition(definition);
    const normalized = normalizeRotation(rotation);
    return normalized % 2 === 0
      ? definition.footprint
      : { width: definition.footprint.depth, depth: definition.footprint.width };
  }

  getBounds(x, z, definitionKey, rotation) {
    const footprint = this.getFootprint(definitionKey, rotation);
    const minX = x - Math.floor((footprint.width - 1) / 2);
    const minZ = z - Math.floor((footprint.depth - 1) / 2);
    return {
      minX,
      minZ,
      maxX: minX + footprint.width - 1,
      maxZ: minZ + footprint.depth - 1,
      width: footprint.width,
      depth: footprint.depth,
    };
  }

  getCells(x, z, definitionKey, rotation) {
    const bounds = this.getBounds(x, z, definitionKey, rotation);
    const cells = [];
    for (let cellZ = bounds.minZ; cellZ <= bounds.maxZ; cellZ += 1) {
      for (let cellX = bounds.minX; cellX <= bounds.maxX; cellX += 1) {
        cells.push({ x: cellX, z: cellZ });
      }
    }
    return cells;
  }

  get revision() {
    return this.spatialIndex.revision;
  }

  queryBounds(bounds) {
    return this.spatialIndex.query(bounds).map(cloneObject);
  }

  signatureForBounds(bounds) {
    return this.spatialIndex.signature(bounds);
  }

  validatePlacement({ definitionKey, x, z, rotation = 0, ignoreObjectId = null }) {
    if (!validCellCoordinate(x) || !validCellCoordinate(z)) {
      return {
        valid: false,
        reason: 'Object coordinates must be safe integer cells.',
        cells: [],
      };
    }
    const definition = this.getDefinition(definitionKey);
    const cells = this.getCells(x, z, definitionKey, rotation);

    for (const cell of cells) {
      if (!this.tileMap.inBounds(cell.x, cell.z)) {
        return { valid: false, reason: 'Footprint is outside the supported world range.', cells };
      }
      const occupantId = this.occupancy.get(this.tileMap.indexOf(cell.x, cell.z));
      if (occupantId !== undefined && occupantId !== ignoreObjectId) {
        return { valid: false, reason: 'Footprint overlaps another object.', cells };
      }
      const tileId = this.tileMap.get(cell.x, cell.z);
      if (!supportsTerrain(this.tileMap, definition, tileId)) {
        return { valid: false, reason: 'The terrain does not support this object.', cells };
      }
    }

    return { valid: true, reason: null, cells };
  }

  place({ definitionKey, x, z, rotation = 0 }) {
    const normalizedRotation = normalizeRotation(rotation);
    const validation = this.validatePlacement({ definitionKey, x, z, rotation: normalizedRotation });
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    const object = {
      id: this.nextId,
      definitionKey,
      x,
      z,
      rotation: normalizedRotation,
    };
    this.nextId += 1;
    this.objectsById.set(object.id, object);
    this.writeOccupancy(object, object.id);
    this.spatialIndex.add(object);
    return cloneObject(object);
  }

  transform(id, { x, z, rotation }) {
    const numericId = Number(id);
    const current = this.objectsById.get(numericId);
    if (!current) {
      throw new Error(`Unknown object id: ${id}.`);
    }

    const next = {
      ...current,
      x: Number.isInteger(x) ? x : current.x,
      z: Number.isInteger(z) ? z : current.z,
      rotation: normalizeRotation(rotation ?? current.rotation),
    };
    const validation = this.validatePlacement({ ...next, ignoreObjectId: numericId });
    if (!validation.valid) {
      throw new Error(validation.reason);
    }

    this.spatialIndex.remove(current);
    this.writeOccupancy(current, null);
    this.objectsById.set(numericId, next);
    this.writeOccupancy(next, numericId);
    this.spatialIndex.add(next);
    return cloneObject(next);
  }

  remove(id) {
    const numericId = Number(id);
    const object = this.objectsById.get(numericId);
    if (!object) {
      return null;
    }
    this.writeOccupancy(object, null);
    this.objectsById.delete(numericId);
    this.spatialIndex.remove(object);
    return cloneObject(object);
  }

  restore(object) {
    if (!object || !Number.isSafeInteger(object.id) || object.id < 1) {
      throw new Error('Object snapshot has an invalid id.');
    }
    if (this.objectsById.has(object.id)) {
      throw new Error(`Object id ${object.id} already exists.`);
    }
    const snapshot = {
      id: object.id,
      definitionKey: object.definitionKey,
      x: object.x,
      z: object.z,
      rotation: normalizeRotation(object.rotation),
    };
    const validation = this.validatePlacement(snapshot);
    if (!validation.valid) {
      throw new Error(validation.reason);
    }
    this.objectsById.set(snapshot.id, snapshot);
    this.writeOccupancy(snapshot, snapshot.id);
    if (!this.replacing) this.spatialIndex.add(snapshot);
    this.nextId = Math.max(this.nextId, snapshot.id + 1);
    return cloneObject(snapshot);
  }

  applyChange(change, direction) {
    const target = direction === 'undo' ? change.before : change.after;
    const source = direction === 'undo' ? change.after : change.before;
    if (source) {
      this.remove(source.id);
    }
    if (target) {
      this.restore(target);
    }
  }

  canSetTerrain(x, z, tileId) {
    const object = this.findAt(x, z);
    if (!object) {
      return true;
    }
    return supportsTerrain(this.tileMap, this.getDefinition(object.definitionKey), tileId);
  }

  clear() {
    const snapshots = this.list();
    this.objectsById.clear();
    this.occupancy.clear();
    this.spatialIndex.clear();
    return snapshots;
  }

  replaceAll(objects) {
    if (!Array.isArray(objects)) {
      throw new Error('Object payload must be an array.');
    }

    const previousObjects = this.objectsById;
    const previousOccupancy = this.occupancy;
    const previousNextId = this.nextId;
    this.objectsById = new Map();
    this.occupancy = new Map();
    this.nextId = 1;
    this.replacing = true;

    try {
      for (const object of objects) this.restore(object);
      this.replacing = false;
      this.spatialIndex.replace(this.objectsById.values());
    } catch (error) {
      this.replacing = false;
      this.objectsById = previousObjects;
      this.occupancy = previousOccupancy;
      this.nextId = previousNextId;
      throw error;
    }
  }

  toDocument() {
    return this.list();
  }

  loadDocument(objects) {
    this.replaceAll(objects ?? []);
  }

  writeOccupancy(object, value) {
    for (const cell of this.getCells(object.x, object.z, object.definitionKey, object.rotation)) {
      if (!this.tileMap.inBounds(cell.x, cell.z)) {
        continue;
      }
      const key = this.tileMap.indexOf(cell.x, cell.z);
      if (value === null) {
        this.occupancy.delete(key);
      } else {
        this.occupancy.set(key, value);
      }
    }
  }
}
