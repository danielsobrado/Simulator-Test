import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { collisionChunkKey } from './CollisionIds.js';
import { COLLISION_LAYERS } from './CollisionLayers.js';
import { CollisionChunk } from './CollisionChunk.js';
import { collisionChunksForAabb } from './colliders/ColliderBounds.js';

function cloneContributionMap(source) {
  return source ? new Map(source) : new Map();
}

function maximumRevision(contributions) {
  let revision = 0;
  for (const contribution of contributions.values()) {
    revision = Math.max(revision, contribution.revision);
  }
  return revision;
}

export class CollisionWorld {
  constructor({ chunkWorldSize, binSize, maxBinsPerCollider = 64 }) {
    if (!(chunkWorldSize > 0)) throw new Error('Collision chunkWorldSize must be positive.');
    if (!(binSize > 0)) throw new Error('Collision binSize must be positive.');
    this.chunkWorldSize = chunkWorldSize;
    this.binSize = binSize;
    this.maxBinsPerCollider = maxBinsPerCollider;
    this.registry = new Map();
    this.prototypes = new Map();
    this.chunks = new Map();
    this.contributions = new Map();
    this.ownerStates = new Map();
    this.revision = 0;
    this.queryStamp = 0;
    this.candidateBuffer = [];
    this.chunkScratch = [];
    this.lastQueryChunkCount = 0;
    this.lastQueryCandidateCount = 0;
  }

  registerPrototype(prototype) {
    const previous = this.prototypes.get(prototype.id);
    if (previous && previous !== prototype) {
      throw new Error(`Collision prototype ${prototype.id} is already registered.`);
    }
    this.prototypes.set(prototype.id, prototype);
    return prototype;
  }

  getPrototype(prototypeId) {
    return this.prototypes.get(prototypeId) ?? null;
  }

  replaceOwnerChunk({ chunkX, chunkZ, revision, colliders }) {
    const ownerKey = collisionChunkKey(chunkX, chunkZ);
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('Collision owner revision must be a non-negative safe integer.');
    }
    if (!Array.isArray(colliders)) throw new Error('Collision owner colliders must be an array.');
    const previousState = this.ownerStates.get(ownerKey);
    if (previousState && revision < previousState.revision) return false;

    const sourceIds = new Set();
    for (const collider of colliders) {
      if (collider.ownerChunkX !== chunkX || collider.ownerChunkZ !== chunkZ) {
        throw new Error(`Collider ${collider.sourceId} has the wrong canonical owner chunk.`);
      }
      if (sourceIds.has(collider.sourceId)) {
        throw new Error(`Duplicate collider source id in owner chunk: ${collider.sourceId}.`);
      }
      sourceIds.add(collider.sourceId);
    }

    const nextRegistry = new Map(this.registry);
    for (const sourceId of previousState?.sourceIds ?? []) nextRegistry.delete(sourceId);
    for (const collider of colliders) {
      if (nextRegistry.has(collider.sourceId)) {
        throw new Error(`Collider source id is already owned elsewhere: ${collider.sourceId}.`);
      }
      nextRegistry.set(collider.sourceId, { collider, lastQueryStamp: 0 });
    }

    const references = new Map();
    references.set(ownerKey, []);
    for (const collider of colliders) {
      const chunks = collisionChunksForAabb(collider.aabb, this.chunkWorldSize, this.chunkScratch);
      for (const chunk of chunks) {
        const key = collisionChunkKey(chunk.chunkX, chunk.chunkZ);
        const ids = references.get(key) ?? [];
        ids.push(collider.sourceId);
        references.set(key, ids);
      }
    }

    const affected = new Set(previousState?.referenceKeys ?? []);
    for (const key of references.keys()) affected.add(key);
    const nextContributionMaps = new Map();
    const nextChunks = new Map();

