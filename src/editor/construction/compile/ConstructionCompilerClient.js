import { constructionCollisionSource } from '../../collision/providers/ConstructionCollisionSource.js';
import { compileConstructionPlan } from './compileConstructionPlan.js';

function staleError() {
  return new DOMException('A newer construction compile replaced this result.', 'AbortError');
}

function disposedError() {
  return new DOMException('Construction compiler was disposed.', 'AbortError');
}

function publishCollision(record, plan) {
  if (plan?.collision) constructionCollisionSource.applyPlan(record, plan.collision);
  return plan;
}

export class ConstructionCompilerClient {
  constructor({ workerFactory, collisionConfig = {} } = {}) {
    this.revisions = new Map();
    this.pending = new Map();
    this.nextRequestId = 1;
    this.worker = null;
    this.disposed = false;
    this.collisionConfig = Object.freeze({ ...collisionConfig });

    if (workerFactory || typeof Worker !== 'undefined') {
      try {
        const worker = workerFactory
          ? workerFactory()
          : new Worker(new URL('./constructionCompiler.worker.js', import.meta.url), {
            type: 'module',
          });
        if (worker) {
          this.worker = worker;
          worker.addEventListener('message', ({ data }) => {
            if (!this.disposed && this.worker === worker) this.receive(data);
          });
          worker.addEventListener('error', (event) => this.onWorkerError(event, worker));
        }
      } catch (error) {
        console.warn('Construction compiler worker is unavailable; compilation will run on the main thread.', error);
      }
    }
  }

  compile(record, options = {}) {
    if (this.disposed) return Promise.reject(disposedError());

    const activeRevision = this.revisions.get(record.id);
    if (activeRevision !== undefined && record.revision < activeRevision) {
      return Promise.reject(staleError());
    }

    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const previousRevision = activeRevision ?? 0;
    this.revisions.set(record.id, record.revision);
    for (const [id, pending] of this.pending) {
      if (
        pending.constructionId === record.id
        && pending.revision < record.revision
      ) {
        pending.reject(staleError());
        this.pending.delete(id);
      }
    }
    const compileOptions = Object.freeze({
      ...options,
      collision: Object.freeze({
        ...constructionCollisionSource.getConfig(),
        ...this.collisionConfig,
        ...(options.collision ?? {}),
      }),
    });
    if (!this.worker) {
      return Promise.resolve().then(() => {
        if (this.disposed) throw disposedError();
        if ((this.revisions.get(record.id) ?? 0) !== record.revision) throw staleError();
        const plan = compileConstructionPlan(record, compileOptions);
        if (this.disposed) throw disposedError();
        if ((this.revisions.get(record.id) ?? 0) !== record.revision) throw staleError();
        return publishCollision(record, plan);
      });
    }
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        constructionId: record.id,
        revision: record.revision,
        record,
        resolve,
        reject,
      });
      try {
        this.worker.postMessage({ requestId, record, options: compileOptions, previousRevision });
      } catch (error) {
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  receive(data = {}) {
    const { requestId, plan, error } = data;
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    if ((this.revisions.get(pending.constructionId) ?? 0) !== pending.revision) {
      pending.reject(staleError());
    } else if (error) {
      pending.reject(new Error(error));
    } else if (!plan || typeof plan !== 'object') {
      pending.reject(new Error('Construction compiler worker returned an invalid plan.'));
    } else {
      pending.resolve(publishCollision(pending.record, plan));
    }
  }

  onWorkerError(event, sourceWorker) {
    if (this.disposed || this.worker !== sourceWorker) return;
    event.preventDefault?.();
    const error = event.error ?? new Error(event.message || 'Construction compiler worker failed.');
    sourceWorker.terminate();
    this.worker = null;
    this.failAll(error);
  }

  failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.failAll(disposedError());
    this.worker?.terminate();
    this.worker = null;
    this.revisions.clear();
  }
}
