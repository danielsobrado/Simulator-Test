/**
 * Frame-budgeted terrain page commits.
 * Worker results only enqueue; memcpy + needsUpdate runs here (no getTile / mask gen).
 */

export const TERRAIN_MAX_COMMITS_PER_FRAME = 1;
export const TERRAIN_MAX_COMMITS_PER_FRAME_IDLE = 4;
export const TERRAIN_COMMIT_BUDGET_MS = 2;
// Focus speed (world units/sec) below which the player counts as stationary.
export const TERRAIN_MOVING_SPEED_EPSILON = 0.5;

function assertMaxCommits(value, { allowInfinity = false } = {}) {
  if (allowInfinity && value === Number.POSITIVE_INFINITY) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('Terrain commit limit must be a non-negative safe integer.');
  }
}

function assertBudgetMs(value, { allowInfinity = false } = {}) {
  if (allowInfinity && value === Number.POSITIVE_INFINITY) return;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Terrain commit budget must be a non-negative finite number.');
  }
}

export function createTerrainCommitJob({
  slot,
  page,
  token,
  priority = 0,
  enqueuedAt = performance.now(),
}) {
  return {
    slot,
    page,
    token,
    priority,
    enqueuedAt,
  };
}

export function commitPriority({
  descriptor,
  focusChunk,
  velocity = { x: 0, z: 0 },
}) {
  const dx = descriptor.chunkX - focusChunk.chunkX;
  const dz = descriptor.chunkZ - focusChunk.chunkZ;
  const distance = Math.max(Math.abs(dx), Math.abs(dz));
  const speed = Math.hypot(velocity.x, velocity.z);
  let aheadPenalty = 0;
  if (speed > 1e-6 && distance > 0) {
    // World +X → +chunkX; world +Z → −chunkZ (see WorldCoordinates).
    const dirX = velocity.x / speed;
    const dirZ = -velocity.z / speed;
    const len = Math.hypot(dx, dz) || 1;
    const facing = (dx / len) * dirX + (dz / len) * dirZ;
    aheadPenalty = facing > 0.15 ? -1 : facing < -0.15 ? 1 : 0;
  }
  return distance * 10 + aheadPenalty;
}

export class TerrainCommitQueue {
  constructor({
    maxCommitsPerFrame = TERRAIN_MAX_COMMITS_PER_FRAME,
    commitBudgetMs = TERRAIN_COMMIT_BUDGET_MS,
    now = () => performance.now(),
  } = {}) {
    assertMaxCommits(maxCommitsPerFrame);
    assertBudgetMs(commitBudgetMs);
    if (typeof now !== 'function') {
      throw new Error('Terrain commit clock must be a function.');
    }
    this.maxCommitsPerFrame = maxCommitsPerFrame;
    this.commitBudgetMs = commitBudgetMs;
    this.now = now;
    this.queue = [];
    this.maxQueuedAgeMs = 0;
  }

  get size() {
    return this.queue.length;
  }

  clear() {
    this.queue.length = 0;
    this.maxQueuedAgeMs = 0;
  }

  enqueue(job) {
    const slotIndex = job.slot.slotIndex;
    this.queue = this.queue.filter((entry) => entry.slot.slotIndex !== slotIndex);
    this.queue.push(job);
    this.queue.sort((left, right) => left.priority - right.priority);
  }

  /**
   * @param {(job: object) => void} commit
   * @param {(job: object) => boolean} [isCurrent]
   */
  flush(commit, isCurrent = null, {
    maxCommits = this.maxCommitsPerFrame,
    budgetMs = this.commitBudgetMs,
  } = {}) {
    assertMaxCommits(maxCommits, { allowInfinity: true });
    assertBudgetMs(budgetMs, { allowInfinity: true });
    const startedAt = this.now();
    let committed = 0;

    while (
      this.queue.length > 0
      && committed < maxCommits
      && this.now() - startedAt < budgetMs
    ) {
      const job = this.queue.shift();
      if (isCurrent && !isCurrent(job)) {
        continue;
      }
      this.maxQueuedAgeMs = Math.max(this.maxQueuedAgeMs, this.now() - job.enqueuedAt);
      commit(job);
      committed += 1;
    }

    return {
      committed,
      remaining: this.queue.length,
      maxQueuedAgeMs: this.maxQueuedAgeMs,
    };
  }

  drain(commit, isCurrent = null) {
    return this.flush(commit, isCurrent, {
      maxCommits: Number.POSITIVE_INFINITY,
      budgetMs: Number.POSITIVE_INFINITY,
    });
  }
}
