/**
 * Limits heavy stylized rebuilds per frame.
 */
export class StylizedBuildQueue {
  constructor({
    buildsPerFrame = 1,
    budgetMs = 3,
    now = () => performance.now(),
    shouldYield = null,
  } = {}) {
    this.buildsPerFrame = buildsPerFrame;
    this.budgetMs = budgetMs;
    this.now = now;
    // Optional frame-wide gate. Each queue is budgeted on its own, but rocks,
    // trees and bushes all flush inside one update, so without a shared view of
    // the frame three separately "cheap" queues can still stack into one hitch.
    this.shouldYield = typeof shouldYield === 'function' ? shouldYield : null;
    this.queue = [];
    this.entriesByKey = new Map();
    this.sortDirty = false;
    this.nextSequence = 0;
  }

  get size() {
    return this.queue.length;
  }

  clear() {
    this.queue.length = 0;
    this.entriesByKey.clear();
    this.sortDirty = false;
    this.nextSequence = 0;
  }

  enqueue(job) {
    const key = job.key;
    const priority = Number.isFinite(job.priority)
      ? job.priority
      : Number.POSITIVE_INFINITY;
    const existing = this.entriesByKey.get(key);
    if (existing) {
      Object.assign(existing, job);
      if (existing.queuePriority === priority) return false;
      existing.queuePriority = priority;
      this.sortDirty = true;
      return true;
    }

    const queued = {
      ...job,
      queuePriority: priority,
      queueSequence: this.nextSequence,
    };
    this.nextSequence += 1;
    this.queue.push(queued);
    this.entriesByKey.set(key, queued);
    this.sortDirty = true;
    return true;
  }

  sortQueue() {
    if (!this.sortDirty) return;
    this.queue.sort((left, right) => (
      left.queuePriority - right.queuePriority
      || left.queueSequence - right.queueSequence
    ));
    this.sortDirty = false;
  }

  flush(run) {
    const startedAt = this.now();
    let built = 0;
    const shouldYield = () => (
      this.now() - startedAt >= this.budgetMs
      || Boolean(this.shouldYield?.())
    );
    if (shouldYield()) return { built: 0, remaining: this.queue.length };
    this.sortQueue();
    while (
      this.queue.length > 0
      && built < this.buildsPerFrame
      && !shouldYield()
    ) {
      const job = this.queue.shift();
      this.entriesByKey.delete(job.key);
      // Only count successful work so stale/no-op jobs cannot starve real rebuilds.
      if (run(job, shouldYield)) {
        built += 1;
      }
    }
    return { built, remaining: this.queue.length };
  }
}
