import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { collisionChunkKey, parseCollisionChunkKey } from './CollisionIds.js';
import {
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

export class CollisionResidency {
  constructor({
    world,
    config,
    buildOwnerChunk,
    now = () => performance.now(),
    logger = console,
  }) {
    if (!world) throw new Error('Collision residency requires a world.');
    if (typeof buildOwnerChunk !== 'function') {
      throw new Error('Collision residency requires a buildOwnerChunk callback.');
    }
    if (typeof now !== 'function') throw new Error('Collision residency now must be a function.');
    validateResidencyConfig(config);
    this.world = world;
    this.config = config;
    this.buildOwnerChunk = buildOwnerChunk;
    this.now = now;
    this.logger = logger ?? console;
    this.desiredKeys = new Set();
    this.loadedKeys = new Set();
    this.queue = [];
    this.queuedByKey = new Map();
    this.currentChunk = null;
    this.predictedChunk = null;
    this.lastBuildError = null;
    this.builds = 0;
    this.sequence = 0;
  }

  schedule(chunkX, chunkZ, priority) {
    const key = collisionChunkKey(chunkX, chunkZ);
    if (this.world.isOwnerChunkReady(chunkX, chunkZ)) {
      this.loadedKeys.add(key);
      return;
    }
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
        this.schedule(chunkX, chunkZ, chebyshevDistance(chunkX, chunkZ, current.chunkX, current.chunkZ) + 1);
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
      this.world.unloadOwnerChunk(chunk.chunkX, chunk.chunkZ);
      this.loadedKeys.delete(key);
    }

    this.pruneQueue();
    this.queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
    this.updateCounters();
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
          throw new Error('P1 collision residency builders must be synchronous.');
        }
        const revision = result?.revision ?? 0;
        const colliders = result?.colliders ?? [];
        const replaced = this.world.replaceOwnerChunk({
          chunkX: job.chunkX,
          chunkZ: job.chunkZ,
          revision,
          colliders,
        });
        this.loadedKeys.add(job.key);
        if (replaced) {
          this.builds += 1;
          built += 1;
        }
      } catch (error) {
        frameError = error;
        this.logger.error?.(`Collision chunk build failed for ${job.key}.`, error);
      }
    }
    if (frameError) this.lastBuildError = frameError;
    else if (attempted > 0) this.lastBuildError = null;
    PerfCounters.inc('collisionBuilds', built);
    PerfCounters.inc('collisionBuildMs', this.now() - startedAt);
    this.updateCounters();
    return Object.freeze({ attempted, built, remaining: this.queue.length });
  }

  checkDestination(aabb) {
    const readiness = this.world.checkAabbReadiness(aabb);
    return Object.freeze({
      ...readiness,
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
      loadedOwnerChunks: this.loadedKeys.size,
      ready: this.desiredKeys.size > 0 && readyDesired === this.desiredKeys.size,
      notReadyPolicy: COLLISION_NOT_READY_POLICY,
      lastBuildError: this.lastBuildError?.message ?? null,
    });
  }

  updateCounters() {
    const status = this.getStatus();
    PerfCounters.set('collisionDesiredChunks', status.desiredChunks);
    PerfCounters.set('collisionReadyDesiredChunks', status.readyDesiredChunks);
    PerfCounters.set('collisionBuildQueueDepth', status.queuedBuilds);
    PerfCounters.set('collisionLoadedOwnerChunks', status.loadedOwnerChunks);
  }

  dispose() {
    this.queue.length = 0;
    this.queuedByKey.clear();
    this.desiredKeys.clear();
    for (const key of this.loadedKeys) {
      const chunk = parseCollisionChunkKey(key);
      this.world.unloadOwnerChunk(chunk.chunkX, chunk.chunkZ);
    }
    this.loadedKeys.clear();
    this.currentChunk = null;
    this.predictedChunk = null;
    this.lastBuildError = null;
    this.builds = 0;
    this.sequence = 0;
    this.updateCounters();
  }
}