    for (const key of affected) {
      const contributionMap = cloneContributionMap(this.contributions.get(key));
      if (references.has(key)) {
        contributionMap.set(ownerKey, Object.freeze({
          revision,
          sourceIds: Object.freeze([...(references.get(key) ?? [])]),
        }));
      } else {
        contributionMap.delete(ownerKey);
      }
      nextContributionMaps.set(key, contributionMap);
      if (contributionMap.size === 0) {
        nextChunks.set(key, null);
        continue;
      }

      const [keyChunkX, keyChunkZ] = key.split(':').map(Number);
      const chunkColliders = [];
      for (const contribution of contributionMap.values()) {
        for (const sourceId of contribution.sourceIds) {
          const entry = nextRegistry.get(sourceId);
          if (!entry) throw new Error(`Missing collider registry entry: ${sourceId}.`);
          chunkColliders.push(entry.collider);
        }
      }
      nextChunks.set(key, new CollisionChunk({
        chunkX: keyChunkX,
        chunkZ: keyChunkZ,
        revision: maximumRevision(contributionMap),
        ownerReady: contributionMap.has(key),
        colliders: chunkColliders,
        chunkWorldSize: this.chunkWorldSize,
        binSize: this.binSize,
        maxBinsPerCollider: this.maxBinsPerCollider,
      }));
    }

