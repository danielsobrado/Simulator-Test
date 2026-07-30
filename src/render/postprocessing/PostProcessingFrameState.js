/**
 * Mutable frame data shared by post nodes. Its shape never changes and
 * beginFrame only replaces references/primitives, keeping the render hot path
 * allocation-free.
 */
export class PostProcessingFrameState {
  constructor() {
    this.camera = null;
    this.frame = 0;
    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;
  }

  beginFrame(camera, resources) {
    this.camera = camera;
    this.frame += 1;
    this.width = resources.width;
    this.height = resources.height;
    this.pixelRatio = resources.pixelRatio;
    return this;
  }
}
