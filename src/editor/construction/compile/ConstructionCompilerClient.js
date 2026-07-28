import { constructionCollisionSource } from '../../collision/providers/ConstructionCollisionSource.js';
import { compileConstructionPlan } from './compileConstructionPlan.js';

function staleError() {
  return new DOMException('A newer construction compile replaced this result.', 'AbortError');
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
    this.collisionConfig = Object.freeze({ ...collisionConfig });
    if (typeof Worker !== 'undefined') {
      this.worker = workerFactory
        ? workerFactory()
        : new Worker(new URL('./constructionCompiler.worker.js', import.meta.url), {
          type: 'module',
        });
      this.worker.addEventListener('message', ({ data }) => this.receive(data));
      this.worker.addEventListener('error', (event) => this.failAll(event.error ?? new Error(event.message)));
    }
  }

  compile(record, options = {}) {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;
    const previousRevision = this.revisions.get(record.id) ?? 0;
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
        ...this.collisionConfig,
        ...(options.collision ?? {}),
      }),
    });
    if (!this.worker) {
      return Promise.resolve(publishCollision(
        record,
        compileConstructionPlan(record, compileOptions),
      ));
    }
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        constructionId: record.id,
        revision: record.revision,
        record,
        resolve,
        reject,
      });
      this.worker.postMessage({ requestId, record, options: compileOptions, previousRevision });
    });
  }

  receive({ requestId, plan, error }) {
    const pending = this.pending.get(requestId);
    if (!pending) return;
    this.pending.delete(requestId);
    if ((this.revisions.get(pending.constructionId) ?? 0) !== pending.revision) {
      pending.reject(staleError());
    } else if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(publishCollision(pending.record, plan));
    }
  }

  failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  dispose() {
    this.failAll(staleError());
    this.worker?.terminate();
    this.worker = null;
  }
}
