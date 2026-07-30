import * as THREE from 'three/webgpu';
import { TAA_HALTON_JITTER_PIXELS } from './nodes/TaaResolveNode.js';

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
    this.sourceWidth = 1;
    this.sourceHeight = 1;
    this.temporalEnabled = false;
    this.historyValid = false;
    this.projectionJittered = false;
    this.jitterPixels = new THREE.Vector2();
    this.jitterNdc = new THREE.Vector2();
    this.unjitteredProjection = new THREE.Matrix4();
    this.unjitteredProjectionInverse = new THREE.Matrix4();
    this.currentViewProjection = new THREE.Matrix4();
    this.currentViewProjectionInverse = new THREE.Matrix4();
    this.previousViewProjection = new THREE.Matrix4();
  }

  beginFrame(camera, resources, history = null, settings = null) {
    this.camera = camera;
    this.frame += 1;
    this.width = resources.width;
    this.height = resources.height;
    this.pixelRatio = resources.pixelRatio;
    const aa = settings?.antiAliasing;
    const outputWidth = Math.max(1, Math.floor(this.width * this.pixelRatio));
    const outputHeight = Math.max(1, Math.floor(this.height * this.pixelRatio));
    const sourceScale = aa?.mode === 'traau' ? settings.renderScale : 1;
    this.sourceWidth = Math.max(1, Math.floor(outputWidth * sourceScale));
    this.sourceHeight = Math.max(1, Math.floor(outputHeight * sourceScale));
    this.temporalEnabled = aa?.enabled === true;
    this.historyValid = this.temporalEnabled
      && history?.taaColourValid === true
      && history?.taaDepthValid === true;
    this.projectionJittered = false;
    this.jitterPixels.set(0, 0);
    this.jitterNdc.set(0, 0);

    if (
      this.temporalEnabled
      && camera?.projectionMatrix?.isMatrix4
      && camera?.matrixWorldInverse?.isMatrix4
    ) {
      camera.updateWorldMatrix?.(true, false);
      this.prepareTemporalCamera(camera, history, aa);
    }
    return this;
  }

  prepareTemporalCamera(camera, history, aa) {
    // Steps 2–4: preserve the unjittered camera and publish both current and
    // previous unjittered view-projection matrices before selecting jitter.
    this.unjitteredProjection.copy(camera.projectionMatrix);
    this.unjitteredProjectionInverse.copy(camera.projectionMatrixInverse);
    this.currentViewProjection.multiplyMatrices(
      this.unjitteredProjection,
      camera.matrixWorldInverse,
    );
    this.currentViewProjectionInverse.copy(this.currentViewProjection).invert();
    if (history?.previousViewProjection?.isMatrix4) {
      this.previousViewProjection.copy(history.previousViewProjection);
    } else {
      this.previousViewProjection.copy(this.currentViewProjection);
    }

    // Steps 5–7: sequence values are pixel offsets at the scene/MRT
    // resolution, then converted to NDC and applied to the projection.
    const sampleCount = Math.max(
      1,
      Math.min(TAA_HALTON_JITTER_PIXELS.length, aa.jitterSamples | 0),
    );
    const sampleIndex = (history?.jitterIndex ?? 0) % sampleCount;
    const sample = TAA_HALTON_JITTER_PIXELS[sampleIndex];
    this.jitterPixels.set(sample[0], sample[1]);
    this.jitterNdc.set(
      (sample[0] * 2) / this.sourceWidth,
      (sample[1] * 2) / this.sourceHeight,
    );
    if (history) history.jitterIndex = (sampleIndex + 1) % sampleCount;

    camera.projectionMatrix.copy(this.unjitteredProjection);
    camera.projectionMatrix.elements[8] += this.jitterNdc.x;
    camera.projectionMatrix.elements[9] += this.jitterNdc.y;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    this.projectionJittered = true;
  }

  restoreCameraProjection() {
    if (!this.projectionJittered || !this.camera) return;
    this.camera.projectionMatrix.copy(this.unjitteredProjection);
    this.camera.projectionMatrixInverse.copy(this.unjitteredProjectionInverse);
    this.projectionJittered = false;
  }
}
