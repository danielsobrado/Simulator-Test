import { PerfCounters } from '../../performance/qa/PerfCounters.js';
import {
  isCollisionBuildDeferred,
} from '../CollisionBuildResult.js';
import {
  collisionChunkKey,
  createCollisionSourceId,
  parseCollisionChunkKey,
} from '../CollisionIds.js';
import { COLLISION_LAYERS } from '../CollisionLayers.js';
import { createCanonicalAabb } from '../colliders/ColliderBounds.js';
import {
  COLLIDER_TYPE_CAPSULE,
  createPrimitiveCollider,
} from '../colliders/ColliderRecords.js';

function positiveScale(placement) {
  const value = placement.heightScale ?? placement.scale ?? 1;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Tree placement ${placement.stableId} has an invalid collision scale.`);
  }
  return value;
}

function rotateOffset(x, z, angle) {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: cosine * x + sine * z,
    z: -sine * x + cosine * z,
  };
}

function colliderForPlacement({ placement, profile, minimumTrunkRadius }) {
  const scale = positiveScale(placement);
  const rotationY = Number.isFinite(placement.rotationY) ? placement.rotationY : 0;
  const offset = rotateOffset(profile.centerX * scale, profile.centerZ * scale, rotationY);
  const x = placement.x + offset.x;
  const z = placement.z + offset.z;
  const baseY = placement.height + profile.baseY * scale;
  const radius = Math.max(minimumTrunkRadius, profile.radius * scale);
  const height = profile.height * scale;
  const sourceId = createCollisionSourceId('tree', placement.stableId, 'trunk');

  return createPrimitiveCollider({
    sourceId,
    type: COLLIDER_TYPE_CAPSULE,
    layers: COLLISION_LAYERS.blocking,
    ownerChunkX: placement.ownerChunkX,
    ownerChunkZ: placement.ownerChunkZ,
    aabb: createCanonicalAabb({
      minX: x - radius,
      maxX: x + radius,
      minY: baseY,
      maxY: baseY + height,
      minZ: z - radius,
      maxZ: z + radius,
    }),
    position: [x, baseY, z],
    rotationY,
    dimensions: [radius, height, radius],
    prototypeId: profile.id,
  });
}

function resolvedPrototypeSignature(source, placements) {
  let accumulator = 0;
  for (const placement of placements) {
    const prototypeIndex = source.resolvePrototypeIndex(placement);
    const text = `${placement.stableId}:${prototypeIndex}`;
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    accumulator = (accumulator + hash) >>> 0;
  }
  return accumulator.toString(16).padStart(8, '0');
}

function sampleFromCollider(collider) {
  if (!collider) return null;
  return Object.freeze({
    sourceId: collider.sourceId,
    prototypeId: collider.prototypeId,
    x: collider.position[0],
    y: collider.position[1],
    z: collider.position[2],
    radius: collider.dimensions[0],
    height: collider.dimensions[1],
  });
}

function compareSourceIds(left, right) {
  if (left.sourceId < right.sourceId) return -1;
  if (left.sourceId > right.sourceId) return 1;
  return 0;
}

export class TreeCollisionProvider {
  constructor({
    source,
    buildsPerFrame = 1,
    buildBudgetMs = 2,
    now = () => performance.now(),
    logger = console,
  }) {
    if (!source?.snapshotChunk || !Array.isArray(source.profiles)) {
      throw new Error('Tree collision provider requires a canonical tree source.');
    }
    if (!Number.isSafeInteger(buildsPerFrame) || buildsPerFrame < 1) {
      throw new Error('Tree collision refresh buildsPerFrame must be a positive integer.');
    }
    if (!Number.isFinite(buildBudgetMs) || buildBudgetMs <= 0) {
      throw new Error('Tree collision refresh buildBudgetMs must be positive.');
    }
    this.source = source;
    this.buildsPerFrame = buildsPerFrame;
    this.buildBudgetMs = buildBudgetMs;
    this.now = now;
    this.logger = logger ?? console;
    this.descriptor = source.descriptor;
    this.chunkStates = new Map();
    this.pendingRefresh = [];
    this.pendingRefreshKeys = new Set();
    this.nextRevision = 1;
    this.lastSourceEpoch = source.epoch();
    this.lastError = null;
    this.sample = null;
    this.refreshBuilds = 0;
    PerfCounters.set('collisionTreeProfiles', source.profiles.length);
  }

  buildChunkData(chunkX, chunkZ) {
    const snapshot = this.source.snapshotChunk(chunkX, chunkZ);
    if (isCollisionBuildDeferred(snapshot)) return snapshot;
    const colliders = [];
    for (const placement of snapshot.placements) {
      if (placement.ownerChunkX !== chunkX || placement.ownerChunkZ !== chunkZ) {
        throw new Error(`Tree placement ${placement.stableId} has the wrong collision owner chunk.`);
      }
      const prototypeIndex = this.source.resolvePrototypeIndex(placement);
      const profile = this.source.profiles[prototypeIndex];
      if (!profile) {
        throw new Error(
          `Tree placement ${placement.stableId} resolved unknown collision prototype ${prototypeIndex}.`,
        );
      }
      colliders.push(colliderForPlacement({
        placement,
        profile,
        minimumTrunkRadius: this.source.minimumTrunkRadius,
      }));
    }
    colliders.sort(compareSourceIds);
    const signature = [
      snapshot.signature,
      this.source.profileSignature,
      resolvedPrototypeSignature(this.source, snapshot.placements),
    ].join('|');
    return { signature, colliders };
  }

  refreshSample() {
    this.sample = null;
    const keys = [...this.chunkStates.keys()].sort();
    for (const key of keys) {
      const sample = this.chunkStates.get(key)?.sample;
      if (!sample) continue;
      this.sample = sample;
      break;
    }
  }

  recordChunk(key, revision, data) {
    this.chunkStates.set(key, Object.freeze({
      revision,
      signature: data.signature,
      colliderCount: data.colliders.length,
      sample: sampleFromCollider(data.colliders[0]),
    }));
    this.refreshSample();
    this.updateCounters();
  }

  buildOwnerChunk(chunkX, chunkZ) {
    const key = collisionChunkKey(chunkX, chunkZ);
    const data = this.buildChunkData(chunkX, chunkZ);
    if (isCollisionBuildDeferred(data)) return data;
    const revision = this.nextRevision;
    this.nextRevision += 1;
    this.recordChunk(key, revision, data);
    PerfCounters.inc('collisionTreeChunkBuilds');
    return Object.freeze({ revision, colliders: Object.freeze(data.colliders) });
  }

  removeUnloadedState(key) {
    this.chunkStates.delete(key);
    this.pendingRefreshKeys.delete(key);
    this.refreshSample();
  }

  enqueueLoadedChunks(world) {
    for (const key of this.chunkStates.keys()) {
      const { chunkX, chunkZ } = parseCollisionChunkKey(key);
      if (!world.isOwnerChunkReady(chunkX, chunkZ)) {
        this.removeUnloadedState(key);
        continue;
      }
      if (this.pendingRefreshKeys.has(key)) continue;
      this.pendingRefreshKeys.add(key);
      this.pendingRefresh.push(key);
    }
  }

  refresh(world) {
    const sourceEpoch = this.source.epoch();
    if (sourceEpoch !== this.lastSourceEpoch) {
      this.lastSourceEpoch = sourceEpoch;
      this.enqueueLoadedChunks(world);
    } else {
      for (const key of this.chunkStates.keys()) {
        const { chunkX, chunkZ } = parseCollisionChunkKey(key);
        if (!world.isOwnerChunkReady(chunkX, chunkZ)) this.removeUnloadedState(key);
      }
    }

    const startedAt = this.now();
    let attempted = 0;
    let rebuilt = 0;
    let frameError = null;
    const deferredKeys = [];
    while (this.pendingRefresh.length > 0 && attempted < this.buildsPerFrame) {
      if (attempted > 0 && this.now() - startedAt >= this.buildBudgetMs) break;
      const key = this.pendingRefresh.shift();
      this.pendingRefreshKeys.delete(key);
      attempted += 1;
      const previous = this.chunkStates.get(key);
      if (!previous) continue;
      const { chunkX, chunkZ } = parseCollisionChunkKey(key);
      if (!world.isOwnerChunkReady(chunkX, chunkZ)) {
        this.removeUnloadedState(key);
        continue;
      }
      try {
        const data = this.buildChunkData(chunkX, chunkZ);
        if (isCollisionBuildDeferred(data)) {
          deferredKeys.push(key);
          continue;
        }
        if (data.signature === previous.signature) continue;
        const revision = this.nextRevision;
        this.nextRevision += 1;
        if (world.replaceOwnerChunk({ chunkX, chunkZ, revision, colliders: data.colliders })) {
          this.recordChunk(key, revision, data);
          rebuilt += 1;
          this.refreshBuilds += 1;
        }
      } catch (error) {
        frameError = error;
        this.logger.error?.(`Tree collision refresh failed for ${key}.`, error);
      }
    }
    for (const key of deferredKeys) {
      if (!this.chunkStates.has(key) || this.pendingRefreshKeys.has(key)) continue;
      this.pendingRefreshKeys.add(key);
      this.pendingRefresh.push(key);
    }
    if (frameError) this.lastError = frameError;
    else if (attempted > 0) this.lastError = null;
    PerfCounters.inc('collisionTreeChunkRefreshes', rebuilt);
    PerfCounters.inc('collisionTreeRefreshMs', this.now() - startedAt);
    this.updateCounters();
    return Object.freeze({ attempted, rebuilt, remaining: this.pendingRefresh.length });
  }

  updateCounters() {
    let colliderCount = 0;
    for (const state of this.chunkStates.values()) colliderCount += state.colliderCount;
    PerfCounters.set('collisionTreeChunks', this.chunkStates.size);
    PerfCounters.set('collisionTreeColliders', colliderCount);
    PerfCounters.set('collisionTreeRefreshQueueDepth', this.pendingRefresh.length);
  }

  getStatus() {
    let colliderCount = 0;
    for (const state of this.chunkStates.values()) colliderCount += state.colliderCount;
    return Object.freeze({
      id: this.descriptor.id,
      profileCount: this.source.profiles.length,
      loadedChunks: this.chunkStates.size,
      colliderCount,
      queuedRefreshes: this.pendingRefresh.length,
      refreshBuilds: this.refreshBuilds,
      lastError: this.lastError?.message ?? null,
      sample: this.sample,
    });
  }

  dispose() {
    this.chunkStates.clear();
    this.pendingRefresh.length = 0;
    this.pendingRefreshKeys.clear();
    this.sample = null;
    this.lastError = null;
    this.updateCounters();
  }
}
