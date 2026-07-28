import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { COLLISION_GAUGE_COUNTERS } from './CollisionPerfCounters.js';
import { collisionChunkKey, parseCollisionChunkKey } from './CollisionIds.js';
import {
  COLLISION_RETRY_BASE_MS,
  COLLISION_RETRY_MAX_MS,
  MAX_COLLISION_BUILDS_PER_FRAME,
  MAX_COLLISION_STREAMING_RADIUS,
} from './CollisionLimits.js';
import { collisionChunkForCanonical } from './colliders/ColliderBounds.js';

export const COLLISION_NOT_READY_POLICY = 'retain-previous-valid-position';

function chebyshevDistance(leftX, leftZ, rightX, rightZ) {
  return Math.max(Math.abs(leftX - rightX), Math.abs(leftZ - rightZ));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function boundedDisplacement(velocity, seconds, maximumDistance) {
  const displacement = velocity * seconds;
  if (Number.isNaN(displacement)) throw new Error('Collision prefetch velocity must be numeric.');
  return clamp(displacement, -maximumDistance, maximumDistance);
}

function clampPredictedChunk(current, predicted, maximumDistance) {
  if (maximumDistance <= 0) return current;
  const deltaX = clamp(predicted.chunkX - current.chunkX, -maximumDistance, maximumDistance);
  const deltaZ = clamp(predicted.chunkZ - current.chunkZ, -maximumDistance, maximumDistance);
  if (deltaX === predicted.chunkX - current.chunkX
      && deltaZ === predicted.chunkZ - current.chunkZ) {
    return predicted;
  }
  return Object.freeze({
    chunkX: current.chunkX + deltaX,
    chunkZ: current.chunkZ + deltaZ,
  });
}

function routeChunks(start, end) {
  const chunks = [];
  let x = start.chunkX;
  let z = start.chunkZ;
  const deltaX = Math.abs(end.chunkX - x);
  const deltaZ = Math.abs(end.chunkZ - z);
  const stepX = x < end.chunkX ? 1 : -1;
  const stepZ = z < end.chunkZ ? 1 : -1;
  let error = deltaX - deltaZ;
  while (true) {
    chunks.push({ chunkX: x, chunkZ: z });
    if (x === end.chunkX && z === end.chunkZ) break;
    const doubled = error * 2;
    if (doubled > -deltaZ) {
      error -= deltaZ;
      x += stepX;
    }
    if (doubled < deltaX) {
      error += deltaX;
      z += stepZ;
    }
  }
  return chunks;
}

function retryDelay(attempts) {
  const exponent = Math.max(0, Math.min(20, attempts - 1));
  return Math.min(COLLISION_RETRY_MAX_MS, COLLISION_RETRY_BASE_MS * (2 ** exponent));
}

function validateResidencyConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Collision residency config must be an object.');
  }
  for (const field of ['residentRadius', 'unloadRadius']) {
    const value = config[field];
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_COLLISION_STREAMING_RADIUS) {
      throw new Error(
        `Collision residency ${field} must be within 0 and ${MAX_COLLISION_STREAMING_RADIUS}.`,
      );
    }
  }
  if (config.unloadRadius < config.residentRadius) {
    throw new Error('Collision residency unloadRadius must cover residentRadius.');
  }
  if (!Number.isFinite(config.prefetchSeconds) || config.prefetchSeconds <= 0) {
    throw new Error('Collision residency prefetchSeconds must be positive and finite.');
  }
  if (!Number.isSafeInteger(config.buildsPerFrame)
      || config.buildsPerFrame < 1
      || config.buildsPerFrame > MAX_COLLISION_BUILDS_PER_FRAME) {
    throw new Error(
      `Collision residency buildsPerFrame must be within 1 and ${MAX_COLLISION_BUILDS_PER_FRAME}.`,
    );
  }
  if (!Number.isFinite(config.buildBudgetMs) || config.buildBudgetMs <= 0) {
    throw new Error('Collision residency buildBudgetMs must be positive and finite.');
  }
}

function optionalCallback(value, name) {
  if (value == null) return null;
  if (typeof value !== 'function') throw new Error(`Collision residency ${name} must be a function.`);
  return value;
}

