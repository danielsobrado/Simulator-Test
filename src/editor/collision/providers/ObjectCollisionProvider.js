import { PerfCounters } from '../../performance/qa/PerfCounters.js';
import { createObjectColliderDescriptions } from '../../ObjectColliderLibrary.js';
import { collisionChunkKey, parseCollisionChunkKey } from '../CollisionIds.js';
import { createObjectColliderRecords } from './ObjectColliderTransforms.js';

function profileSignature(definition, descriptions) {
  return [
    definition.key,
    definition.collision.policy,
    definition.collision.profile,
    descriptions.map((entry) => [
      entry.partId,
      entry.type,
      ...entry.position,
      ...entry.dimensions,
      entry.rotationY,
    ].join(':')).join(','),
  ].join('|');
}

function objectSignature(objects) {
  return objects
    .slice()
    .sort((left, right) => left.id - right.id)
    .map((object) => [
      object.id,
      object.definitionKey,
      object.x,
      object.z,
      object.rotation,
    ].join(':'))
    .join('|');
}

export class ObjectCollisionProvider {
  constructor({
    objectMap,
    placementResolver,
    objectCatalog,
    tileSize,
    chunkWorldSize,
  }) {
    if (!objectMap?.queryBounds || !placementResolver?.createCanonicalObjectMatrix) {
      throw new Error('Object collision provider requires the object map and placement resolver.');
    }
    if (!Array.isArray(objectCatalog) || objectCatalog.length === 0) {
      throw new Error('Object collision provider requires a non-empty object catalog.');
    }
    if (!Number.isFinite(tileSize) || tileSize <= 0
        || !Number.isFinite(chunkWorldSize) || chunkWorldSize <= 0) {
      throw new Error('Object collision provider requires positive world dimensions.');
    }
    const cellsPerChunk = chunkWorldSize / tileSize;
    if (!Number.isSafeInteger(cellsPerChunk) || cellsPerChunk < 1) {
      throw new Error('Object collision chunks must align with whole terrain cells.');
    }

    this.objectMap = objectMap;
    this.placementResolver = placementResolver;
    this.objectCatalog = objectCatalog;
    this.definitionByKey = new Map(objectCatalog.map((definition) => [definition.key, definition]));
    this.tileSize = tileSize;
    this.chunkWorldSize = chunkWorldSize;
    this.cellsPerChunk = cellsPerChunk;
    this.profiles = new Map(objectCatalog.map((definition) => {
      const descriptions = createObjectColliderDescriptions(definition, tileSize);
      return [definition.key, Object.freeze({
        definition,
        descriptions,
        signature: profileSignature(definition, descriptions),
      })];
    }));
    this.catalogSignature = [...this.profiles.values()].map((profile) => profile.signature).join('||');
    this.observedSpatialSignatures = new Map();
    this.descriptor = Object.freeze({ id: 'production-placed-objects' });
  }

  getEpoch() {
    return `objects:${this.catalogSignature}`;
  }

  getProfileCount() {
    return this.profiles.size;
  }

  cellBounds(chunkX, chunkZ) {
    const minX = chunkX * this.cellsPerChunk;
    const minZ = chunkZ * this.cellsPerChunk;
    return Object.freeze({
      minX,
      minZ,
      maxX: minX + this.cellsPerChunk - 1,
      maxZ: minZ + this.cellsPerChunk - 1,
    });
  }

  spatialSignature(chunkX, chunkZ) {
    return this.objectMap.signatureForBounds(this.cellBounds(chunkX, chunkZ));
  }

  consumeDirtyOwnerChunks(activeKeys) {
    const dirty = [];
    for (const key of activeKeys ?? []) {
      const { chunkX, chunkZ } = parseCollisionChunkKey(key);
      const signature = this.spatialSignature(chunkX, chunkZ);
      if (this.observedSpatialSignatures.get(key) !== signature) dirty.push(key);
    }
    return Object.freeze(dirty);
  }

  buildChunkData(chunkX, chunkZ) {
    const key = collisionChunkKey(chunkX, chunkZ);
    const bounds = this.cellBounds(chunkX, chunkZ);
    const objects = this.objectMap.queryBounds(bounds);
    const colliders = [];
    const stats = { none: 0, solid: 0, trigger: 0, walkable: 0, colliders: 0 };
    let sample = null;

    for (const object of objects) {
      const profile = this.profiles.get(object.definitionKey);
      if (!profile) throw new Error(`Object ${object.id} references unknown collider profile.`);
      const records = createObjectColliderRecords({
        object,
        definition: profile.definition,
        placementResolver: this.placementResolver,
        descriptions: profile.descriptions,
        chunkWorldSize: this.chunkWorldSize,
      });
      const owned = records.filter(
        (record) => record.ownerChunkX === chunkX && record.ownerChunkZ === chunkZ,
      );
      if (profile.definition.collision.policy === 'none') stats.none += 1;
      else if (profile.definition.collision.policy === 'trigger') stats.trigger += 1;
      else if (profile.definition.collision.policy === 'walkable') stats.walkable += 1;
      else stats.solid += 1;
      colliders.push(...owned);
      if (!sample && owned[0]) {
        const placement = this.placementResolver.resolve(object);
        const center = this.placementResolver.canonicalCenter(placement.bounds);
        sample = Object.freeze({
          sourceId: owned[0].sourceId,
          objectId: object.id,
          definitionKey: object.definitionKey,
          policy: profile.definition.collision.policy,
          x: center.x,
          y: placement.surface.baseHeight,
          z: center.z,
          radius: Math.max(placement.bounds.width, placement.bounds.depth) * this.tileSize / 2,
          height: owned.reduce((maximum, record) => Math.max(maximum, record.aabb.maxY), 0)
            - placement.surface.baseHeight,
        });
      }
    }

    colliders.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    stats.colliders = colliders.length;
    const spatialSignature = this.spatialSignature(chunkX, chunkZ);
    this.observedSpatialSignatures.set(key, spatialSignature);
    PerfCounters.set('collisionObjectProfiles', this.profiles.size);
    PerfCounters.inc('collisionObjectChunkBuilds');
    return Object.freeze({
      signature: `${this.catalogSignature}|${spatialSignature}|${objectSignature(objects)}`,
      colliders: Object.freeze(colliders),
      stats: Object.freeze(stats),
      sample,
    });
  }

  dispose() {
    this.observedSpatialSignatures.clear();
  }
}
