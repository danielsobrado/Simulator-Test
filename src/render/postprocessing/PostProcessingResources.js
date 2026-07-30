/**
 * Renderer-owned presentation resources. RenderPipeline uses the same renderer,
 * so clear colour, scene background, output colour space, tone mapping and
 * exposure remain exactly those of the direct-render path.
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
