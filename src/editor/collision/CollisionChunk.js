import { collisionChunkKey } from './CollisionIds.js';
import { CollisionSpatialBins } from './CollisionSpatialBins.js';
import { collisionChunkCanonicalBounds } from './colliders/ColliderBounds.js';

export const COLLISION_CHUNK_BUILDING = 'building';
export const COLLISION_CHUNK_READY = 'ready';

export class CollisionChunk {
  constructor({
    chunkX,
    chunkZ,
    revision,
    ownerReady,
    colliders,
    chunkWorldSize,
    binSize,
    maxBinsPerCollider = 64,
  }) {
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('Collision chunk revision must be a non-negative safe integer.');
    }
    this.chunkX = chunkX;
    this.chunkZ = chunkZ;
    this.key = collisionChunkKey(chunkX, chunkZ);
    this.revision = revision;
    this.ownerReady = Boolean(ownerReady);
    this.state = COLLISION_CHUNK_BUILDING;
    this.bounds = collisionChunkCanonicalBounds(chunkX, chunkZ, chunkWorldSize);
    this.broadphase = new CollisionSpatialBins({
      chunkBounds: this.bounds,
      binSize,
      maxBinsPerCollider,
    });
    this.sourceIds = [];
    for (const collider of colliders) {
      if (this.broadphase.insert(collider)) this.sourceIds.push(collider.sourceId);
    }
    this.sourceIds = Object.freeze(this.sourceIds);
    this.state = COLLISION_CHUNK_READY;
  }

  query(aabb, queryStamp, registry, out, layers) {
    if (this.state !== COLLISION_CHUNK_READY) return out;
    return this.broadphase.query(aabb, queryStamp, registry, out, layers);
  }

  getStatus() {
    const broadphase = this.broadphase.getStats();
    return Object.freeze({
      key: this.key,
      chunkX: this.chunkX,
      chunkZ: this.chunkZ,
      revision: this.revision,
      state: this.state,
      ownerReady: this.ownerReady,
      colliderCount: this.sourceIds.length,
      activeBins: broadphase.activeBins,
      largeColliders: broadphase.largeColliders,
    });
  }
}
