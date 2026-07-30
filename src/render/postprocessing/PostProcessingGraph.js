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
import { HierarchicalDepthNode } from './nodes/HierarchicalDepthNode.js';
import { ScreenSpaceShaftNode } from './nodes/ScreenSpaceShaftNode.js';
import { SelectiveSsrNode } from './nodes/SelectiveSsrNode.js';
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
    sunDirection,
    sunColor,
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

    this.screenSpaceShafts = settings?.screenSpaceShafts?.enabled === true
      ? new ScreenSpaceShaftNode({
        sourceNode: this.inputs.output,
        depthNode: this.inputs.depth,
        settings: settings.screenSpaceShafts,
        sunDirection,
        sunColor,
      })
      : null;
    const postShaftOutput = this.screenSpaceShafts?.outputNode ?? this.inputs.output;
    this.hierarchicalDepth = settings?.ssr?.enabled === true
      ? new HierarchicalDepthNode({
        rawDepthNode: this.inputs.depth,
        linearDepthNode: this.scenePass.getViewZNode().negate(),
        resolutionScale: settings.ssr.resolutionScale,
      })
      : null;
    this.ssr = this.hierarchicalDepth
      ? new SelectiveSsrNode({
        sourceNode: postShaftOutput,
        inputs: this.inputs,
        depthPyramid: this.hierarchicalDepth,
        history,
        settings: settings.ssr,
      })
      : null;
    const preTaaOutput = this.ssr?.outputNode ?? postShaftOutput;
    this.taaResolve = taaEnabled
      ? new TaaResolveNode({
        scenePass: this.scenePass,
        inputs: this.inputs,
        sourceNode: preTaaOutput,
        history,
        settings: settings.antiAliasing,
      })
      : null;
    const resolvedOutput = this.taaResolve?.outputNode ?? preTaaOutput;
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
    if (
      this.screenSpaceShafts
      && settings?.screenSpaceShafts?.resolutionScale
        !== this.screenSpaceShafts.resolutionScale
    ) {
      this.screenSpaceShafts.resolutionScale = settings.screenSpaceShafts.resolutionScale;
      const outputWidth = Math.max(
        1,
        Math.floor(frameState.width * frameState.pixelRatio),
      );
      const outputHeight = Math.max(
        1,
        Math.floor(frameState.height * frameState.pixelRatio),
      );
      this.screenSpaceShafts.resize(outputWidth, outputHeight);
    }
    this.screenSpaceShafts?.updateUniforms(
      frameState,
      settings?.screenSpaceShafts ?? this.screenSpaceShafts.settings,
    );
    if (
      this.ssr
      && settings?.ssr?.resolutionScale !== this.ssr.resolutionScale
    ) {
      this.ssr.resolutionScale = settings.ssr.resolutionScale;
      this.hierarchicalDepth.resolutionScale = settings.ssr.resolutionScale;
      const outputWidth = Math.max(
        1,
        Math.floor(frameState.width * frameState.pixelRatio),
      );
      const outputHeight = Math.max(
        1,
        Math.floor(frameState.height * frameState.pixelRatio),
      );
      this.hierarchicalDepth.resize(outputWidth, outputHeight);
      this.ssr.resize(outputWidth, outputHeight);
    }
    this.ssr?.updateUniforms(frameState, settings?.ssr ?? this.ssr.settings);
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
    this.screenSpaceShafts?.resize(
      Math.max(1, Math.floor(width * pixelRatio)),
      Math.max(1, Math.floor(height * pixelRatio)),
    );
    this.taaResolve?.resize(
      Math.max(1, Math.floor(width * pixelRatio)),
      Math.max(1, Math.floor(height * pixelRatio)),
    );
    this.hierarchicalDepth?.resize(
      Math.max(1, Math.floor(width * pixelRatio)),
      Math.max(1, Math.floor(height * pixelRatio)),
    );
    this.ssr?.resize(
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
    this.ssr?.dispose();
    this.hierarchicalDepth?.dispose();
    this.screenSpaceShafts?.dispose();
    this.scenePass.dispose();
    this.pipeline.outputColorTransform = this.previousOutputColorTransform;
    this.pipeline.dispose();
    this.renderer = null;
  }
}
