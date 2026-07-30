/**
 * Owns graph resources across topology switches. Disabled effects retain their
 * last allocation so toggling them does not thrash render targets. A display
 * resize keeps only the active topology: inactive graphs still contain targets
 * at the stale size, so they are released immediately instead of reallocating
 * full-size resources for disabled effects.
 */
export class PostProcessingResources {
  constructor(renderer) {
    this.renderer = renderer;
    this.width = 1;
    this.height = 1;
    this.pixelRatio = renderer.getPixelRatio();
    this.graphs = new Map();
    this.activeSignature = null;
    this.warmupTarget = null;
  }

  resize(width, height, pixelRatio = this.renderer.getPixelRatio()) {
    const nextWidth = Math.max(1, width);
    const nextHeight = Math.max(1, height);
    const changed = nextWidth !== this.width
      || nextHeight !== this.height
      || pixelRatio !== this.pixelRatio;
    if (!changed) return false;

    this.width = nextWidth;
    this.height = nextHeight;
    this.pixelRatio = pixelRatio;
    for (const [signature, record] of this.graphs) {
      if (signature === this.activeSignature) {
        this.resizeRecord(record, nextWidth, nextHeight, pixelRatio);
      } else {
        record.graph.dispose();
        this.graphs.delete(signature);
      }
    }
    return true;
  }

  acquireGraph(signature, createGraph) {
    let record = this.graphs.get(signature);
    if (!record) {
      record = {
        graph: createGraph(),
        width: 0,
        height: 0,
        pixelRatio: 0,
      };
      this.graphs.set(signature, record);
    }
    return record.graph;
  }

  activateGraph(signature) {
    const record = this.graphs.get(signature);
    if (!record) return null;
    this.activeSignature = signature;
    this.resizeRecord(record, this.width, this.height, this.pixelRatio);
    return record.graph;
  }

  deactivateGraph() {
    this.activeSignature = null;
  }

  resizeGraph(signature, width, height, pixelRatio = 1) {
    const record = this.graphs.get(signature);
    if (!record) return;
    this.resizeRecord(record, width, height, pixelRatio);
  }

  resizeRecord(record, width, height, pixelRatio) {
    if (
      record.width === width
      && record.height === height
      && record.pixelRatio === pixelRatio
    ) return;
    record.graph.resize(width, height, pixelRatio);
    record.width = width;
    record.height = height;
    record.pixelRatio = pixelRatio;
  }

  async withWarmupTarget(callback) {
    const renderer = this.renderer;
    if (!renderer || typeof renderer.setRenderTarget !== 'function') {
      return callback();
    }
    if (!this.warmupTarget) {
      const THREE = await import('three/webgpu');
      this.warmupTarget = new THREE.RenderTarget(8, 8, {
        depthBuffer: false,
      });
      this.warmupTarget.texture.name = 'Post-Processing Warmup Target';
    }
    const previousTarget = renderer.getRenderTarget?.() ?? null;
    renderer.setRenderTarget(this.warmupTarget);
    try {
      return await callback();
    } finally {
      renderer.setRenderTarget(previousTarget);
    }
  }

  snapshot() {
    return Object.freeze({
      width: this.width,
      height: this.height,
      pixelRatio: this.pixelRatio,
      retainedGraphCount: this.graphs.size,
      activeSignature: this.activeSignature,
    });
  }

  dispose() {
    for (const record of this.graphs.values()) record.graph.dispose();
    this.graphs.clear();
    this.warmupTarget?.dispose();
    this.warmupTarget = null;
    this.activeSignature = null;
    this.renderer = null;
  }
}
