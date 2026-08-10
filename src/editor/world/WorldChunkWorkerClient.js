import { generateBaseWorldChunk } from './generateWorldChunk.js';
import { createWorldGenerator } from './WorldGeneratorFactory.js';
import { chunkKey } from './WorldCoordinates.js';

const MAX_WORKER_RESTARTS = 2;

/** Resolve the worker pool size from an explicit override or CPU cores. */
export function resolveWorkerCount(requested) {
  if (Number.isFinite(requested) && requested > 0) {
    return Math.max(1, Math.floor(requested));
  }
  const cores = (typeof navigator !== 'undefined'
    && Number.isFinite(navigator.hardwareConcurrency))
    ? navigator.hardwareConcurrency
    : 4;
  // Leave one core for the main thread; clamp to a sane range.
  return Math.min(8, Math.max(2, cores - 1));
}

/**
 * Pool of chunk-generation workers.
 *
 * Requests are held in a client-side priority queue and dispatched to the
 * least-busy worker (up to `maxInFlightPerWorker` each). Holding jobs here —
 * rather than posting them all into a single worker's message queue — is what
 * makes priority and cancellation meaningful: the player's next chunk can jump
 * ahead of far prefetch chunks, and a chunk that leaves the resident set before
 * it starts generating can be dropped.
 */
export class WorldChunkWorkerClient {
  constructor({
    chunkSize,
    generator,
    surfaceMaskConfig = null,
    vegetationScatterConfig = null,
    workerCount = null,
    maxInFlightPerWorker = 1,
  }) {
    this.chunkSize = chunkSize;
    this.generator = generator.toMetadata();
    this.baseTerrain = null;
    this.worldGenerator = createWorldGenerator(this.generator);
    this.surfaceMaskConfig = surfaceMaskConfig;
    this.vegetationScatterConfig = vegetationScatterConfig;
    this.maxInFlightPerWorker = Math.max(1, maxInFlightPerWorker);
    this.nextId = 1;
    this.pending = new Map();      // id -> { resolve, reject, workerIndex }
    this.queue = [];               // waiting jobs (not yet dispatched)
    this.queuedByKey = new Map();  // chunk key -> queued job (for cancel/reprioritize)
    this.disposed = false;
    this.workers = [];
    this.inFlight = [];
    this.workerRestartCounts = [];

    if (typeof Worker === 'function') {
      const count = resolveWorkerCount(workerCount);
      for (let index = 0; index < count; index += 1) {
        this.workers[index] = this.createWorker(index);
        this.inFlight[index] = 0;
        this.workerRestartCounts[index] = 0;
      }
    }
  }

  createWorker(workerIndex) {
    const worker = new Worker(
      new URL('./worldChunk.worker.js', import.meta.url),
      { type: 'module' },
    );
    worker.addEventListener('message', (event) => this.onMessage(event));
    worker.addEventListener('error', (event) => this.onError(event, workerIndex));
    return worker;
  }

  get workerCount() {
    return this.workers.reduce((count, worker) => count + Number(Boolean(worker)), 0);
  }

  setBaseTerrain(baseTerrain) {
    this.baseTerrain = baseTerrain ? structuredClone(baseTerrain) : null;
    this.worldGenerator = createWorldGenerator(this.generator, this.baseTerrain);
    for (const worker of this.workers) {
      worker?.postMessage({ type: 'configure', baseTerrain: this.baseTerrain });
    }
  }

  request(chunkX, chunkZ, { priority = 0 } = {}) {
    if (this.disposed) {
      return Promise.reject(new Error('World chunk worker is disposed.'));
    }
    const request = {
      chunkX,
      chunkZ,
      chunkSize: this.chunkSize,
      generator: this.generator,
      surfaceMaskConfig: this.surfaceMaskConfig,
      vegetationScatterConfig: this.vegetationScatterConfig,
    };
    // No workers available (Node/tests): generate synchronously.
    if (this.workers.length === 0) {
      return Promise.resolve(generateBaseWorldChunk({
        ...request,
        worldGenerator: this.worldGenerator,
      }));
    }
    if (this.workerCount === 0) {
      return Promise.reject(new Error('World chunk worker pool is unavailable.'));
    }

    const id = this.nextId;
    this.nextId += 1;
    const key = chunkKey(chunkX, chunkZ);
    return new Promise((resolve, reject) => {
      const job = {
        id,
        request,
        key,
        priority,
        resolve,
        reject,
        requestedAt: performance.now(),
      };
      this.queue.push(job);
      this.queuedByKey.set(key, job);
      this.pump();
    });
  }

