import { PostProcessingDiagnostics } from './PostProcessingDiagnostics.js';
import { PostProcessingFrameState } from './PostProcessingFrameState.js';
import {
  PostProcessingGraph,
  createPostProcessingTopologySignature,
} from './PostProcessingGraph.js';
import { PostProcessingResources } from './PostProcessingResources.js';
import { isPostProcessingEnabled } from './nodes/PostCommon.js';

export class PostProcessingController {
  constructor({ renderer, scene, postProcessingStore }) {
    this.renderer = renderer;
    this.scene = scene;
    this.store = postProcessingStore;
    this.settings = postProcessingStore.get();
    this.topologySignature = createPostProcessingTopologySignature(this.settings);
    this.graph = null;
    this.disposed = false;

    this.resources = new PostProcessingResources(renderer);
    this.frameState = new PostProcessingFrameState();
    this.diagnostics = new PostProcessingDiagnostics();

    const canvas = renderer.domElement;
    this.resize(canvas.clientWidth || canvas.width, canvas.clientHeight || canvas.height);
    this.unsubscribe = postProcessingStore.subscribe((settings) => {
      this.settings = settings;
      this.topologySignature = createPostProcessingTopologySignature(settings);
    });
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
      topologySignature: this.topologySignature,
    });
    this.graph.resize(
      this.resources.width,
      this.resources.height,
      this.resources.pixelRatio,
    );
    this.diagnostics.graphBuilt(this.topologySignature);
    return this.graph;
  }

  updateFrame(camera) {
    this.frameState.beginFrame(camera, this.resources);
    this.graph.updateUniforms(this.frameState);
  }

  render(camera) {
    if (this.disposed || !isPostProcessingEnabled(this.settings)) return false;
    this.ensureGraph(camera);
    this.updateFrame(camera);
    this.graph.render();
    this.diagnostics.frameRendered();
    return true;
  }

  async precompile(camera) {
    if (this.disposed || !isPostProcessingEnabled(this.settings)) return false;
    this.ensureGraph(camera);
    this.updateFrame(camera);
    await this.graph.precompile();
    return true;
  }

  warmup(camera) {
    if (this.disposed || !isPostProcessingEnabled(this.settings)) return false;
    this.ensureGraph(camera);
    this.updateFrame(camera);
    this.graph.warmup();
    return true;
  }

  resize(width, height) {
    const pixelRatio = this.renderer.getPixelRatio();
    this.resources.resize(width, height, pixelRatio);
    this.graph?.resize(width, height, pixelRatio);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.graph?.dispose();
    this.resources.dispose();
    this.graph = null;
    this.renderer = null;
    this.scene = null;
    this.store = null;
  }
}
