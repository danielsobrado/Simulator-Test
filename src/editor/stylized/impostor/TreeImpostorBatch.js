import { CpuTreeImpostorBatch } from './CpuTreeImpostorBatch.js';
import { GpuTreeImpostorBatch } from './GpuTreeImpostorBatch.js';

export class TreeImpostorBatch {
  constructor({ renderer, scene, atlas, capacity, name, gpuCulling }) {
    this.mode = 'cpu';
    this.batch = null;
    this.acceptedRecords = 0;
    if (gpuCulling && renderer.backend?.isWebGPUBackend) {
      try {
        this.batch = new GpuTreeImpostorBatch({ renderer, scene, atlas, capacity, name });
        this.mode = 'gpu';
      } catch (error) {
        console.warn('GPU tree impostor batch unavailable; using CPU culling.', error);
      }
    }
    if (!this.batch) {
      this.batch = new CpuTreeImpostorBatch({ scene, atlas, capacity, name });
    }
  }

  setRecords(records) {
    this.acceptedRecords = this.batch.setRecords(records);
    return Object.freeze({
      mode: this.mode,
      requested: records.length,
      accepted: this.acceptedRecords,
      dropped: records.length - this.acceptedRecords,
    });
  }

  update(camera, origin, timestamp = 0) {
    return Object.freeze({
      mode: this.mode,
      submitted: this.batch.update(camera, origin, timestamp),
      accepted: this.acceptedRecords,
    });
  }

  dispose() {
    this.batch.dispose();
  }
}
