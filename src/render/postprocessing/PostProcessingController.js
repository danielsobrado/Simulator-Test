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
import { isPostProcessingEnabled } from './nodes/PostCommon.js';

export class PostProcessingController {
  constructor({
    renderer,
    scene,
    postProcessingStore,
    sunDirection,
    sunColor = '#ffffff',
    bypassProvider = null,
  }) {
    this.renderer = renderer;
    this.scene = scene;
    this.store = postProcessingStore;
    this.sunDirection = sunDirection;
    this.sunColor = sunColor;
    this.bypassProvider = bypassProvider;
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
        this.graph?.dispose();
        this.graph = null;
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
      this.graph?.dispose();
      this.graph = null;
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

    this.graph?.dispose();
    this.graph = new PostProcessingGraph({
      renderer: this.renderer,
      scene: this.scene,
      camera,
      settings: this.settings,
      history: this.history,
      topologySignature: this.topologySignature,
      sunDirection: this.sunDirection,
      sunColor: this.sunColor,
    });
    this.graph.resize(
      this.resources.width,
      this.resources.height,
      this.resources.pixelRatio,
    );
    this.diagnostics.graphBuilt(this.topologySignature);
    this.invalidation.invalidate(POST_PROCESSING_RESET_REASONS.POST_GRAPH_REBUILT);
    return this.graph;
  }

  updateFrame(camera) {
    this.invalidation.beginFrame();
    this.frameState.beginFrame(
      camera,
      this.resources,
      this.history,
      this.settings,
    );
    this.graph.updateUniforms(this.frameState, this.settings);
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
    return true;
  }

  async precompile(camera) {
    if (this.disposed) return false;
    this.syncRendererOutputOwnership();
    if (!isPostProcessingEnabled(this.settings) || this.isBypassed()) return false;
    this.ensureGraph(camera);
    this.updateFrame(camera);
    try {
      await this.graph.precompile();
    } finally {
      this.finishFrame(false);
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
    this.graph?.resize(width, height, pixelRatio);
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
    this.graph?.dispose();
    this.restoreRendererOutput();
    this.resources.dispose();
    this.history.dispose();
    this.graph = null;
    this.renderer = null;
    this.scene = null;
    this.store = null;
    this.sunDirection = null;
    this.bypassProvider = null;
  }
}