function failureRecord(error, {
  providerId,
  phase,
  chunkKey = null,
} = {}) {
  return Object.freeze({
    providerId,
    phase,
    chunkKey,
    sourceId: error?.sourceId ?? error?.cause?.sourceId ?? null,
    prototypeId: error?.prototypeId ?? error?.cause?.prototypeId ?? null,
    message: error instanceof Error ? error.message : String(error),
  });
}

export class CollisionResidency {
  constructor({
    world,
    config,
    buildOwnerChunk,
    onOwnerChunkCommitted = null,
    onOwnerChunkUnloaded = null,
    now = () => performance.now(),
    logger = console,
    providerId = 'unknown',
  }) {
    if (!world) throw new Error('Collision residency requires a world.');
    if (typeof buildOwnerChunk !== 'function') {
      throw new Error('Collision residency requires a buildOwnerChunk callback.');
    }
    if (typeof now !== 'function') throw new Error('Collision residency now must be a function.');
    validateResidencyConfig(config);
    this.world = world;
    this.config = Object.freeze({ ...config });
    this.buildOwnerChunk = buildOwnerChunk;
    this.onOwnerChunkCommitted = optionalCallback(onOwnerChunkCommitted, 'commit callback');
    this.onOwnerChunkUnloaded = optionalCallback(onOwnerChunkUnloaded, 'unload callback');
    this.now = now;
    this.logger = logger ?? console;
    this.providerId = String(providerId || 'unknown');
    this.desiredKeys = new Set();
    this.loadedKeys = new Set();
    this.queue = [];
    this.queuedByKey = new Map();
    this.retryByKey = new Map();
    this.currentChunk = null;
    this.predictedChunk = null;
    this.lastBuildError = null;
    this.lastFailure = null;
    this.builds = 0;
    this.sequence = 0;
  }

  retryReady(key) {
    const retry = this.retryByKey.get(key);
    return !retry || this.now() >= retry.at;
  }

  recordRetry(key, error, phase = 'chunk-build') {
    const previous = this.retryByKey.get(key);
    const attempts = (previous?.attempts ?? 0) + 1;
    const failure = failureRecord(error, {
      providerId: this.providerId,
      phase,
      chunkKey: key,
    });
    this.retryByKey.set(key, Object.freeze({
      attempts,
      at: this.now() + retryDelay(attempts),
      failure,
    }));
    this.lastBuildError = error instanceof Error ? error : new Error(String(error));
    this.lastFailure = failure;
    return failure;
  }

  schedule(chunkX, chunkZ, priority) {
    const key = collisionChunkKey(chunkX, chunkZ);
    if (this.world.isOwnerChunkReady(chunkX, chunkZ)) {
      this.retryByKey.delete(key);
      this.loadedKeys.add(key);
      return;
    }
    if (!this.retryReady(key)) return;
    const existing = this.queuedByKey.get(key);
    if (existing) {
      existing.priority = Math.min(existing.priority, priority);
      return;
    }
    const job = { key, chunkX, chunkZ, priority, sequence: this.sequence };
    this.sequence += 1;
    this.queuedByKey.set(key, job);
    this.queue.push(job);
  }

  pruneQueue() {
    let writeIndex = 0;
    for (const job of this.queue) {
      if (!this.desiredKeys.has(job.key)
          || this.world.isOwnerChunkReady(job.chunkX, job.chunkZ)) {
        this.queuedByKey.delete(job.key);
        continue;
      }
      this.queue[writeIndex] = job;
      writeIndex += 1;
    }
    this.queue.length = writeIndex;

    for (const key of this.retryByKey.keys()) {
      const chunk = parseCollisionChunkKey(key);
      if (!this.desiredKeys.has(key) || this.world.isOwnerChunkReady(chunk.chunkX, chunk.chunkZ)) {
        this.retryByKey.delete(key);
      }
    }
  }

  notifyOwnerUnloaded(chunkX, chunkZ) {
    try {
      this.onOwnerChunkUnloaded?.(chunkX, chunkZ);
      return null;
    } catch (error) {
      const key = collisionChunkKey(chunkX, chunkZ);
      const failure = failureRecord(error, {
        providerId: this.providerId,
        phase: 'owner-unload',
        chunkKey: key,
      });
      this.lastBuildError = error;
      this.lastFailure = failure;
      this.logger.error?.('Collision owner unload callback failed.', failure, error);
      return error;
    }
  }

