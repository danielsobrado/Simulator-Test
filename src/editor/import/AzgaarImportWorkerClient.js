import { importAzgaarFullJson } from './AzgaarJsonImporter.js';

function disposedError() {
  return new Error('Azgaar import worker was disposed.');
}

export class AzgaarImportWorkerClient {
  constructor() {
    this.nextId = 1;
    this.pending = new Map();
    this.disposed = false;
    this.worker = null;

    if (typeof Worker === 'function') {
      try {
        this.worker = this.createWorker();
      } catch (error) {
        console.warn('Azgaar import worker is unavailable; imports will run on the main thread.', error);
      }
    }
  }

  createWorker() {
    const worker = new Worker(
      new URL('./azgaarImport.worker.js', import.meta.url),
      { type: 'module' },
    );
    worker.addEventListener('message', (event) => this.onMessage(event, worker));
    worker.addEventListener('error', (event) => this.onError(event, worker));
    return worker;
  }

  convert(document, config, options = {}) {
    if (this.disposed) {
      return Promise.reject(disposedError());
    }
    if (!this.worker) {
      return Promise.resolve()
        .then(() => {
          if (this.disposed) throw disposedError();
          return importAzgaarFullJson(document, config, options);
        })
        .then((world) => {
          if (this.disposed) throw disposedError();
          return world;
        });
    }

    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, document, config, options });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  onMessage(event, sourceWorker) {
    if (this.disposed || this.worker !== sourceWorker) return;
    const { id, world, error } = event.data ?? {};
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (error) {
      pending.reject(new Error(error));
    } else if (!world || typeof world !== 'object') {
      pending.reject(new Error('Azgaar import worker returned an invalid world document.'));
    } else {
      pending.resolve(world);
    }
  }

  onError(event, sourceWorker) {
    if (this.disposed || this.worker !== sourceWorker) return;
    event.preventDefault?.();
    const error = new Error(event.message || 'Azgaar import worker failed.');
    sourceWorker.terminate();
    this.worker = null;
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    const error = disposedError();
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}
