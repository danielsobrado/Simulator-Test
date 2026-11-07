import { CpuTreeImpostorBatch } from './CpuTreeImpostorBatch.js';
import { GpuTreeImpostorBatch } from './GpuTreeImpostorBatch.js';
import { PerfCounters } from '../../performance/qa/PerfCounters.js';

export class TreeImpostorBatch {
  constructor({ renderer, scene, atlas, capacity, name, gpuCulling, auxiliaryViews = false, ambientEffects = null }) {
    this.mode = 'cpu';
    this.batch = null;
    this.acceptedRecords = 0;
    if (gpuCulling && renderer.backend?.isWebGPUBackend) {
      try {
        this.batch = new GpuTreeImpostorBatch({ renderer, scene, atlas, capacity, name, ambientEffects });
        this.mode = 'gpu';
      } catch (error) {
        console.warn('GPU tree impostor batch unavailable; using CPU culling.', error);
      }
    }
    if (!this.batch) {
      this.batch = new CpuTreeImpostorBatch({ scene, atlas, capacity, name, ambientEffects });
    }
    this.auxiliary = auxiliaryViews ? new CpuTreeImpostorBatch({ scene, atlas, capacity, name: `${name}-reflection`, ambientEffects }) : null;
    if (this.auxiliary) this.auxiliary.mesh.visible = false;
  }

  setRecords(records) {
    this.acceptedRecords = this.batch.setRecords(records);
    this.auxiliary?.setRecords(records);
    return Object.freeze({
      mode: this.mode,
      requested: records.length,
      accepted: this.acceptedRecords,
      dropped: records.length - this.acceptedRecords,
    });
  }

  update(camera, origin, timestamp = 0, computeQueue = null) {
    return Object.freeze({
      mode: this.mode,
      submitted: this.batch.update(camera, origin, timestamp, computeQueue),
      accepted: this.acceptedRecords,
    });
  }

  dispose() {
    this.batch.dispose();
    this.auxiliary?.dispose();
  }

  withCamera(camera, origin, timestamp, operation) {
    if (!this.auxiliary) return operation();
    const visible = this.batch.mesh.visible, auxiliaryVisible = this.auxiliary.mesh.visible;
    try {
      const started = performance.now();
      try { this.auxiliary.update(camera, origin, timestamp); }
      finally {
        const elapsed = performance.now() - started;
        PerfCounters.inc('treeImpostorAuxiliaryCpuMs', elapsed);
        PerfCounters.inc('treeImpostorAuxiliaryUpdates');
        PerfCounters.inc('treeImpostorAuxiliaryRecordsTested', this.auxiliary.lastCullRecordCount);
        if (this.auxiliary.lastCullReused) PerfCounters.inc('treeImpostorAuxiliaryCacheHits');
        PerfCounters.set('treeImpostorAuxiliaryMaxCpuMs', Math.max(PerfCounters.get('treeImpostorAuxiliaryMaxCpuMs'), elapsed));
      }
      this.batch.mesh.visible = false;
      return operation();
    } finally { this.batch.mesh.visible = visible; this.auxiliary.mesh.visible = auxiliaryVisible; }
  }
}
