import { AttributeType } from 'three/src/renderers/common/Constants.js';
import { PerfCounters } from '../../editor/performance/qa/PerfCounters.js';

/** Pinned Three r187 adapter: initialize hidden float attributes before their first draw. */
export class BudgetedAttributeInitialization {
  constructor(renderer) {
    this.renderer = renderer;
    this.jobs = new Map();
  }

  get supported() {
    return Boolean(this.renderer?.backend?.isWebGPUBackend
      && this.renderer.backend.device && this.renderer._attributes?.update);
  }

  advance(attributes, byteLimit, shouldYield = null) {
    const { backend, _attributes: manager } = this.renderer;
    let bytes = 0;
    for (const attribute of attributes) {
      if (!(attribute.array instanceof Float32Array) || !attribute.isInstancedBufferAttribute
          || ![2, 4].includes(attribute.itemSize)) {
        throw new Error('Budgeted initial upload requires packed float2/float4 instance attributes.');
      }
      let job = this.jobs.get(attribute);
      if (!job) {
        if (shouldYield?.() || bytes >= byteLimit) break;
        const data = backend.get(attribute);
        const created = !data.buffer;
        if (created) {
          const started = performance.now();
          data.buffer = backend.device.createBuffer({ label: attribute.name,
            size: attribute.array.byteLength,
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST });
          // Register Three's normal accounting, generations and disposal listeners.
          manager.update(attribute, AttributeType.VERTEX);
          PerfCounters.inc('meadowInitialGpuAllocationBytes', attribute.array.byteLength);
          PerfCounters.inc('meadowInitialGpuAllocationMs', performance.now() - started);
        }
        const current = !created && manager.get(attribute).version === attribute.version;
        job = { version: attribute.version, offset: current ? attribute.array.byteLength : 0, created };
        this.jobs.set(attribute, job);
      }
      if (job.version !== attribute.version) {
        job.version = attribute.version;
        job.offset = 0;
      }
      const remaining = attribute.array.byteLength - job.offset;
      if (remaining > 0) {
        if (shouldYield?.()) break;
        const count = Math.min(remaining, Math.floor((byteLimit - bytes) / 4) * 4);
        if (count <= 0) break;
        backend.device.queue.writeBuffer(backend.get(attribute).buffer, job.offset,
          attribute.array, job.offset / 4, count / 4);
        job.offset += count;
        bytes += count;
      }
      if (job.offset < attribute.array.byteLength) break;
    }
    const ready = attributes.every(attribute => {
      const job = this.jobs.get(attribute);
      return job && job.version === attribute.version && job.offset === attribute.array.byteLength;
    });
    if (ready) {
      for (const attribute of attributes) {
        manager.get(attribute).version = attribute.version;
        attribute.clearUpdateRanges();
      }
    }
    if (bytes) {
      PerfCounters.inc('meadowInitialGpuUploadBytes', bytes);
      PerfCounters.inc('meadowInitialGpuUploadSlices');
    }
    return { ready, bytes };
  }

  release(attributes) {
    for (const attribute of attributes) this.jobs.delete(attribute);
  }

  cancel(attributes = [...this.jobs.keys()]) {
    for (const attribute of attributes) {
      if (this.jobs.get(attribute)?.created) this.renderer._attributes.delete(attribute);
      this.jobs.delete(attribute);
    }
  }
}
