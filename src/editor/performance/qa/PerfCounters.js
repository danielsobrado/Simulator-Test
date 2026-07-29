const counts = Object.create(null);

export const PERF_COUNTER_WATER_GENERATION_MS = 'waterGenerationMs';
export const PERF_COUNTER_WATER_UPLOAD_BYTES = 'waterUploadBytes';
export const PERF_COUNTER_WATER_PROJECTED_CAUSTIC_FRAMES = 'waterProjectedCausticFrames';
export const PERF_COUNTER_WATER_PROJECTED_CAUSTIC_CPU_MS = 'waterProjectedCausticCpuMs';
// Per-frame tallies of resident water chunks. `drawn` is the one that matters:
// a single drawn chunk makes the renderer copy the viewport colour and depth
// buffers for the whole frame, so this is the counter to read when the frame
// rate collapses in a world that looks dry.
export const PERF_COUNTER_WATER_CHUNKS_DRAWN = 'waterChunksDrawn';
export const PERF_COUNTER_WATER_CHUNKS_DRY = 'waterChunksDry';

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
