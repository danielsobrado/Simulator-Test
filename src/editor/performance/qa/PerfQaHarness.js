import { FrameProfiler } from './FrameProfiler.js';
import { PerfCounters } from './PerfCounters.js';
import { buildPerfReport, downloadPerfReport } from './buildPerfReport.js';
import { createMovementPlan, parseQaParams } from './parseQaParams.js';

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function formatMs(value) {
  if (!Number.isFinite(value)) {
    return '—';
  }
  return `${value.toFixed(1)}ms`;
}

export class PerfQaHarness {
  constructor({
    config,
    viewModeController,
    playerController,
    terrainView,
    objectView = null,
    stylizedSurface = null,
    voxelPrototype = null,
    editorConfig = null,
  }) {
    this.config = config;
    this.plan = createMovementPlan(config);
    this.viewModeController = viewModeController;
    this.playerController = playerController;
    this.terrainView = terrainView;
    this.objectView = objectView;
    this.stylizedSurface = stylizedSurface;
    this.voxelPrototype = voxelPrototype;
    this.editorConfig = editorConfig;
    this.profiler = new FrameProfiler({ hitchMs: config.hitchMs });
    this.status = 'idle';
    this.phaseIndex = -1;
    this.phaseStartedAt = 0;
    this.lastCounters = PerfCounters.snapshot();
    this.report = null;
    this.live = {
      phase: null,
      elapsedSeconds: 0,
      avgFps: null,
      lastDtMs: null,
      hitchCount: 0,
    };
    this.overlay = null;
    this.boundDownload = () => this.download();
    this.boundRestart = () => this.start();
  }

  static fromLocation(deps, search = window.location.search) {
    const config = parseQaParams(search);
    if (!config) {
      return null;
    }
    return new PerfQaHarness({ ...deps, config });
  }

  mount(root = document.querySelector('#app')) {
    if (!root || this.overlay) {
      return;
    }
    this.overlay = document.createElement('aside');
    this.overlay.className = 'perf-qa-overlay';
    this.overlay.innerHTML = `
      <header>
        <strong>Perf QA</strong>
        <span data-role="status">idle</span>
      </header>
      <dl>
        <div><dt>Scenario</dt><dd data-role="scenario"></dd></div>
        <div><dt>Phase</dt><dd data-role="phase">—</dd></div>
        <div><dt>Elapsed</dt><dd data-role="elapsed">0.0s</dd></div>
        <div><dt>Frame dt</dt><dd data-role="dt">—</dd></div>
        <div><dt>Avg FPS</dt><dd data-role="fps">—</dd></div>
        <div><dt>Hitches</dt><dd data-role="hitches">0</dd></div>
        <div><dt>Pose</dt><dd data-role="pose">—</dd></div>
      </dl>
      <pre data-role="log"></pre>
      <div class="perf-qa-actions">
        <button type="button" data-role="download" disabled>Download JSON</button>
        <button type="button" data-role="restart">Restart</button>
      </div>
    `;
    root.append(this.overlay);
    this.overlay.querySelector('[data-role="download"]').addEventListener('click', this.boundDownload);
    this.overlay.querySelector('[data-role="restart"]').addEventListener('click', this.boundRestart);
    this.overlay.querySelector('[data-role="scenario"]').textContent =
      `${this.config.scenarioId} · ${this.config.speed}`;
    this.renderOverlay();
  }

