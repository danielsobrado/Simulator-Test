import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { collisionChunkKey, parseCollisionChunkKey } from './CollisionIds.js';
import { collisionChunkForCanonical } from './colliders/ColliderBounds.js';

export const COLLISION_NOT_READY_POLICY = 'retain-previous-valid-position';

function chebyshevDistance(leftX, leftZ, rightX, rightZ) {
  return Math.max(Math.abs(leftX - rightX), Math.abs(leftZ - rightZ));
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

export class CollisionResidency {
  constructor({
    world,
    config,
    buildOwnerChunk,
    now = () => performance.now(),
  }) {
    if (!world) throw new Error('Collision residency requires a world.');
    if (typeof buildOwnerChunk !== 'function') {
      throw new Error('Collision residency requires a buildOwnerChunk callback.');
    }
    this.world = world;
    this.config = config;
    this.buildOwnerChunk = buildOwnerChunk;
    this.now = now;
    this.desiredKeys = new Set();
    this.loadedKeys = new Set();
    this.queue = [];
    this.queuedByKey = new Map();
    this.currentChunk = null;
    this.predictedChunk = null;
    this.lastBuildError = null;
    this.builds = 0;
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
    const job = { key, chunkX, chunkZ, priority, sequence: this.builds + this.queue.length };
    this.queuedByKey.set(key, job);
    this.queue.push(job);
  }

  update({ focus, velocity = { x: 0, z: 0 } }) {
    const chunkWorldSize = this.world.chunkWorldSize;
    const current = collisionChunkForCanonical(focus.x, focus.z, chunkWorldSize);
    const predicted = collisionChunkForCanonical(
      focus.x + velocity.x * this.config.prefetchSeconds,
      focus.z + velocity.z * this.config.prefetchSeconds,
      chunkWorldSize,
    );
    this.currentChunk = current;
    this.predictedChunk = predicted;
    this.desiredKeys.clear();

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

    for (const key of [...this.loadedKeys]) {
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

    this.queue.sort((left, right) => left.priority - right.priority || left.sequence - right.sequence);
    this.updateCounters();
  }

  flush() {
    const startedAt = this.now();
    let built = 0;
    while (this.queue.length > 0 && built < this.config.buildsPerFrame) {
      if (built > 0 && this.now() - startedAt >= this.config.buildBudgetMs) break;
      const job = this.queue.shift();
      this.queuedByKey.delete(job.key);
      if (!this.desiredKeys.has(job.key)) continue;
      try {
        const result = this.buildOwnerChunk(job.chunkX, job.chunkZ);
        if (result && typeof result.then === 'function') {
          throw new Error('P1 collision residency builders must be synchronous.');
        }
        const revision = result?.revision ?? 0;
        const colliders = result?.colliders ?? [];
        this.world.replaceOwnerChunk({
          chunkX: job.chunkX,
          chunkZ: job.chunkZ,
          revision,
          colliders,
        });
        this.loadedKeys.add(job.key);
        this.builds += 1;
        built += 1;
        this.lastBuildError = null;
      } catch (error) {
        this.lastBuildError = error;
        console.error(`Collision chunk build failed for ${job.key}.`, error);
      }
    }
    PerfCounters.inc('collisionBuilds', built);
    PerfCounters.inc('collisionBuildMs', this.now() - startedAt);
    this.updateCounters();
    return Object.freeze({ built, remaining: this.queue.length });
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
    this.updateCounters();
  }
}