  unload(chunkX, chunkZ) {
    const key = collisionChunkKey(chunkX, chunkZ);
    if (!this.world.unloadOwnerChunk(chunkX, chunkZ)) return false;
    this.retryByKey.delete(key);
    this.notifyOwnerUnloaded(chunkX, chunkZ);
    return true;
  }

  update({ focus, velocity = { x: 0, z: 0 } }) {
    const chunkWorldSize = this.world.chunkWorldSize;
    const current = collisionChunkForCanonical(focus.x, focus.z, chunkWorldSize);
    const maximumPrefetchDistance = this.config.unloadRadius * chunkWorldSize;
    const rawPredicted = collisionChunkForCanonical(
      focus.x + boundedDisplacement(
        velocity.x,
        this.config.prefetchSeconds,
        maximumPrefetchDistance,
      ),
      focus.z + boundedDisplacement(
        velocity.z,
        this.config.prefetchSeconds,
        maximumPrefetchDistance,
      ),
      chunkWorldSize,
    );
    const predicted = clampPredictedChunk(current, rawPredicted, this.config.unloadRadius);
    this.currentChunk = current;
    this.predictedChunk = predicted;
    this.desiredKeys.clear();
    for (const job of this.queue) job.priority = Number.POSITIVE_INFINITY;

    for (let offsetZ = -this.config.residentRadius; offsetZ <= this.config.residentRadius; offsetZ += 1) {
      for (let offsetX = -this.config.residentRadius; offsetX <= this.config.residentRadius; offsetX += 1) {
        const chunkX = current.chunkX + offsetX;
        const chunkZ = current.chunkZ + offsetZ;
        const key = collisionChunkKey(chunkX, chunkZ);
        this.desiredKeys.add(key);
        this.schedule(
          chunkX,
          chunkZ,
          chebyshevDistance(chunkX, chunkZ, current.chunkX, current.chunkZ) + 1,
        );
      }
    }

    const route = routeChunks(current, predicted);
    for (let index = 0; index < route.length; index += 1) {
      const chunk = route[index];
      const key = collisionChunkKey(chunk.chunkX, chunk.chunkZ);
      this.desiredKeys.add(key);
      this.schedule(chunk.chunkX, chunk.chunkZ, index === 0 ? 0 : 0.25 + index * 0.01);
    }

    for (const key of this.loadedKeys) {
      const chunk = parseCollisionChunkKey(key);
      const currentDistance = chebyshevDistance(
        chunk.chunkX,
        chunk.chunkZ,
        current.chunkX,
        current.chunkZ,
      );
      const predictedDistance = chebyshevDistance(
        chunk.chunkX,
        chunk.chunkZ,
        predicted.chunkX,
        predicted.chunkZ,
      );
      if (Math.min(currentDistance, predictedDistance) <= this.config.unloadRadius) continue;
      this.unload(chunk.chunkX, chunk.chunkZ);
      this.loadedKeys.delete(key);
    }

    this.pruneQueue();
    this.queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
    this.updateCounters();
  }

  commitOwnerChunk(job, result, revision, colliders) {
    const replaced = this.world.replaceOwnerChunk({
      chunkX: job.chunkX,
      chunkZ: job.chunkZ,
      revision,
      colliders,
    });
    if (!replaced) {
      if (this.world.isOwnerChunkReady(job.chunkX, job.chunkZ)) {
        this.retryByKey.delete(job.key);
        this.loadedKeys.add(job.key);
      }
      return false;
    }

    try {
      this.onOwnerChunkCommitted?.({
        chunkX: job.chunkX,
        chunkZ: job.chunkZ,
        revision,
        providerData: result?.providerData ?? null,
      });
    } catch (error) {
      this.world.unloadOwnerChunk(job.chunkX, job.chunkZ);
      this.loadedKeys.delete(job.key);
      this.notifyOwnerUnloaded(job.chunkX, job.chunkZ);
      throw new Error(`Collision owner commit callback failed for ${job.key}.`, { cause: error });
    }

    this.retryByKey.delete(job.key);
    this.loadedKeys.add(job.key);
    this.builds += 1;
    return true;
  }

