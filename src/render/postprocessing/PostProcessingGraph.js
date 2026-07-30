import * as THREE from 'three/webgpu';
import {
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  velocity,
} from 'three/tsl';
import { packMaterialDataNode } from './PostProcessingMaterialData.js';
import { createPostProcessingTopologySignature } from './nodes/PostCommon.js';
import { createDebugViewNode } from './nodes/DebugViewNode.js';

export { createPostProcessingTopologySignature };

/**
 * One HDR scene pass produces all full-resolution post-processing inputs.
 */
export class PostProcessingGraph {
  constructor({
    renderer,
    scene,
    camera,
    settings,
    topologySignature,
  }) {
    this.renderer = renderer;
    this.topologySignature = topologySignature;
    this.disposed = false;

    this.scenePass = pass(scene, camera);
    this.scenePass.name = 'World Post-Processing Scene Pass';
    this.scenePass.setMRT(mrt({
      output,
      normal: packNormalToRGB(normalView),
      velocity,
      material: packMaterialDataNode(),
    }));

    const outputTexture = this.scenePass.getTexture('output');
    outputTexture.format = THREE.RGBAFormat;
    outputTexture.type = THREE.HalfFloatType;

    const normalTexture = this.scenePass.getTexture('normal');
    normalTexture.format = THREE.RGBAFormat;
    normalTexture.type = THREE.UnsignedByteType;
    normalTexture.colorSpace = THREE.NoColorSpace;

    const velocityTexture = this.scenePass.getTexture('velocity');
    velocityTexture.format = THREE.RGFormat;
    velocityTexture.type = THREE.HalfFloatType;
    velocityTexture.colorSpace = THREE.NoColorSpace;

    const materialTexture = this.scenePass.getTexture('material');
    materialTexture.format = THREE.RGBAFormat;
    materialTexture.type = THREE.UnsignedByteType;
    materialTexture.colorSpace = THREE.NoColorSpace;

    this.inputs = Object.freeze({
      output: this.scenePass.getTextureNode('output'),
      normal: this.scenePass.getTextureNode('normal'),
      velocity: this.scenePass.getTextureNode('velocity'),
      material: this.scenePass.getTextureNode('material'),
      depth: this.scenePass.getTextureNode('depth'),
    });

    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputNode = settings?.diagnostics?.enabled === true
      ? createDebugViewNode(this.scenePass, settings.diagnostics.debugView)
      : this.inputs.output;
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
