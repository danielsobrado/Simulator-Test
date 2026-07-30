import * as THREE from 'three/webgpu';

/**
 * Temporal history ownership boundary.
 */
export class PostProcessingHistory {
  constructor() {
    this.taaColourValid = false;
    this.taaDepthValid = false;
    this.ssrValid = false;
    this.jitterIndex = 0;
    this.previousViewProjection = null;
    this.lastResetReason = null;
    this.resetCount = 0;
    this.taaReadIndex = 0;
    this.taaWidth = 0;
    this.taaHeight = 0;
    this.taaColourTargets = [null, null];
    this.taaDepthTargets = [null, null];
    this._latchedViewProjection = new THREE.Matrix4();
  }

  clearHistory(reason) {
    this.taaColourValid = false;
    this.taaDepthValid = false;
    this.ssrValid = false;
    this.jitterIndex = 0;
    this.previousViewProjection = null;
    this.taaReadIndex = 0;
    this.lastResetReason = reason;
    this.resetCount += 1;
  }

  invalidate(reason) {
    this.clearHistory(reason);
  }

  ensureTaaResources(width, height) {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    if (!this.taaColourTargets[0]) {
      for (let index = 0; index < 2; index += 1) {
        const colour = new THREE.RenderTarget(nextWidth, nextHeight, {
          format: THREE.RGBAFormat,
          type: THREE.HalfFloatType,
          colorSpace: THREE.NoColorSpace,
          depthBuffer: false,
        });
        colour.texture.name = `TAA Colour History ${index}`;
        const depth = new THREE.RenderTarget(nextWidth, nextHeight, {
          format: THREE.RedFormat,
          type: THREE.FloatType,
          colorSpace: THREE.NoColorSpace,
          depthBuffer: false,
        });
        depth.texture.name = `TAA Linear Depth History ${index}`;
        this.taaColourTargets[index] = colour;
        this.taaDepthTargets[index] = depth;
      }
    } else if (this.taaWidth !== nextWidth || this.taaHeight !== nextHeight) {
      for (let index = 0; index < 2; index += 1) {
        this.taaColourTargets[index].setSize(nextWidth, nextHeight);
        this.taaDepthTargets[index].setSize(nextWidth, nextHeight);
      }
      this.taaColourValid = false;
      this.taaDepthValid = false;
      this.taaReadIndex = 0;
    }
    this.taaWidth = nextWidth;
    this.taaHeight = nextHeight;
  }

  get taaReadColourTarget() {
    return this.taaColourTargets[this.taaReadIndex];
  }

  get taaWriteColourTarget() {
    return this.taaColourTargets[1 - this.taaReadIndex];
  }

  get taaReadDepthTarget() {
    return this.taaDepthTargets[this.taaReadIndex];
  }

  get taaWriteDepthTarget() {
    return this.taaDepthTargets[1 - this.taaReadIndex];
  }

  latchTaaFrame(viewProjection) {
    this._latchedViewProjection.copy(viewProjection);
    this.previousViewProjection = this._latchedViewProjection;
    this.taaColourValid = true;
    this.taaDepthValid = true;
    this.taaReadIndex = 1 - this.taaReadIndex;
  }

  dispose() {
    for (let index = 0; index < 2; index += 1) {
      this.taaColourTargets[index]?.dispose();
      this.taaDepthTargets[index]?.dispose();
      this.taaColourTargets[index] = null;
      this.taaDepthTargets[index] = null;
    }
    this.taaWidth = 0;
    this.taaHeight = 0;
  }
}