  start() {
    PerfCounters.reset();
    this.objectView?.updatePerformanceCounters();
    if (this.config.scenarioId === 'object-town') {
      PerfCounters.set('objectQaTarget', this.config.buildingCount);
      PerfCounters.set('objectQaPlaced', this.objectView?.objectMap?.size ?? 0);
    }
    this.profiler = new FrameProfiler({ hitchMs: this.config.hitchMs });
    this.report = null;
    this.status = 'running';
    this.phaseIndex = 0;
    this.phaseStartedAt = performance.now();
    this.lastCounters = PerfCounters.snapshot();
    this.live = {
      phase: this.plan.phases[0]?.label ?? null,
      elapsedSeconds: 0,
      avgFps: null,
      lastDtMs: null,
      hitchCount: 0,
    };

    this.playerController.setHarnessActive(true);
    this.viewModeController.enterWalkMode(this.config.spawn, {
      requestPointerLock: false,
    });
    this.playerController.setPose({
      x: this.config.spawn.x,
      z: this.config.spawn.z,
      yaw: degreesToRadians(this.config.yawDegrees),
      pitch: degreesToRadians(this.config.pitchDegrees),
    });
    this.applyPhaseKeys();
    this.log(`Started ${this.config.scenarioId} at (${this.config.spawn.x}, ${this.config.spawn.z})`);
    this.renderOverlay();
  }

  get recording() {
    return this.status === 'running'
      && this.phaseIndex >= 0
      && Boolean(this.plan.phases[this.phaseIndex]?.record);
  }

  beginFrame(timestamp) {
    this.advancePhases(timestamp);
    if (!this.recording) {
      return false;
    }
    return this.profiler.beginFrame(timestamp);
  }

  mark(phase) {
    this.profiler.mark(phase);
  }

  endFrame({
    streaming = null,
    voxel = null,
    originSnap = false,
    forcePredictiveRefresh = false,
  } = {}) {
    if (!this.recording) {
      this.renderOverlayThrottled();
      return null;
    }

    const counters = PerfCounters.snapshot();
    const countersDelta = PerfCounters.delta(this.lastCounters, counters);
    this.lastCounters = counters;
    const playerStatus = this.playerController.getStatus();
    const frame = this.profiler.endFrame({
      counters,
      countersDelta,
      streaming,
      voxel,
      player: {
        x: playerStatus.position.x,
        y: playerStatus.position.y,
        z: playerStatus.position.z,
        grounded: playerStatus.grounded,
        running: playerStatus.running,
      },
      originSnap,
      forcePredictiveRefresh,
    });

    if (frame) {
      this.live.lastDtMs = frame.dt;
      if (frame.hitch) {
        this.live.hitchCount += 1;
        const topPhase = Object.entries(frame.phases)
          .sort((left, right) => right[1] - left[1])[0];
        this.log(
          `Hitch ${frame.dt.toFixed(1)}ms`
          + (topPhase ? ` · ${topPhase[0]} ${topPhase[1].toFixed(1)}ms` : '')
          + (Object.keys(countersDelta).length
            ? ` · Δ ${JSON.stringify(countersDelta)}`
            : ''),
        );
      }
      const summary = this.profiler.summarize();
      this.live.avgFps = summary.avgFps;
    }

    this.renderOverlayThrottled();
    return frame;
  }

  advancePhases(timestamp) {
    if (this.status !== 'running' || this.phaseIndex < 0) {
      return;
    }

    const phase = this.plan.phases[this.phaseIndex];
    if (!phase) {
      this.finish();
      return;
    }

    const elapsedSeconds = (timestamp - this.phaseStartedAt) / 1000;
    this.live.elapsedSeconds = elapsedSeconds;
    this.live.phase = phase.label;

    if (elapsedSeconds < phase.durationSeconds) {
      return;
    }

    this.phaseIndex += 1;
    if (this.phaseIndex >= this.plan.phases.length) {
      this.finish();
      return;
    }

    this.phaseStartedAt = timestamp;
    if (this.plan.phases[this.phaseIndex].record) {
      this.profiler.start();
      this.lastCounters = PerfCounters.snapshot();
      this.live.hitchCount = 0;
      this.log(`Measuring for ${this.config.durationSeconds}s…`);
    }
    this.applyPhaseKeys();
  }

  applyPhaseKeys() {
    const phase = this.plan.phases[this.phaseIndex];
    this.playerController.setHarnessKeys(phase?.keys ?? []);
  }

