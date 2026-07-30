export const POST_PROCESSING_GPU_TIMING_KEYS = Object.freeze([
  'sceneMrt',
  'volumetricOrShafts',
  'ssrDepthHierarchy',
  'ssrTrace',
  'ssrTemporal',
  'taa',
  'dof',
  'bloomPrefilter',
  'bloomDownsample',
  'bloomUpsample',
  'toneMap',
  'sharpen',
  'grain',
  'totalPost',
]);

function emptyGpuTimings() {
  return Object.fromEntries(
    POST_PROCESSING_GPU_TIMING_KEYS.map((key) => [key, null]),
  );
}

function finiteTiming(value) {
  const timing = Number(value);
  return Number.isFinite(timing) && timing >= 0 ? timing : null;
}

/**
 * GPU timings are deliberately resolved out of band. Three r185 exposes an
 * asynchronous aggregate render timestamp through WebGPURenderer, but does not
 * expose stable begin/end timestamp hooks around individual TSL RTT nodes.
 * Consequently `totalPost` fills when that query resolves while named pass
 * placeholders remain null. This is preferable to introducing a GPU-to-CPU
 * synchronization point in the frame loop.
 */
export class PostProcessingDiagnostics {
  constructor() {
    this.graphBuilds = 0;
    this.framesRendered = 0;
    this.lastTopologySignature = '';
    this.lastResetReason = null;
    this.gpuTimings = emptyGpuTimings();
    this.gpuTimingPending = false;
    this.gpuTimingSamples = 0;
    this.gpuTimingSource = 'unavailable';
    this.activeGpuPasses = [];
  }

  graphBuilt(signature) {
    this.graphBuilds += 1;
    this.lastTopologySignature = signature;
  }

  frameRendered() {
    this.framesRendered += 1;
  }

  historyReset(reason) {
    this.lastResetReason = reason;
  }

  requestGpuTimings(renderer, activePasses = []) {
    if (this.gpuTimingPending) return false;
    const resolve = renderer?.resolveTimestampsAsync;
    if (typeof resolve !== 'function') {
      this.gpuTimingSource = 'unavailable';
      return false;
    }

    this.gpuTimingPending = true;
    this.gpuTimingSource = 'three-webgpu-render-timestamp';
    this.activeGpuPasses = [...activePasses];
    Promise.resolve()
      .then(() => resolve.call(renderer, 'render'))
      .then((resolved) => {
        const total = finiteTiming(
          typeof resolved === 'object'
            ? resolved?.totalPost ?? resolved?.render ?? resolved?.total
            : resolved,
        );
        if (total !== null) {
          this.gpuTimings = {
            ...this.gpuTimings,
            totalPost: total,
          };
          this.gpuTimingSamples += 1;
        }
      })
      .catch(() => {
        // Timestamp support is optional (and may disappear after device loss).
        this.gpuTimingSource = 'unavailable';
      })
      .finally(() => {
        this.gpuTimingPending = false;
      });
    return true;
  }

  snapshot() {
    return Object.freeze({
      graphBuilds: this.graphBuilds,
      framesRendered: this.framesRendered,
      lastTopologySignature: this.lastTopologySignature,
      lastResetReason: this.lastResetReason,
      gpuTimings: Object.freeze({ ...this.gpuTimings }),
      gpuTimingPending: this.gpuTimingPending,
      gpuTimingSamples: this.gpuTimingSamples,
      gpuTimingSource: this.gpuTimingSource,
      activeGpuPasses: Object.freeze([...this.activeGpuPasses]),
    });
  }
}
