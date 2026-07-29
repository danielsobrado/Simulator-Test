const counts = Object.create(null);

export const PERF_COUNTER_WATER_GENERATION_MS = 'waterGenerationMs';
export const PERF_COUNTER_WATER_UPLOAD_BYTES = 'waterUploadBytes';
export const PERF_COUNTER_WATER_PROJECTED_CAUSTIC_FRAMES = 'waterProjectedCausticFrames';
export const PERF_COUNTER_WATER_PROJECTED_CAUSTIC_CPU_MS = 'waterProjectedCausticCpuMs';
// Per-frame tallies of resident water chunks, counted before frustum culling.
// `wet` chunks are offered to the renderer and `dry` ones are withheld; of the
// wet ones only those inside the frustum are actually submitted. Read `wet`
// first when the frame rate collapses in a world that looks dry — a single
// submitted water chunk makes the renderer copy the viewport colour and depth
// buffers for the whole frame.
export const PERF_COUNTER_WATER_CHUNKS_WET = 'waterChunksWet';
export const PERF_COUNTER_WATER_CHUNKS_DRY = 'waterChunksDry';
// Wet chunks near enough to use the refracting material variant. While this
// stays 0 the frame pays no viewport copies at all, so it is the number to
// watch when the frame rate drops on approaching a shoreline.
export const PERF_COUNTER_WATER_CHUNKS_REFRACTIVE = 'waterChunksRefractive';

export const PerfCounters = {
  inc(name, amount = 1) {
    counts[name] = (counts[name] ?? 0) + amount;
  },

  set(name, value) {
    if (!Number.isFinite(value)) {
      throw new Error(`Performance counter ${name} must be finite.`);
    }
    counts[name] = value;
  },

  get(name) {
    return counts[name] ?? 0;
  },

  snapshot() {
    return { ...counts };
  },

  reset() {
    for (const key of Object.keys(counts)) {
      delete counts[key];
    }
  },

  delta(previous, next = counts) {
    const result = {};
    const keys = new Set([...Object.keys(previous ?? {}), ...Object.keys(next)]);
    for (const key of keys) {
      const value = (next[key] ?? 0) - (previous?.[key] ?? 0);
      if (value !== 0) {
        result[key] = value;
      }
    }
    return result;
  },
};

export function resetWaterChunkGauges() {
  PerfCounters.set(PERF_COUNTER_WATER_CHUNKS_WET, 0);
  PerfCounters.set(PERF_COUNTER_WATER_CHUNKS_DRY, 0);
  PerfCounters.set(PERF_COUNTER_WATER_CHUNKS_REFRACTIVE, 0);
}
