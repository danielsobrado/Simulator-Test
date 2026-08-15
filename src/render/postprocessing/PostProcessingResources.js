const MIN_RENDER_DIMENSION = 1;
const DEFAULT_PIXEL_RATIO = 1;

function normalizeDimension(value) {
  if (!Number.isFinite(value) || value <= 0) return MIN_RENDER_DIMENSION;
  return Math.max(MIN_RENDER_DIMENSION, value);
}

function normalizePixelRatio(value) {
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_PIXEL_RATIO;
}

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
    this.width = MIN_RENDER_DIMENSION;
    this.height = MIN_RENDER_DIMENSION;
    this.pixelRatio = normalizePixelRatio(renderer.getPixelRatio());
    this.graphs = new Map();
    this.activeSignature = null;
    this.warmupTarget = null;
  }

  resize(width, height, pixelRatio = this.renderer.getPixelRatio()) {
    const nextWidth = normalizeDimension(width);
    const nextHeight = normalizeDimension(height);
    const nextPixelRatio = normalizePixelRatio(pixelRatio);
    const changed = nextWidth !== this.width
      || nextHeight !== this.height
      || nextPixelRatio !== this.pixelRatio;
    if (!changed) return false;

    this.width = nextWidth;
    this.height = nextHeight;
    this.pixelRatio = nextPixelRatio;
    for (const [signature, record] of this.graphs) {
      if (signature === this.activeSignature) {
        this.resizeRecord(record, nextWidth, nextHeight, nextPixelRatio);
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

  discardGraph(signature) {
    const record = this.graphs.get(signature);
    if (!record) return false;
    record.graph.dispose();
    this.graphs.delete(signature);
    if (this.activeSignature === signature) this.activeSignature = null;
    return true;
  }

  resizeGraph(signature, width, height, pixelRatio = DEFAULT_PIXEL_RATIO) {
    const record = this.graphs.get(signature);
    if (!record) return;
    this.resizeRecord(
      record,
      normalizeDimension(width),
      normalizeDimension(height),
      normalizePixelRatio(pixelRatio),
    );
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
