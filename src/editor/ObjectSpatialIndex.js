const MAX_BUCKETS_PER_OPERATION = 262_144;

function intersects(left, right) {
  return left.minX <= right.maxX
    && left.maxX >= right.minX
    && left.minZ <= right.maxZ
    && left.maxZ >= right.minZ;
}

function assertBounds(bounds) {
  if (!bounds || typeof bounds !== 'object') {
    throw new Error('Object spatial bounds are required.');
  }
  for (const key of ['minX', 'maxX', 'minZ', 'maxZ']) {
    if (!Number.isFinite(bounds[key])) {
      throw new Error(`Object spatial bound ${key} must be finite.`);
    }
  }
  if (bounds.minX > bounds.maxX || bounds.minZ > bounds.maxZ) {
    throw new Error('Object spatial bounds must have ordered minimum and maximum coordinates.');
  }
}

function bucketRange(bounds, bucketSize) {
  assertBounds(bounds);
  const range = {
    minX: Math.floor(bounds.minX / bucketSize),
    maxX: Math.floor(bounds.maxX / bucketSize),
    minZ: Math.floor(bounds.minZ / bucketSize),
    maxZ: Math.floor(bounds.maxZ / bucketSize),
  };
  for (const [key, value] of Object.entries(range)) {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Object spatial bucket ${key} must be a safe integer.`);
    }
  }

  const width = range.maxX - range.minX + 1;
  const depth = range.maxZ - range.minZ + 1;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(depth)
    || width > MAX_BUCKETS_PER_OPERATION
    || depth > MAX_BUCKETS_PER_OPERATION
    || width * depth > MAX_BUCKETS_PER_OPERATION) {
    throw new Error(`Object spatial operation exceeds ${MAX_BUCKETS_PER_OPERATION} buckets.`);
  }
  return range;
}

export class ObjectSpatialIndex {
  constructor({ bucketSize, boundsForObject }) {
    if (!Number.isSafeInteger(bucketSize) || bucketSize < 1) {
      throw new Error('Object spatial bucket size must be a positive safe integer.');
    }
    if (typeof boundsForObject !== 'function') {
      throw new Error('Object spatial bounds resolver is required.');
    }
    this.bucketSize = bucketSize;
    this.boundsForObject = boundsForObject;
    this.objects = new Map();
    this.boundsByObjectId = new Map();
    this.bucketIds = new Map();
    this.objectBuckets = new Map();
    this.bucketRevisions = new Map();
    this.revision = 0;
  }

  keysForBounds(bounds) {
    const range = bucketRange(bounds, this.bucketSize);
    const keys = [];
    for (let z = range.minZ; z <= range.maxZ; z += 1) {
      for (let x = range.minX; x <= range.maxX; x += 1) keys.push(`${x}:${z}`);
    }
    return keys;
  }

  mark(keys) {
    const unique = new Set(keys);
    if (unique.size === 0) return;
    this.revision += 1;
    for (const key of unique) this.bucketRevisions.set(key, this.revision);
  }

  add(object) {
    const bounds = this.boundsForObject(object);
    const keys = this.keysForBounds(bounds);
    this.objects.set(object.id, object);
    this.boundsByObjectId.set(object.id, bounds);
    this.objectBuckets.set(object.id, keys);
    for (const key of keys) {
      const ids = this.bucketIds.get(key) ?? new Set();
      ids.add(object.id);
      this.bucketIds.set(key, ids);
    }
    this.mark(keys);
  }

  remove(object) {
    const keys = this.objectBuckets.get(object.id)
      ?? this.keysForBounds(this.boundsForObject(object));
    for (const key of keys) {
      const ids = this.bucketIds.get(key);
      if (!ids) continue;
      ids.delete(object.id);
      if (ids.size === 0) this.bucketIds.delete(key);
    }
    this.objects.delete(object.id);
    this.boundsByObjectId.delete(object.id);
    this.objectBuckets.delete(object.id);
    this.mark(keys);
  }

  replace(objects) {
    const previousKeys = [...this.bucketIds.keys()];
    this.objects.clear();
    this.boundsByObjectId.clear();
    this.bucketIds.clear();
    this.objectBuckets.clear();
    for (const object of objects) this.add(object);
    this.mark(previousKeys);
  }

  clear() {
    const keys = [...this.bucketIds.keys()];
    this.objects.clear();
    this.boundsByObjectId.clear();
    this.bucketIds.clear();
    this.objectBuckets.clear();
    this.mark(keys);
  }

  query(bounds) {
    const ids = new Set();
    for (const key of this.keysForBounds(bounds)) {
      const bucket = this.bucketIds.get(key);
      if (!bucket) continue;
      for (const id of bucket) ids.add(id);
    }
    const objects = [];
    for (const id of ids) {
      const object = this.objects.get(id);
      const objectBounds = this.boundsByObjectId.get(id);
      if (object && objectBounds && intersects(objectBounds, bounds)) objects.push(object);
    }
    return objects;
  }

  signature(bounds) {
    let revision = 0;
    for (const key of this.keysForBounds(bounds)) {
      revision = Math.max(revision, this.bucketRevisions.get(key) ?? 0);
    }
    return revision;
  }
}