  flush() {
    const startedAt = this.now();
    let attempted = 0;
    let built = 0;
    let frameError = null;
    while (this.queue.length > 0 && attempted < this.config.buildsPerFrame) {
      if (attempted > 0 && this.now() - startedAt >= this.config.buildBudgetMs) break;
      const job = this.queue.shift();
      this.queuedByKey.delete(job.key);
      attempted += 1;
      if (!this.desiredKeys.has(job.key)) continue;
      try {
        const result = this.buildOwnerChunk(job.chunkX, job.chunkZ);
        if (result && typeof result.then === 'function') {
          throw new Error('Collision residency builders must be synchronous.');
        }
        const revision = result?.revision ?? 0;
        const colliders = result?.colliders ?? [];
        if (this.commitOwnerChunk(job, result, revision, colliders)) built += 1;
      } catch (error) {
        frameError = error;
        const failure = this.recordRetry(job.key, error);
        this.logger.error?.('Collision chunk build failed.', failure, error);
      }
    }
    if (frameError) this.lastBuildError = frameError;
    else if (attempted > 0 && this.retryByKey.size === 0) {
      this.lastBuildError = null;
      this.lastFailure = null;
    }
    PerfCounters.inc('collisionBuilds', built);
    PerfCounters.inc('collisionBuildMs', this.now() - startedAt);
    this.updateCounters();
    return Object.freeze({ attempted, built, remaining: this.queue.length });
  }

  checkDestination(aabb) {
    const readiness = this.world.checkAabbReadiness(aabb);
    const failed = readiness.missing
      .map((key) => this.retryByKey.get(key)?.failure ?? null)
      .filter(Boolean);
    return Object.freeze({
      ...readiness,
      failed: Object.freeze(failed),
      policy: COLLISION_NOT_READY_POLICY,
    });
  }

  getStatus() {
    let readyDesired = 0;
    for (const key of this.desiredKeys) {
      const chunk = parseCollisionChunkKey(key);
      if (this.world.isCollisionChunkReady(chunk.chunkX, chunk.chunkZ)) readyDesired += 1;
    }
    return Object.freeze({
      currentChunk: this.currentChunk,
      predictedChunk: this.predictedChunk,
      desiredChunks: this.desiredKeys.size,
      readyDesiredChunks: readyDesired,
      queuedBuilds: this.queue.length,
      deferredRetries: this.retryByKey.size,
      loadedOwnerChunks: this.loadedKeys.size,
      ready: this.desiredKeys.size > 0 && readyDesired === this.desiredKeys.size,
      notReadyPolicy: COLLISION_NOT_READY_POLICY,
      lastBuildError: this.lastBuildError?.message ?? null,
      failure: this.lastFailure,
    });
  }

  updateCounters() {
    const status = this.getStatus();
    PerfCounters.set('collisionDesiredChunks', status.desiredChunks);
    PerfCounters.set('collisionReadyDesiredChunks', status.readyDesiredChunks);
    PerfCounters.set(COLLISION_GAUGE_COUNTERS.queueDepth, status.queuedBuilds);
    PerfCounters.set('collisionBuildDeferredRetries', status.deferredRetries);
    PerfCounters.set(COLLISION_GAUGE_COUNTERS.failedChunks, status.deferredRetries);
    PerfCounters.set('collisionLoadedOwnerChunks', status.loadedOwnerChunks);
  }

  dispose() {
    this.queue.length = 0;
    this.queuedByKey.clear();
    this.retryByKey.clear();
    this.desiredKeys.clear();
    for (const key of this.loadedKeys) {
      const chunk = parseCollisionChunkKey(key);
      this.unload(chunk.chunkX, chunk.chunkZ);
    }
    this.loadedKeys.clear();
    this.currentChunk = null;
    this.predictedChunk = null;
    this.lastBuildError = null;
    this.lastFailure = null;
    this.builds = 0;
    this.sequence = 0;
    this.updateCounters();
  }
}
