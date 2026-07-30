import * as THREE from 'three/webgpu';
import { PostProcessingDiagnostics } from './PostProcessingDiagnostics.js';
import { PostProcessingFrameState } from './PostProcessingFrameState.js';
import { PostProcessingHistory } from './PostProcessingHistory.js';
import {
  POST_PROCESSING_RESET_REASONS,
  PostProcessingInvalidation,
} from './PostProcessingInvalidation.js';
import {
  PostProcessingGraph,
  createPostProcessingTopologySignature,
} from './PostProcessingGraph.js';
import { PostProcessingResources } from './PostProcessingResources.js';
import { createPostProcessingWarmupVariants } from './PostProcessingWarmup.js';
import { isPostProcessingEnabled } from './nodes/PostCommon.js';

export class PostProcessingController {
  constructor({
    renderer,
    scene,
    postProcessingStore,
    sunDirection,
    sunColor = '#ffffff',
    bypassProvider = null,
    focusDistanceProvider = null,
  }) {
    this.renderer = renderer;
    this.scene = scene;
    this.store = postProcessingStore;
    this.sunDirection = sunDirection;
    this.sunColor = sunColor;
    this.bypassProvider = bypassProvider;
    this.focusDistanceProvider = focusDistanceProvider;
    this.settings = postProcessingStore.get();
    this.topologySignature = createPostProcessingTopologySignature(this.settings);
    this.graph = null;
    this.disposed = false;
    this.rendererState = null;
    if (isPostProcessingEnabled(this.settings) && !this.isBypassed()) {
      this.takeRendererOutputOwnership();
    }

    this.resources = new PostProcessingResources(renderer);
    this.frameState = new PostProcessingFrameState();
    this.diagnostics = new PostProcessingDiagnostics();
    this.history = new PostProcessingHistory();
    this.invalidation = new PostProcessingInvalidation({
      history: this.history,
      diagnostics: this.diagnostics,
    });

    const canvas = renderer.domElement;
    this.resize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);
    this.invalidation.invalidate(POST_PROCESSING_RESET_REASONS.INITIAL_FRAME);
    this.unsubscribe = postProcessingStore.subscribe((settings) => {
      const renderScaleChanged = settings.renderScale !== this.settings.renderScale;
      this.settings = settings;
      this.topologySignature = createPostProcessingTopologySignature(settings);
      if (isPostProcessingEnabled(settings) && !this.isBypassed()) {
        this.takeRendererOutputOwnership();
      } else {
        this.graph = null;
        this.resources.deactivateGraph();
        this.restoreRendererOutput();
      }
      if (renderScaleChanged) {
        this.invalidation.invalidate(
          POST_PROCESSING_RESET_REASONS.RENDER_SCALE_CHANGED,
        );
      }
    });
  }

  isBypassed() {
    return this.bypassProvider?.() === true;
  }

  syncRendererOutputOwnership() {
    if (isPostProcessingEnabled(this.settings) && !this.isBypassed()) {
      this.takeRendererOutputOwnership();
    } else {
      this.graph = null;
      this.resources.deactivateGraph();
      this.restoreRendererOutput();
    }
  }

  takeRendererOutputOwnership() {
    if (this.rendererState || !this.renderer) return;
    this.rendererState = {
      toneMapping: this.renderer.toneMapping,
      toneMappingExposure: this.renderer.toneMappingExposure,
    };
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
  }

  restoreRendererOutput() {
    if (!this.rendererState || !this.renderer) return;
    this.renderer.toneMapping = this.rendererState.toneMapping;
    this.renderer.toneMappingExposure = this.rendererState.toneMappingExposure;
    this.rendererState = null;
  }

  ensureGraph(camera) {
    if (
      this.graph
      && this.graph.topologySignature === this.topologySignature
    ) {
      return this.graph;
    }

    let created = false;
    this.graph = this.resources.acquireGraph(this.topologySignature, () => {
      created = true;
      return this.createGraph(camera, this.settings, this.topologySignature);
    });
    this.resources.activateGraph(this.topologySignature);
    if (created) this.diagnostics.graphBuilt(this.topologySignature);
    this.invalidation.invalidate(POST_PROCESSING_RESET_REASONS.POST_GRAPH_REBUILT);
    return this.graph;
  }

  createGraph(camera, settings, topologySignature) {
    return new PostProcessingGraph({
      renderer: this.renderer,
      scene: this.scene,
      camera,
      settings,
      history: this.history,
      topologySignature,
      sunDirection: this.sunDirection,
      sunColor: this.sunColor,
    });
  }

  updateFrame(camera, graph = this.graph, settings = this.settings) {
    this.invalidation.beginFrame();
    const timestampMs = typeof performance !== 'undefined' ? performance.now() : 0;
    this.frameState.beginFrame(
      camera,
      this.resources,
      this.history,
      settings,
      timestampMs,
    );
    this.updateFocusDistance(camera, settings);
    graph.updateUniforms(this.frameState, settings);
  }

  updateFocusDistance(camera, settings = this.settings) {
    const dof = settings.depthOfField;
    if (!dof?.enabled) return;
    const current = this.frameState.focusDistance;
    const target = dof.focusMode === 'manual'
      ? dof.manualFocusMeters
      : this.focusDistanceProvider?.(dof.focusMode, camera, current);
    if (!Number.isFinite(target)) return;
    const alpha = 1 - Math.exp(-dof.focusSmoothing * this.frameState.deltaSeconds);
    this.frameState.focusDistance = current + (target - current) * alpha;
  }

  finishFrame(rendered) {
    // Projection restoration must happen before the unjittered matrices become
    // next frame's history.
    this.frameState.restoreCameraProjection();
    if (rendered && this.frameState.temporalEnabled) {
      this.history.latchTaaFrame(this.frameState.currentViewProjection);
    }
    if (rendered && this.graph?.ssr) {
      this.history.latchSsrFrame();
    }
  }

  render(camera) {
    if (this.disposed) return false;
    this.syncRendererOutputOwnership();
    if (!isPostProcessingEnabled(this.settings) || this.isBypassed()) return false;
    this.ensureGraph(camera);
    this.updateFrame(camera);
    let rendered = false;
    try {
      this.graph.render();
      rendered = true;
    } finally {
      this.finishFrame(rendered);
    }
    this.diagnostics.frameRendered();
    if (this.settings.diagnostics?.showGpuTimings) {
      this.diagnostics.requestGpuTimings(this.renderer, this.graph.gpuPasses);
    }
    return true;
  }

  async precompile(camera) {
    if (this.disposed) return false;
    if (this.isBypassed()) return false;
    const variants = createPostProcessingWarmupVariants(this.settings);
    await this.resources.withWarmupTarget(async () => {
      for (const { settings } of variants) {
        const signature = createPostProcessingTopologySignature(settings);
        let created = false;
        const graph = this.resources.acquireGraph(signature, () => {
          created = true;
          return this.createGraph(camera, settings, signature);
        });
        this.resources.resizeGraph(signature, 8, 8, 1);
        this.updateFrame(camera, graph, settings);
        try {
          await graph.precompile();
        } finally {
          this.finishFrame(false);
        }
        if (created) this.diagnostics.graphBuilt(signature);
      }
    });

    if (isPostProcessingEnabled(this.settings)) {
      this.ensureGraph(camera);
    } else {
      this.graph = null;
      this.resources.deactivateGraph();
    }
    return true;
  }

  warmup(camera) {
    if (this.disposed) return false;
    this.syncRendererOutputOwnership();
    if (!isPostProcessingEnabled(this.settings) || this.isBypassed()) return false;
    this.ensureGraph(camera);
    this.updateFrame(camera);
    let rendered = false;
    try {
      this.graph.warmup();
      rendered = true;
    } finally {
      this.finishFrame(rendered);
    }
    return true;
  }

  resize(width, height) {
    const pixelRatio = this.renderer.getPixelRatio();
    const changed = this.resources.width !== Math.max(1, width)
      || this.resources.height !== Math.max(1, height)
      || this.resources.pixelRatio !== pixelRatio;
    this.resources.resize(width, height, pixelRatio);
    if (changed) {
      this.invalidation.invalidate(POST_PROCESSING_RESET_REASONS.RESIZE);
    }
  }

  invalidate(reason) {
    this.invalidation.invalidate(reason);
  }

  notifyReactive(event, transitionFrames = 0) {
    return this.invalidation.notifyReactive(event, transitionFrames);
  }

  clearHistory() {
    this.invalidation.invalidate(POST_PROCESSING_RESET_REASONS.MANUAL_RESET);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.restoreRendererOutput();
    this.resources.dispose();
    this.history.dispose();
    this.graph = null;
    this.renderer = null;
    this.scene = null;
    this.store = null;
    this.sunDirection = null;
    this.bypassProvider = null;
    this.focusDistanceProvider = null;
  }
}
