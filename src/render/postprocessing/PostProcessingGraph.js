import * as THREE from 'three/webgpu';
import {
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  renderOutput,
  velocity,
} from 'three/tsl';
import { packMaterialDataNode } from './PostProcessingMaterialData.js';
import { createPostProcessingTopologySignature } from './nodes/PostCommon.js';
import { createDebugViewNode } from './nodes/DebugViewNode.js';
import { BloomNode } from './nodes/BloomNode.js';
import { ContrastSharpenNode } from './nodes/ContrastSharpenNode.js';
import { TaaResolveNode } from './nodes/TaaResolveNode.js';
import { ToneMappingNode } from './nodes/ToneMappingNode.js';

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
    history,
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
    const taaEnabled = settings?.antiAliasing?.enabled === true;
    const taaUpscale = taaEnabled && settings.antiAliasing.mode === 'traau';
    this.sceneResolutionScale = taaUpscale ? settings.renderScale : 1;
    this.scenePass.setResolutionScale(this.sceneResolutionScale);

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

    this.taaResolve = taaEnabled
      ? new TaaResolveNode({
        scenePass: this.scenePass,
        inputs: this.inputs,
        history,
        settings: settings.antiAliasing,
      })
      : null;
    const resolvedOutput = this.taaResolve?.outputNode ?? this.inputs.output;
    this.bloom = settings?.bloom?.enabled === true
      ? new BloomNode({
        sourceNode: resolvedOutput,
        materialNode: this.inputs.material,
        settings: settings.bloom,
        exposure: settings?.toneMapping?.exposure ?? 1,
      })
      : null;
    this.bloomTextureNode = this.bloom?.outputNode ?? null;
    this.toneMapping = new ToneMappingNode({
      sourceNode: resolvedOutput,
      bloomNode: this.bloomTextureNode,
      settings: settings.toneMapping,
      bloomIntensity: settings?.bloom?.intensity ?? 0,
      outputColorSpace: renderer.outputColorSpace,
    });
    this.sharpen = settings?.sharpen?.enabled === true
      ? new ContrastSharpenNode({
        sourceNode: this.toneMapping.outputNode,
        settings: settings.sharpen,
      })
      : null;
    const finalOutput = this.sharpen?.outputNode ?? this.toneMapping.outputNode;
    const debugOverride = settings?.diagnostics?.enabled === true
      && settings.diagnostics.debugView !== 'final';

    this.pipeline = new THREE.RenderPipeline(renderer);
    this.previousOutputColorTransform = this.pipeline.outputColorTransform;
    this.pipeline.outputColorTransform = false;
    this.pipeline.outputNode = debugOverride
      ? renderOutput(
        createDebugViewNode(this.scenePass, settings.diagnostics.debugView),
        THREE.NoToneMapping,
        renderer.outputColorSpace,
      )
      : finalOutput;
  }

  updateUniforms(frameState, settings = null) {
    // Camera identity can change when switching editor/player views without
    // changing graph topology.
    this.scenePass.camera = frameState.camera;
    const nextSceneResolutionScale = settings?.antiAliasing?.enabled === true
      && settings.antiAliasing.mode === 'traau'
      ? settings.renderScale
      : 1;
    if (nextSceneResolutionScale !== this.sceneResolutionScale) {
      this.sceneResolutionScale = nextSceneResolutionScale;
      this.scenePass.setResolutionScale(nextSceneResolutionScale);
    }
    if (this.taaResolve) {
      this.taaResolve.settings = settings?.antiAliasing ?? this.taaResolve.settings;
      this.taaResolve.updateUniforms(frameState);
    }
    this.bloom?.updateUniforms(
      settings?.bloom ?? this.bloom.settings,
      settings?.toneMapping?.exposure ?? 1,
    );
    this.toneMapping.updateUniforms(
      settings?.toneMapping,
      settings?.bloom?.intensity ?? 0,
    );
    this.sharpen?.updateUniforms(settings?.sharpen);
  }

  resize(width, height, pixelRatio = 1) {
    this.scenePass.setSize(
      Math.max(1, Math.floor(width * pixelRatio)),
      Math.max(1, Math.floor(height * pixelRatio)),
    );
    this.taaResolve?.resize(
      Math.max(1, Math.floor(width * pixelRatio)),
      Math.max(1, Math.floor(height * pixelRatio)),
    );
    this.bloom?.resize(
      Math.max(1, Math.floor(width * pixelRatio)),
      Math.max(1, Math.floor(height * pixelRatio)),
    );
    this.sharpen?.resize(
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
    this.sharpen?.dispose();
    this.bloom?.dispose();
    this.taaResolve?.dispose();
    this.scenePass.dispose();
    this.pipeline.outputColorTransform = this.previousOutputColorTransform;
    this.pipeline.dispose();
    this.renderer = null;
  }
}
