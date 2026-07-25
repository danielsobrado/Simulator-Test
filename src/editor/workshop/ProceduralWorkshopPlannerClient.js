import { planWorkshopComposition } from './ProceduralWorkshopComposition.js';

function staleError() {
  return new DOMException('A newer workshop plan replaced this result.', 'AbortError');
}

export class ProceduralWorkshopPlannerClient {
  constructor({ workerFactory } = {}) {
    this.revision = 0;
    this.pending = new Map();
    this.worker = null;
    if (typeof Worker !== 'undefined') {
      this.worker = workerFactory
        ? workerFactory()
        : new Worker(new URL('./ProceduralWorkshopPlanner.worker.js', import.meta.url), {
          type: 'module',
        });
      this.worker.addEventListener('message', ({ data }) => this.receive(data));
      this.worker.addEventListener('error', (event) => this.failAll(
        new Error(event.message || 'Workshop planning worker failed.'),
      ));
    }
  }

  plan(recipe, dirtyIds = []) {
    const revision = ++this.revision;
    for (const [pendingRevision, pending] of this.pending) {
      if (pendingRevision < revision) {
        pending.reject(staleError());
        this.pending.delete(pendingRevision);
      }
    }
    if (!this.worker) return Promise.resolve(planWorkshopComposition(recipe, dirtyIds));
    return new Promise((resolve, reject) => {
      this.pending.set(revision, { resolve, reject });
      this.worker.postMessage({ revision, recipe, dirtyIds });
    });
  }

  receive({ revision, plan, error }) {
    const pending = this.pending.get(revision);
    if (!pending) return;
    this.pending.delete(revision);
    if (revision !== this.revision) {
      pending.reject(staleError());
    } else if (error) {
      pending.reject(new Error(error));
    } else {
      pending.resolve(plan);
    }
  }

  cancel() {
    this.revision += 1;
    this.failAll(staleError());
  }

  failAll(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  dispose() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
  }
}
