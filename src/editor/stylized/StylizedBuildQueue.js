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
    this.nextSequence = 0;
  }

  get size() {
    return this.queue.length;
  }

  clear() {
    this.queue.length = 0;
  }

  enqueue(job) {
    const key = job.key;
    this.queue = this.queue.filter((entry) => entry.key !== key);
    const queued = {
      ...job,
      queuePriority: Number.isFinite(job.priority) ? job.priority : Number.POSITIVE_INFINITY,
      queueSequence: this.nextSequence,
    };
    this.nextSequence += 1;
    this.queue.push(queued);
    this.queue.sort((left, right) => (
      left.queuePriority - right.queuePriority
      || left.queueSequence - right.queueSequence
    ));
  }

  flush(run) {
    const startedAt = this.now();
    let built = 0;
    if (this.shouldYield?.()) return { built: 0, remaining: this.queue.length };
    while (
      this.queue.length > 0
      && built < this.buildsPerFrame
      && this.now() - startedAt < this.budgetMs
    ) {
      const job = this.queue.shift();
      // Only count successful work so stale/no-op jobs cannot starve real rebuilds.
      if (run(job)) {
        built += 1;
      }
    }
    return { built, remaining: this.queue.length };
  }
}
