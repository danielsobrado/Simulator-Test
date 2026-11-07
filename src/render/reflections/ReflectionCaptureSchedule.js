/** One stride clock; separate CPU estimates for a cube face and a planar draw. */
export class ReflectionCaptureSchedule {
  constructor(config) {
    this.stride = config.captureFrameStride ?? 4;
    this.safetyFactor = config.captureSafetyFactor ?? 1.25;
    this.initialCpuMs = config.initialCaptureCpuMs ?? 2;
    this.frame = 0;
    this.estimates = { cube: null, planar: null };
  }

  nextFrame() { return this.frame++ % this.stride === 0; }

  budgetMs(kind) { return Math.max(0.25, this.estimates[kind] ?? this.initialCpuMs) * this.safetyFactor; }

  record(kind, cpuMs) {
    if (!Number.isFinite(cpuMs) || cpuMs < 0) return;
    const previous = this.estimates[kind];
    // React to an expensive capture immediately; relax gradually as it gets cheaper.
    this.estimates[kind] = previous === null ? cpuMs : Math.max(cpuMs, previous * 0.75 + cpuMs * 0.25);
  }
}
