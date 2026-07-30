/**
 * Renderer-owned presentation dimensions. The controller temporarily owns tone
 * mapping and exposure while the post-processing graph is enabled.
 */
export class PostProcessingResources {
  constructor(renderer) {
    this.renderer = renderer;
    this.width = 1;
    this.height = 1;
    this.pixelRatio = renderer.getPixelRatio();
  }

  resize(width, height, pixelRatio = this.renderer.getPixelRatio()) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pixelRatio = pixelRatio;
  }

  dispose() {
    this.renderer = null;
  }
}