    this.registry = nextRegistry;
    for (const key of affected) {
      const contributionMap = nextContributionMaps.get(key);
      const chunk = nextChunks.get(key);
      if (contributionMap.size === 0) this.contributions.delete(key);
      else this.contributions.set(key, contributionMap);
      if (chunk) this.chunks.set(key, chunk);
      else this.chunks.delete(key);
    }
    this.ownerStates.set(ownerKey, Object.freeze({
      revision,
      sourceIds: Object.freeze([...sourceIds]),
      referenceKeys: Object.freeze([...references.keys()]),
    }));
    this.revision += 1;
    this.updateCounters();
    return true;
  }

  unloadOwnerChunk(chunkX, chunkZ) {
    const ownerKey = collisionChunkKey(chunkX, chunkZ);
    const previousState = this.ownerStates.get(ownerKey);
    if (!previousState) return false;
    const nextRegistry = new Map(this.registry);
    for (const sourceId of previousState.sourceIds) nextRegistry.delete(sourceId);
    const nextContributionMaps = new Map();
    const nextChunks = new Map();

    for (const key of previousState.referenceKeys) {
      const contributionMap = cloneContributionMap(this.contributions.get(key));
      contributionMap.delete(ownerKey);
      nextContributionMaps.set(key, contributionMap);
      if (contributionMap.size === 0) {
        nextChunks.set(key, null);
        continue;
      }
      const [keyChunkX, keyChunkZ] = key.split(':').map(Number);
      const colliders = [];
      for (const contribution of contributionMap.values()) {
        for (const sourceId of contribution.sourceIds) {
          const entry = nextRegistry.get(sourceId);
          if (entry) colliders.push(entry.collider);
        }
      }
      nextChunks.set(key, new CollisionChunk({
        chunkX: keyChunkX,
        chunkZ: keyChunkZ,
        revision: maximumRevision(contributionMap),
        ownerReady: contributionMap.has(key),
        colliders,
        chunkWorldSize: this.chunkWorldSize,
        binSize: this.binSize,
        maxBinsPerCollider: this.maxBinsPerCollider,
      }));
    }

    this.registry = nextRegistry;
    for (const key of previousState.referenceKeys) {
      const contributionMap = nextContributionMaps.get(key);
      const chunk = nextChunks.get(key);
      if (contributionMap.size === 0) this.contributions.delete(key);
      else this.contributions.set(key, contributionMap);
      if (chunk) this.chunks.set(key, chunk);
      else this.chunks.delete(key);
    }
    this.ownerStates.delete(ownerKey);
    this.revision += 1;
    this.updateCounters();
    return true;
  }

  isOwnerChunkReady(chunkX, chunkZ) {
    return this.ownerStates.has(collisionChunkKey(chunkX, chunkZ));
  }

  isCollisionChunkReady(chunkX, chunkZ) {
    return this.chunks.get(collisionChunkKey(chunkX, chunkZ))?.ownerReady === true;
  }

  nextQueryStamp() {
    this.queryStamp += 1;
    if (this.queryStamp < Number.MAX_SAFE_INTEGER) return this.queryStamp;
    this.queryStamp = 1;
    for (const entry of this.registry.values()) entry.lastQueryStamp = 0;
    return this.queryStamp;
  }

  collectCandidates(aabb, layers = COLLISION_LAYERS.all, out = this.candidateBuffer) {
    out.length = 0;
    const stamp = this.nextQueryStamp();
    const chunks = collisionChunksForAabb(aabb, this.chunkWorldSize, this.chunkScratch);
    let queriedChunks = 0;
    for (const chunkCoordinates of chunks) {
      const chunk = this.chunks.get(collisionChunkKey(
        chunkCoordinates.chunkX,
        chunkCoordinates.chunkZ,
      ));
      if (!chunk) continue;
      queriedChunks += 1;
      chunk.query(aabb, stamp, this.registry, out, layers);
    }
    this.lastQueryChunkCount = queriedChunks;
    this.lastQueryCandidateCount = out.length;
    PerfCounters.set('collisionCandidates', out.length);
    PerfCounters.set('collisionQueryChunks', queriedChunks);
    return out;
  }

  checkAabbReadiness(aabb) {
    const missing = [];
    const chunks = collisionChunksForAabb(aabb, this.chunkWorldSize, this.chunkScratch);
    for (const chunk of chunks) {
      if (!this.isCollisionChunkReady(chunk.chunkX, chunk.chunkZ)) {
        missing.push(collisionChunkKey(chunk.chunkX, chunk.chunkZ));
      }
    }
    return Object.freeze({ ready: missing.length === 0, missing: Object.freeze(missing) });
  }

  getCollider(sourceId) {
    return this.registry.get(sourceId)?.collider ?? null;
  }

  getStatus() {
    let activeBins = 0;
    let largeColliders = 0;
    let readyChunks = 0;
    for (const chunk of this.chunks.values()) {
      const status = chunk.getStatus();
      activeBins += status.activeBins;
      largeColliders += status.largeColliders;
      if (status.ownerReady) readyChunks += 1;
    }
    return Object.freeze({
      revision: this.revision,
      activeChunks: this.chunks.size,
      readyChunks,
      ownerChunks: this.ownerStates.size,
      colliders: this.registry.size,
      prototypes: this.prototypes.size,
      activeBins,
      largeColliders,
      lastQueryCandidates: this.lastQueryCandidateCount,
      lastQueryChunks: this.lastQueryChunkCount,
    });
  }

  debugSnapshot() {
    const chunks = [];
    for (const chunk of this.chunks.values()) {
      chunks.push(Object.freeze({
        status: chunk.getStatus(),
        bounds: chunk.bounds,
        bins: Object.freeze(chunk.broadphase.debugBinBounds()),
        colliders: Object.freeze(chunk.sourceIds
          .map((sourceId) => this.registry.get(sourceId)?.collider)
          .filter(Boolean)),
      }));
    }
    return Object.freeze({ revision: this.revision, chunks: Object.freeze(chunks) });
  }

  updateCounters() {
    const status = this.getStatus();
    PerfCounters.set('collisionActiveChunks', status.activeChunks);
    PerfCounters.set('collisionReadyChunks', status.readyChunks);
    PerfCounters.set('collisionActiveColliders', status.colliders);
    PerfCounters.set('collisionActiveBins', status.activeBins);
    PerfCounters.set('collisionLargeColliders', status.largeColliders);
  }

  dispose() {
    this.registry.clear();
    this.prototypes.clear();
    this.chunks.clear();
    this.contributions.clear();
    this.ownerStates.clear();
    this.candidateBuffer.length = 0;
    this.chunkScratch.length = 0;
    this.revision += 1;
    this.updateCounters();
  }
}