  finish() {
    if (this.status === 'done') {
      return;
    }
    this.status = 'done';
    this.playerController.setHarnessKeys([]);
    this.playerController.setHarnessActive(false);
    this.profiler.stop();
    this.report = buildPerfReport({
      config: this.config,
      profiler: this.profiler,
      meta: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        href: typeof location !== 'undefined' ? location.href : null,
        visibilityState: typeof document !== 'undefined' ? document.visibilityState : null,
      },
      playerConfig: this.editorConfig?.player ?? null,
      worldConfig: this.editorConfig
        ? {
          seed: this.editorConfig.world?.seed,
          chunkSize: this.editorConfig.world?.chunkSize,
          loadRadius: this.editorConfig.world?.loadRadius,
          floatingOriginThreshold: this.editorConfig.world?.floatingOriginThreshold,
          stylizedSurface: this.editorConfig.stylizedSurface ?? null,
        }
        : null,
    });
    if (typeof window !== 'undefined') {
      window.__perfQaReport = this.report;
      try {
        localStorage.setItem('perfQaReport', JSON.stringify(this.report));
      } catch {
        // Report can exceed quota; in-memory + download still work.
      }
    }
    this.log(
      `Done · avg ${this.report.summary.avgFps?.toFixed?.(1) ?? '—'} fps`
      + ` · p99 ${formatMs(this.report.summary.dt.p99Ms)}`
      + ` · hitches ${this.report.summary.hitchCount}`,
    );
    if (this.config.download) {
      downloadPerfReport(this.report);
    }
    this.publishApi();
    this.renderOverlay();
  }

  download() {
    if (!this.report) {
      return null;
    }
    return downloadPerfReport(this.report);
  }

  getReport() {
    return this.report;
  }

  publishApi() {
    if (typeof window === 'undefined') {
      return;
    }
    window.__perfQa = {
      status: this.status,
      config: this.config,
      live: this.live,
      getReport: () => this.report,
      download: () => this.download(),
      restart: () => this.start(),
      counters: () => PerfCounters.snapshot(),
    };
  }

  log(message) {
    if (!this.overlay) {
      return;
    }
    const log = this.overlay.querySelector('[data-role="log"]');
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    log.textContent = `${line}\n${log.textContent}`.trim().slice(0, 2500);
  }

  renderOverlayThrottled() {
    const now = performance.now();
    if (this._nextOverlayAt && now < this._nextOverlayAt) {
      return;
    }
    this._nextOverlayAt = now + 200;
    this.renderOverlay();
  }

  renderOverlay() {
    if (!this.overlay) {
      return;
    }
    const player = this.playerController.getStatus().position;
    this.overlay.dataset.status = this.status;
    this.overlay.querySelector('[data-role="status"]').textContent = this.status;
    this.overlay.querySelector('[data-role="phase"]').textContent = this.live.phase ?? '—';
    this.overlay.querySelector('[data-role="elapsed"]').textContent =
      `${this.live.elapsedSeconds.toFixed(1)}s`;
    this.overlay.querySelector('[data-role="dt"]').textContent = formatMs(this.live.lastDtMs);
    this.overlay.querySelector('[data-role="fps"]').textContent =
      Number.isFinite(this.live.avgFps) ? this.live.avgFps.toFixed(1) : '—';
    this.overlay.querySelector('[data-role="hitches"]').textContent = String(this.live.hitchCount);
    this.overlay.querySelector('[data-role="pose"]').textContent =
      `${player.x.toFixed(1)}, ${player.z.toFixed(1)}`;
    this.overlay.querySelector('[data-role="download"]').disabled = !this.report;
  }

  dispose() {
    this.playerController.setHarnessActive(false);
    this.playerController.setHarnessKeys([]);
    this.profiler.stop();
    if (this.overlay) {
      this.overlay.querySelector('[data-role="download"]')
        ?.removeEventListener('click', this.boundDownload);
      this.overlay.querySelector('[data-role="restart"]')
        ?.removeEventListener('click', this.boundRestart);
      this.overlay.remove();
      this.overlay = null;
    }
    if (typeof window !== 'undefined' && window.__perfQa) {
      delete window.__perfQa;
    }
  }
}
