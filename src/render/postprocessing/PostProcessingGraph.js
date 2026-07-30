import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { createPostProcessingTopologySignature } from './nodes/PostCommon.js';

export { createPostProcessingTopologySignature };

/**
 * Phase 2 graph: a beauty scene pass routed directly to RenderPipeline output.
 * Later phases may insert nodes based on the topology signature.
 */
export class PostProcessingGraph {
  constructor({ renderer, scene, camera, topologySignature }) {
    this.renderer = renderer;
    this.topologySignature = topologySignature;
    this.disposed = false;

    this.scenePass = pass(scene, camera);
    this.scenePass.name = 'World Post-Processing Scene Pass';

    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputNode = this.scenePass;
  }

  updateUniforms(frameState) {
    // Camera identity can change when switching editor/player views without
    // changing graph topology. Phase 2 has no additional uniforms.
    this.scenePass.camera = frameState.camera;
  }

  resize(width, height, pixelRatio = 1) {
    this.scenePass.setSize(
      Math.max(1, Math.floor(width * pixelRatio)),
      Math.max(1, Math.floor(height * pixelRatio)),
    );
  }

  async precompile() {
    await this.scenePass.compileAsync(this.renderer);
  }

  warmup() {
    this.pipeline.render();
  }

  render() {
    this.pipeline.render();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.scenePass.dispose();
    this.pipeline.dispose();
    this.renderer = null;
  }
}
