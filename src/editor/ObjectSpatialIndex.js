function intersects(left, right) {
  return left.minX <= right.maxX
    && left.maxX >= right.minX
    && left.minZ <= right.maxZ
    && left.maxZ >= right.minZ;
}

export class ObjectSpatialIndex {
  constructor({ bucketSize, boundsForObject }) {
    this.bucketSize = Math.max(1, Math.trunc(bucketSize) || 1);
    this.boundsForObject = boundsForObject;
    this.objects = new Map();
    this.bucketIds = new Map();
    this.objectBuckets = new Map();
    this.bucketRevisions = new Map();
    this.revision = 0;
  }

  keysForBounds(bounds) {
    const minX = Math.floor(bounds.minX / this.bucketSize);
    const maxX = Math.floor(bounds.maxX / this.bucketSize);
    const minZ = Math.floor(bounds.minZ / this.bucketSize);
    const maxZ = Math.floor(bounds.maxZ / this.bucketSize);
    const keys = [];
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) keys.push(`${x}:${z}`);
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
    const keys = this.keysForBounds(this.boundsForObject(object));
    this.objects.set(object.id, object);
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
    this.objectBuckets.delete(object.id);
    this.mark(keys);
  }

  replace(objects) {
    const previousKeys = [...this.bucketIds.keys()];
    this.objects.clear();
    this.bucketIds.clear();
    this.objectBuckets.clear();
    for (const object of objects) this.add(object);
    this.mark(previousKeys);
  }

  clear() {
    const keys = [...this.bucketIds.keys()];
    this.objects.clear();
    this.bucketIds.clear();
    this.objectBuckets.clear();
    this.mark(keys);
  }

  query(bounds) {
    const ids = new Set();
    for (const key of this.keysForBounds(bounds)) {
      for (const id of this.bucketIds.get(key) ?? []) ids.add(id);
    }
    const objects = [];
    for (const id of ids) {
      const object = this.objects.get(id);
      if (object && intersects(this.boundsForObject(object), bounds)) objects.push(object);
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
