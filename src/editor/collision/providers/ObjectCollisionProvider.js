import { PerfCounters } from '../../performance/qa/PerfCounters.js';
import { createObjectColliderDescriptions } from '../../ObjectColliderLibrary.js';
import {
  defaultObjectCollisionPolicy,
  defaultObjectCollisionProfile,
} from '../../ObjectCollisionPolicy.js';
import { collisionChunkKey, parseCollisionChunkKey } from '../CollisionIds.js';
import { collisionChunkForCanonical } from '../colliders/ColliderBounds.js';
import { createObjectColliderRecords } from './ObjectColliderTransforms.js';

const OBJECT_COLLISION_SCHEMA = 'objects:v1';
const WALL_DEPTH_RATIO = 0.28;
const WALL_WIDTH_RATIO = 0.96;

function runtimeCollision(definition) {
  if (definition.collision) return definition;
  const workshop = definition.model === 'workshop';
  return Object.freeze({
    ...definition,
    collision: Object.freeze({
      policy: defaultObjectCollisionPolicy(definition),
      profile: defaultObjectCollisionProfile(definition),
      allowFootprintOverflow: false,
      scale: Object.freeze(workshop ? {
        x: definition.footprint.width,
        y: 2,
        z: definition.footprint.depth * WALL_WIDTH_RATIO / WALL_DEPTH_RATIO,
      } : { x: 1, y: 1, z: 1 }),
      offset: Object.freeze({ x: 0, y: 0, z: 0 }),
    }),
  });
}

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

function objectProfileSignature(object, profile) {
  return [
    profile.signature,
    object.id,
    object.definitionKey,
    object.x,
    object.z,
    object.rotation,
  ].join(':');
}

function incrementPolicy(stats, policy) {
  if (policy === 'none') stats.none += 1;
  else if (policy === 'trigger') stats.trigger += 1;
  else if (policy === 'walkable') stats.walkable += 1;
  else stats.solid += 1;
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
    this.tileSize = tileSize;
    this.chunkWorldSize = chunkWorldSize;
    this.cellsPerChunk = cellsPerChunk;
    this.profiles = new Map();
    this.observedSpatialSignatures = new Map();
    this.descriptor = Object.freeze({ id: 'production-placed-objects' });
    for (const definition of objectCatalog) this.ensureProfile(definition.key, definition);
  }

  getEpoch() {
    return OBJECT_COLLISION_SCHEMA;
  }

  getProfileCount() {
    return this.profiles.size;
  }

  ensureProfile(definitionKey, suppliedDefinition = null) {
    const sourceDefinition = suppliedDefinition
      ?? this.objectMap.definitionByKey?.get(definitionKey)
      ?? null;
    if (!sourceDefinition) {
      throw new Error(`Object collision references unknown definition ${definitionKey}.`);
    }
    const cached = this.profiles.get(definitionKey);
    if (cached?.sourceDefinition === sourceDefinition) return cached;

    const definition = runtimeCollision(sourceDefinition);
    const descriptions = createObjectColliderDescriptions(definition, this.tileSize);
    const profile = Object.freeze({
      sourceDefinition,
      definition,
      descriptions,
      signature: profileSignature(definition, descriptions),
    });
    this.profiles.set(definitionKey, profile);
    return profile;
  }

  cellBounds(chunkX, chunkZ) {
    const minX = chunkX * this.cellsPerChunk;
    // Cell Z and chunk Z run the same way, because canonical Z already runs
    // opposite to cell Z (`canonical = -cell * tileSize`) and chunk Z is
    // mirrored against canonical Z in `collisionChunkCanonicalBounds`. The two
    // mirrorings cancel. Mirroring again here pointed the cell window at the
    // opposite half of the world from the chunk's own canonical bounds, so an
    // object was collected for a chunk whose bounds it could never overlap.
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
    const candidates = this.objectMap.queryBounds(bounds);
    const ownedSignatures = [];
    const colliders = [];
    const stats = { none: 0, solid: 0, trigger: 0, walkable: 0, colliders: 0 };
    let sample = null;

    for (const object of candidates) {
      const profile = this.ensureProfile(object.definitionKey);
      const placement = this.placementResolver.resolve(object);
      const center = this.placementResolver.canonicalCenter(placement.bounds);
      // The shared helper rather than a local `Math.floor`: this is the same
      // mapping `CollisionResidency` uses to decide which chunks to load around
      // the player. Hand-rolling it here got the Z mirroring wrong, so objects
      // were filed under a chunk that is never resident where the player stands
      // — colliders present, never loaded, and the player walked through walls.
      const { chunkX: ownerChunkX, chunkZ: ownerChunkZ } = collisionChunkForCanonical(
        center.x,
        center.z,
        this.chunkWorldSize,
      );
      if (ownerChunkX !== chunkX || ownerChunkZ !== chunkZ) continue;

      ownedSignatures.push(objectProfileSignature(object, profile));
      incrementPolicy(stats, profile.definition.collision.policy);
      const records = createObjectColliderRecords({
        object,
        definition: profile.definition,
        placementResolver: this.placementResolver,
        placement,
        descriptions: profile.descriptions,
        chunkWorldSize: this.chunkWorldSize,
        // This chunk is the owner by construction — the filter above is what
        // let the object through — so hand that decision down rather than let
        // the records derive a second, possibly different one.
        ownerChunk: { chunkX: ownerChunkX, chunkZ: ownerChunkZ },
      });
      colliders.push(...records);
      if (!sample && records[0]) {
        sample = Object.freeze({
          sourceId: records[0].sourceId,
          objectId: object.id,
          definitionKey: object.definitionKey,
          policy: profile.definition.collision.policy,
          x: center.x,
          y: placement.surface.baseHeight,
          z: center.z,
          radius: Math.max(placement.bounds.width, placement.bounds.depth) * this.tileSize / 2,
          height: records.reduce((maximum, record) => Math.max(maximum, record.aabb.maxY), 0)
            - placement.surface.baseHeight,
        });
      }
    }

    colliders.sort((left, right) => left.sourceId.localeCompare(right.sourceId));
    ownedSignatures.sort();
    stats.colliders = colliders.length;
    const spatialSignature = this.spatialSignature(chunkX, chunkZ);
    this.observedSpatialSignatures.set(key, spatialSignature);
    PerfCounters.set('collisionObjectProfiles', this.profiles.size);
    PerfCounters.inc('collisionObjectChunkBuilds');
    return Object.freeze({
      signature: `${OBJECT_COLLISION_SCHEMA}|${ownedSignatures.join('|')}`,
      colliders: Object.freeze(colliders),
      stats: Object.freeze(stats),
      sample,
    });
  }

  dispose() {
    this.observedSpatialSignatures.clear();
    this.profiles.clear();
  }
}
