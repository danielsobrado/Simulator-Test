function percentile(sorted, fraction) {
  if (sorted.length === 0) {
    return null;
  }
  if (sorted.length === 1) {
    return sorted[0];
  }
  const index = (sorted.length - 1) * fraction;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sorted[lower];
  }
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

export class FrameProfiler {
  constructor({ hitchMs = 1000 / 30, maxFrames = 20000 } = {}) {
    this.hitchMs = hitchMs;
    this.maxFrames = maxFrames;
    this.frames = [];
    this.recording = false;
    this.frameIndex = 0;
    this.droppedFrameCount = 0;
    this.lastTimestamp = null;
    this.phaseStartedAt = 0;
    this.current = null;
  }

  start() {
    this.recording = true;
    this.frames.length = 0;
    this.frameIndex = 0;
    this.droppedFrameCount = 0;
    this.lastTimestamp = null;
    this.current = null;
  }

  stop() {
    this.recording = false;
    this.current = null;
  }

  beginFrame(timestamp) {
    if (!this.recording) {
      return false;
    }

    const dt = this.lastTimestamp === null ? 0 : timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    this.phaseStartedAt = performance.now();
    this.current = {
      index: this.frameIndex,
      timestamp,
      dt,
      phases: Object.create(null),
      hitch: dt > this.hitchMs,
      counters: null,
      countersDelta: null,
      streaming: null,
      voxel: null,
      player: null,
      originSnap: false,
      forcePredictiveRefresh: false,
    };
    this.frameIndex += 1;
    return true;
  }

  mark(phase) {
    if (!this.current) {
      return;
    }
    const now = performance.now();
    this.current.phases[phase] = now - this.phaseStartedAt;
    this.phaseStartedAt = now;
  }

  endFrame({
    counters = null,
    countersDelta = null,
    streaming = null,
    voxel = null,
    player = null,
    originSnap = false,
    forcePredictiveRefresh = false,
  } = {}) {
    if (!this.current) {
      return null;
    }

    this.current.counters = counters;
    this.current.countersDelta = countersDelta;
    this.current.streaming = streaming;
    this.current.voxel = voxel;
    this.current.player = player;
    this.current.originSnap = Boolean(originSnap);
    this.current.forcePredictiveRefresh = Boolean(forcePredictiveRefresh);

    if (this.frames.length >= this.maxFrames) {
      this.frames.shift();
      this.droppedFrameCount += 1;
    }
    this.frames.push(this.current);
    const frame = this.current;
    this.current = null;
    return frame;
  }

  getFrames() {
    return this.frames.slice();
  }

  summarize() {
    const measured = this.frames.filter((frame) => frame.dt > 0);
    const dts = measured.map((frame) => frame.dt).sort((a, b) => a - b);
    const hitches = measured.filter((frame) => frame.hitch);
    const durationMs = measured.length === 0
      ? 0
      : measured.at(-1).timestamp - measured[0].timestamp;
    const phaseNames = new Set();
    for (const frame of measured) {
      for (const name of Object.keys(frame.phases)) {
        phaseNames.add(name);
      }
    }
    const phases = {};
    for (const name of phaseNames) {
      const values = measured
        .map((frame) => frame.phases[name] ?? 0)
        .sort((a, b) => a - b);
      phases[name] = {
        totalMs: values.reduce((sum, value) => sum + value, 0),
        avgMs: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
        p95Ms: percentile(values, 0.95),
        maxMs: values.at(-1) ?? 0,
      };
    }

    return {
      frameCount: measured.length,
      retainedFrameCount: this.frames.length,
      droppedFrameCount: this.droppedFrameCount,
      frameBufferComplete: this.droppedFrameCount === 0,
      durationMs,
      avgFps: durationMs > 0 ? (measured.length * 1000) / durationMs : null,
      dt: {
        minMs: dts[0] ?? null,
        p50Ms: percentile(dts, 0.5),
        p95Ms: percentile(dts, 0.95),
        p99Ms: percentile(dts, 0.99),
        maxMs: dts.at(-1) ?? null,
        meanMs: dts.length
          ? dts.reduce((sum, value) => sum + value, 0) / dts.length
          : null,
      },
      hitchMs: this.hitchMs,
      hitchCount: hitches.length,
      hitchRate: measured.length ? hitches.length / measured.length : 0,
      phases,
      originSnapCount: measured.filter((frame) => frame.originSnap).length,
    };
  }
}

export { percentile as percentileSorted };