  /** Raise/lower the priority of a still-queued request. No-op once dispatched. */
  reprioritize(chunkX, chunkZ, priority) {
    const job = this.queuedByKey.get(chunkKey(chunkX, chunkZ));
    if (!job) {
      return false;
    }
    job.priority = priority;
    return true;
  }

  /** Drop a request that has not started generating yet. */
  cancel(chunkX, chunkZ) {
    const key = chunkKey(chunkX, chunkZ);
    const job = this.queuedByKey.get(key);
    if (!job) {
      return false;
    }
    this.queuedByKey.delete(key);
    this.queue = this.queue.filter((entry) => entry.id !== job.id);
    const error = new Error('World chunk request cancelled.');
    error.cancelled = true;
    job.reject(error);
    return true;
  }

  pickWorker() {
    let best = -1;
    let bestLoad = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.workers.length; index += 1) {
      if (!this.workers[index]) continue;
      const load = this.inFlight[index];
      if (load < this.maxInFlightPerWorker && load < bestLoad) {
        best = index;
        bestLoad = load;
      }
    }
    return best;
  }

  pump() {
    if (this.disposed) {
      return;
    }
    while (this.queue.length > 0) {
      const workerIndex = this.pickWorker();
      if (workerIndex < 0) {
        break; // every worker is at capacity; wait for a completion
      }
      this.queue.sort((left, right) => left.priority - right.priority || left.id - right.id);
      const job = this.queue.shift();
      this.queuedByKey.delete(job.key);
      this.inFlight[workerIndex] += 1;
      this.pending.set(job.id, {
        resolve: job.resolve,
        reject: job.reject,
        workerIndex,
        requestedAt: job.requestedAt,
        dispatchedAt: performance.now(),
      });
      this.workers[workerIndex].postMessage({ id: job.id, request: job.request });
    }
  }

  onMessage(event) {
    const { id, page, error } = event.data ?? {};
    const pending = this.pending.get(id);
    if (!pending) {
      return;
    }
    this.pending.delete(id);
    this.inFlight[pending.workerIndex] = Math.max(0, this.inFlight[pending.workerIndex] - 1);
    this.workerRestartCounts[pending.workerIndex] = 0;
    if (error) {
      pending.reject(new Error(error));
    } else if (!page || typeof page !== 'object') {
      pending.reject(new Error('World chunk worker returned an invalid page.'));
    } else {
      const completedAt = performance.now();
      page.timings = {
        ...(page.timings ?? {}),
        workerCompleteMs: completedAt - pending.dispatchedAt,
        queueWaitMs: pending.dispatchedAt - pending.requestedAt,
      };
      pending.resolve(page);
    }
    this.pump();
  }

  onError(event, workerIndex) {
    if (this.disposed) return;

    event.preventDefault?.();
    const error = new Error(event.message || 'World chunk worker failed.');
    const failedWorker = this.workers[workerIndex];
    failedWorker?.terminate();
    this.workers[workerIndex] = null;

    for (const [id, pending] of this.pending.entries()) {
      if (pending.workerIndex !== workerIndex) continue;
      pending.reject(error);
      this.pending.delete(id);
    }
    this.inFlight[workerIndex] = 0;

    const restartCount = (this.workerRestartCounts[workerIndex] ?? 0) + 1;
    this.workerRestartCounts[workerIndex] = restartCount;
    if (restartCount <= MAX_WORKER_RESTARTS) {
      let replacement = null;
      try {
        replacement = this.createWorker(workerIndex);
        if (this.baseTerrain) {
          replacement.postMessage({ type: 'configure', baseTerrain: this.baseTerrain });
        }
        this.workers[workerIndex] = replacement;
      } catch (replacementError) {
        replacement?.terminate();
        this.workers[workerIndex] = null;
        this.workerRestartCounts[workerIndex] = MAX_WORKER_RESTARTS + 1;
        console.error('Failed to replace world chunk worker.', replacementError);
      }
    } else {
      console.error(`World chunk worker ${workerIndex} disabled after repeated failures.`, error);
    }

    if (this.workerCount === 0) {
      const queued = this.queue;
      this.queue = [];
      this.queuedByKey.clear();
      for (const job of queued) job.reject(error);
      return;
    }

    this.pump();
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    for (const worker of this.workers) {
      worker?.terminate();
    }
    this.workers = [];
    this.inFlight = [];
    this.workerRestartCounts = [];
    const error = new Error('World chunk worker was disposed.');
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
    for (const job of this.queue) {
      job.reject(error);
    }
    this.queue = [];
    this.queuedByKey.clear();
  }
}
