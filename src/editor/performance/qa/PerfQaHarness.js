import { FrameProfiler } from './FrameProfiler.js';
import { PerfCounters } from './PerfCounters.js';
import { GpuPassProfiler } from './GpuPassProfiler.js';
import { PerfQaSettleGate } from './PerfQaSettleGate.js';
import { QaRouteWalker } from './QaRouteWalker.js';
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

function collisionStatus(playerController, { lightweight = false } = {}) {
  const runtime = playerController.collisionRuntime;
  if (!runtime) return null;
  if (lightweight && typeof runtime.getLiveStatus === 'function') {
    return runtime.getLiveStatus();
  }
  return runtime.getStatus?.() ?? null;
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
    this.configuredSpawn = config.spawn;
    this.canonicalSpawn = terrainView?.floatingOrigin?.toCanonical?.(config.spawn.x, config.spawn.z)
      ?? { ...config.spawn };
    this.objectView = objectView;
    this.stylizedSurface = stylizedSurface;
    this.voxelPrototype = voxelPrototype;
    this.editorConfig = editorConfig;
    this.profiler = new FrameProfiler({ hitchMs: config.hitchMs });
    this.gpuProfiler = new GpuPassProfiler(terrainView?.renderer, { requested: config.gpuTimings });
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
      collisionReady: null,
      collisionFailure: null,
    };
    this.samplingMisses = [];
    const world = this.terrainView?.worldStore;
    if (world) {
      this.previousSamplingMissObserver = world.onProceduralSamplingMiss;
      this.samplingMissObserver = sample => {
        this.previousSamplingMissObserver?.(sample);
        if (this.recording && this.samplingMisses.length < 8) {
          this.samplingMisses.push({ ...sample, stack: new Error().stack });
        }
      };
      world.onProceduralSamplingMiss = this.samplingMissObserver;
    }
    this.overlay = null;
    this.phaseFrameCount = 0;
    this.boundDownload = () => this.download();
    this.boundRestart = () => this.start();
  }

  static fromLocation(deps, search = window.location.search) {
    let config = parseQaParams(search);
    if (!config) {
      return null;
    }
    // Routes on the frozen Azgaar import: their spawn is only known once it is loaded.
    if (config.scenarioId === 'settlement-approach' || config.scenarioId === 'bog-cross') {
      if (!deps.terrainView.settlementQaRoute) throw new Error(`${config.scenarioId} QA route was not prepared.`);
      config = Object.freeze({ ...config, ...deps.terrainView.settlementQaRoute });
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
        <div><dt>Collision</dt><dd data-role="collision">—</dd></div>
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
    if (this.config.spawn !== this.configuredSpawn) {
      this.configuredSpawn = this.config.spawn;
      this.canonicalSpawn = this.terrainView?.floatingOrigin?.toCanonical?.(this.config.spawn.x, this.config.spawn.z)
        ?? { ...this.config.spawn };
    }
    const origin = this.terrainView?.floatingOrigin?.getState?.() ?? { x: 0, z: 0 };
    const spawn = { x: this.canonicalSpawn.x - origin.x, z: this.canonicalSpawn.z - origin.z };
    this.gpuProfiler.reset();
    PerfCounters.reset();
    this.objectView?.updatePerformanceCounters();
    if (this.config.scenarioId === 'object-town') {
      PerfCounters.set('objectQaTarget', this.config.buildingCount);
      PerfCounters.set('objectQaPlaced', this.objectView?.objectMap?.size ?? 0);
    }
    this.profiler = new FrameProfiler({ hitchMs: this.config.hitchMs });
    this.report = null;
    this.settleGate = new PerfQaSettleGate({ timeoutSeconds: this.config.settleTimeoutSeconds });
    this.settleResult = null;
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
      collisionReady: null,
      collisionFailure: null,
    };
    this.phaseFrameCount = 0;

    this.playerController.setHarnessActive(true);
    this.playerController.speedMode?.setActive(this.config.explorationBoost);
    this.viewModeController.enterWalkMode(spawn, {
      requestPointerLock: false,
    });
    this.playerController.setPose({
      x: spawn.x,
      z: spawn.z,
      yaw: degreesToRadians(this.config.yawDegrees),
      pitch: degreesToRadians(this.config.pitchDegrees),
    });
    this.routeFrozen = false;
    this.routeWalker = this.config.route ? new QaRouteWalker(this.config.route) : null;
    this.enterPhase(this.plan.phases[0]);
    this.nextTerrainEditAt = 0;
    if (this.config.scenarioId === 'edited-world') {
      const world = this.terrainView.worldStore;
      // Authored patches along the deterministic route, plus an unrelated edit.
      for (let offset = 0; offset <= 96; offset += 16) {
        world.paintSquare(offset, offset, 5, 9);
        world.setHeight(offset + 2, offset + 2, world.getHeight(offset + 2, offset + 2) + 0.5);
      }
      world.setTile(8192, -8192, 9);
    }
    this.log(`Started ${this.config.scenarioId} at canonical (${this.canonicalSpawn.x}, ${this.canonicalSpawn.z})`);
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
    const recording = this.profiler.beginFrame(timestamp);
    this.gpuProfiler.beginFrame(timestamp);
    if (this.config.scenarioId === 'edited-world' && timestamp >= this.nextTerrainEditAt) {
      this.nextTerrainEditAt = timestamp + 3000;
      const world = this.terrainView.worldStore;
      const position = this.playerController.getStatus().position;
      const canonical = this.terrainView.floatingOrigin.toCanonical(position.x, position.z);
      const x = Math.floor(canonical.x / world.tileSize) + 3;
      const z = Math.floor(-canonical.z / world.tileSize) + 3;
      world.paintSquare(x, z, 5, 9);
      world.setHeight(x, z, world.getHeight(x, z) + 0.25);
      PerfCounters.inc('qaTerrainEdits');
      this.profiler.mark('terrainEdits');
    }
    return recording;
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
    this.gpuProfiler.endFrame();
    const collision = collisionStatus(this.playerController, { lightweight: true });
    this.live.collisionReady = collision?.ready ?? null;
    this.live.collisionFailure = collision?.failure?.message ?? null;
    if (!this.recording) {
      this.renderOverlayThrottled();
      return null;
    }

    const countersDelta = PerfCounters.advance(this.lastCounters);
    const playerStatus = this.playerController.getStatus();
    const frame = this.profiler.endFrame({
      countersDelta,
      streaming,
      voxel,
      player: {
        x: playerStatus.position.x,
        y: playerStatus.position.y,
        z: playerStatus.position.z,
        grounded: playerStatus.grounded,
        running: playerStatus.running,
        collisionReady: collision?.ready ?? null,
        collisionFailure: collision?.failure ?? null,
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
      this.live.avgFps = this.profiler.getLiveAverageFps();
    }

    this.renderOverlayThrottled();
    return frame;
  }

  steerRoute(timestamp) {
    const player = this.playerController;
    const { position, yaw } = player.getStatus();
    const origin = this.terrainView.floatingOrigin.getState();
    const step = this.routeWalker.update(position.x + origin.x, position.z + origin.z, yaw, timestamp / 1000);
    if (step.hop) {
      player.setPose({ x: step.hop.x - origin.x, z: step.hop.z - origin.z, yaw: step.yaw, pitch: player.getStatus().pitch });
      this.log(`Route: hopped past an obstacle (${this.routeWalker.hops})`);
      return;
    }
    player.yaw = step.yaw;
    player.applyCameraState();
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

    if (Number.isFinite(phase.yawDeltaDegreesPerFrame) && phase.yawDeltaDegreesPerFrame !== 0) {
      const status = this.playerController.getStatus();
      this.playerController.setPose({
        x: status.position.x,
        z: status.position.z,
        yaw: status.yaw + degreesToRadians(phase.yawDeltaDegreesPerFrame),
        pitch: status.pitch,
      });
    }

    if (phase.record && this.routeWalker && !this.routeFrozen) this.steerRoute(timestamp);

    const useFrames = Number.isFinite(phase.durationFrames);
    if (useFrames) {
      this.phaseFrameCount += 1;
      this.live.elapsedSeconds = this.phaseFrameCount / 60;
      this.live.phase = phase.label;
      if (this.phaseFrameCount < phase.durationFrames) {
        return;
      }
    } else {
      const elapsedSeconds = (timestamp - this.phaseStartedAt) / 1000;
      this.live.elapsedSeconds = elapsedSeconds;
      this.live.phase = phase.label;
      if (elapsedSeconds < phase.durationSeconds) {
        return;
      }
      if (phase.settle && !this.settlePhase(elapsedSeconds - phase.durationSeconds)) {
        return;
      }
    }

    this.phaseIndex += 1;
    if (this.phaseIndex >= this.plan.phases.length) {
      this.finish();
      return;
    }

    this.phaseStartedAt = timestamp;
    this.phaseFrameCount = 0;
    const next = this.plan.phases[this.phaseIndex];
    if (next.record && !this.profiler.recording) {
      this.profiler.start();
      this.lastCounters = PerfCounters.snapshot();
      this.preparationAtMeasureStart = this.terrainView.stylizedSurface?.getPreparationStatus?.() ?? null;
      this.samplingMisses.length = 0;
      this.live.hitchCount = 0;
      const budget = Number.isFinite(next.durationFrames)
        ? `${next.durationFrames} frames`
        : `${this.config.durationSeconds}s`;
      this.log(`Measuring for ${budget}…`);
    }
    this.enterPhase(next);
  }

  /** Readiness checks the settle gate waits on; a missing system counts as ready. */
  settleReadiness() {
    const collision = collisionStatus(this.playerController, { lightweight: true });
    const streaming = this.terrainView?.getStreamingStatus?.() ?? null;
    return {
      collision: collision ? Boolean(collision.ready) : true,
      streaming: streaming ? streaming.loading === 0 : true,
      construction: !(PerfCounters.get('constructionQueueDepth') > 0),
      vegetation: this.terrainView?.stylizedSurface?.getPreparationStatus?.().ready ?? true,
    };
  }

  /** @returns {boolean} whether the warmup may end now */
  settlePhase(waitedSeconds) {
    const verdict = this.settleGate.update(this.settleReadiness(), waitedSeconds);
    if (verdict === 'waiting') {
      this.live.phase = `Warmup (settling: ${this.settleGate.blockers.join(', ') || 'holding'})`;
      return false;
    }
    this.settleResult = Object.freeze({
      settled: verdict === 'settled',
      waitedSeconds: Math.round(waitedSeconds * 10) / 10,
      blockers: verdict === 'settled' ? [] : [...this.settleGate.blockers],
    });
    this.log(verdict === 'settled'
      ? `Settled after ${this.settleResult.waitedSeconds}s more warmup`
      : `Settle timed out waiting for ${this.settleResult.blockers.join(', ')}`);
    return true;
  }

  enterPhase(phase) {
    if (!phase) {
      this.applyPhaseKeys();
      return;
    }
    if (phase.teleport) {
      const status = this.playerController.getStatus();
      this.playerController.setPose({
        x: phase.teleport.x,
        z: phase.teleport.z,
        yaw: degreesToRadians(
          Number.isFinite(phase.yawDegrees) ? phase.yawDegrees : this.config.yawDegrees,
        ),
        pitch: Number.isFinite(status.pitch)
          ? status.pitch
          : degreesToRadians(this.config.pitchDegrees),
      });
      this.log(`Teleported to (${phase.teleport.x}, ${phase.teleport.z})`);
    }
    this.applyPhaseKeys();
  }

  applyPhaseKeys() {
    const phase = this.plan.phases[this.phaseIndex];
    this.playerController.setHarnessKeys(phase?.keys ?? []);
  }

  setKeys(codes = []) {
    if (this.status !== 'running') return false;
    this.playerController.setHarnessKeys(codes);
    return true;
  }

  finish() {
    if (this.status === 'done') {
      return;
    }
    this.status = 'done';
    this.playerController.setHarnessKeys([]);
    this.playerController.setHarnessActive(false);
    this.profiler.stop();
    const collision = collisionStatus(this.playerController);
    this.report = buildPerfReport({
      config: this.config,
      profiler: this.profiler,
      meta: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        href: typeof location !== 'undefined' ? location.href : null,
        visibilityState: typeof document !== 'undefined' ? document.visibilityState : null,
      },
      playerConfig: this.playerController.speedMode?.config ?? this.editorConfig?.player ?? null,
      worldConfig: this.editorConfig
        ? {
          seed: this.editorConfig.world?.seed,
          chunkSize: this.editorConfig.world?.chunkSize,
          loadRadius: this.editorConfig.world?.loadRadius,
          floatingOriginThreshold: this.editorConfig.world?.floatingOriginThreshold,
          stylizedSurface: this.editorConfig.stylizedSurface ?? null,
          exploration: this.editorConfig.exploration ?? null,
        }
        : null,
      collisionConfig: this.editorConfig?.collision ?? null,
      collisionStatus: collision,
      postProcessingCapture: this.buildPostProcessingCaptureSnapshot(),
      settle: this.settleResult,
      preparation: {
        start: this.preparationAtMeasureStart,
        end: this.terrainView.stylizedSurface?.getPreparationStatus?.() ?? null,
        workerCount: this.terrainView.worldStore.chunkWorker?.workerCount ?? 0,
        cacheLimit: this.terrainView.preparedPlacement?.limit ?? null,
      },
    });
    this.report.samplingMisses = [...this.samplingMisses];
    this.report.gpuRender = this.gpuProfiler.report();
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
      + ` · collision p95 ${formatMs(this.report.collision.timingsMs.total.p95Ms)}`
      + ` · gate ${this.report.collision.gate.passed ? 'pass' : 'fail'}`
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

  buildPostProcessingCaptureSnapshot() {
    const counters = PerfCounters.snapshot();
    const player = this.playerController.getStatus();
    const streaming = this.terrainView.getStreamingStatus?.() ?? null;
    const origin = this.terrainView.floatingOrigin?.getState?.()
      ?? streaming?.origin
      ?? null;
    const vegetationInstances = (
      (counters.treeNearInstances ?? 0)
      + (counters.treeProxyInstances ?? 0)
      + (counters.treeImpostorInstances ?? 0)
      + (counters.bushNearInstances ?? 0)
      + (counters.bushProxyInstances ?? 0)
      + (counters.grassLastChunkEffectiveBlades ?? 0)
    );
    return {
      captureId: this.config.captureId ?? null,
      qualityPreset: this.editorConfig?.stylizedSurface?.postProcessing?.preset ?? 'none',
      cameraPose: {
        x: player.position?.x ?? null,
        y: player.position?.y ?? null,
        z: player.position?.z ?? null,
        yaw: player.yaw ?? null,
        pitch: player.pitch ?? null,
      },
      floatingOriginOffset: origin
        ? { x: origin.x ?? origin.originX ?? 0, z: origin.z ?? origin.originZ ?? 0 }
        : null,
      drawCalls: counters.rendererDrawCalls ?? null,
      triangles: counters.rendererTriangles ?? null,
      residentTerrainChunks: streaming?.resident ?? null,
      visibleVegetationInstances: vegetationInstances,
      visibleConstructionInstances: counters.constructionModulesResident ?? null,
      activeParticles: (
        (counters.rendererPoints ?? 0)
        + (counters.waterProjectedCausticFrames ?? 0)
      ),
      warmupFrames: this.config.warmupFrames ?? null,
      measureFrames: this.config.measureFrames ?? null,
    };
  }

  publishApi() {
    if (typeof window === 'undefined') {
      return;
    }
    const harness = this;
    window.__perfQa = {
      status: this.status,
      get recording() { return harness.recording; },
      setKeys: (codes) => this.setKeys(codes),
      freezeRoute: () => { this.routeFrozen = true; },
      config: this.config,
      live: this.live,
      getReport: () => this.report,
      download: () => this.download(),
      restart: () => this.start(),
      counters: () => PerfCounters.snapshot(),
      collision: () => collisionStatus(this.playerController),
      captureSnapshot: () => this.buildPostProcessingCaptureSnapshot(),
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
    this.overlay.querySelector('[data-role="collision"]').textContent = this.live.collisionFailure
      ? `failed · ${this.live.collisionFailure}`
      : this.live.collisionReady === null
        ? 'inactive'
        : this.live.collisionReady
          ? 'ready'
          : 'loading';
    this.overlay.querySelector('[data-role="pose"]').textContent =
      `${player.x.toFixed(1)}, ${player.z.toFixed(1)}`;
    this.overlay.querySelector('[data-role="download"]').disabled = !this.report;
  }

  dispose() {
    this.gpuProfiler.dispose();
    const world = this.terrainView?.worldStore;
    if (world?.onProceduralSamplingMiss === this.samplingMissObserver) {
      world.onProceduralSamplingMiss = this.previousSamplingMissObserver;
    }
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
