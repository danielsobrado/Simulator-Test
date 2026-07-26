import { planConstruction } from '../planning/ConstructionPlanner.js';

function staleError() {
  return new DOMException('A newer construction compile replaced this result.', 'AbortError');
}

export class ConstructionCompilerClient {
  constructor({ workerFactory } = {}) {
    this.revisions = new Map();
    this.pending = new Map();
    this.nextRequestId = 1;
    this.worker = null;
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
    if (!this.worker) return Promise.resolve(planConstruction(record, options));
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        constructionId: record.id,
        revision: record.revision,
        resolve,
        reject,
      });
      this.worker.postMessage({ requestId, record, options, previousRevision });
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
      pending.resolve(plan);
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

