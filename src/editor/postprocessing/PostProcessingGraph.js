import * as THREE from 'three/webgpu';
import {
  float,
  metalness,
  mrt,
  normalView,
  output,
  packNormalToRGB,
  pass,
  renderOutput,
  roughness,
  rtt,
  sample,
  uniform,
  unpackRGBToNormal,
  vec2,
  vec4,
  velocity,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import {
  buildPostProcessingGodRays,
  syncPostProcessingGodRays,
} from './PostProcessingGodRays.js';
import { PostProcessingMaterialOverrides } from './PostProcessingMaterialOverrides.js';
import {
  contrastAdaptiveSharpen,
  debugDepth,
  debugVelocity,
  gradeHdr,
  toneMappingConstant,
  vignette,
} from './PostProcessingNodes.js';

const SSR_QUALITY = Object.freeze({
  low: Object.freeze({ quality: 0.25, resolutionScale: 0.25, blurQuality: 1 }),
  medium: Object.freeze({ quality: 0.5, resolutionScale: 0.5, blurQuality: 2 }),
  high: Object.freeze({ quality: 0.75, resolutionScale: 0.75, blurQuality: 3 }),
});

export class PostProcessingGraph {
  constructor({ renderer, scene, godRays, camera, settings }) {
    this.renderer = renderer;
    this.scene = scene;
    this.godRays = godRays;
    this.camera = camera;
    this.settings = settings;
    this.resources = [];
    this.materialOverrides = new PostProcessingMaterialOverrides(scene);
    this.disposed = false;
    this.uniforms = {
      exposure: uniform(settings.toneMapping.exposure),
      contrast: uniform(settings.toneMapping.contrast),
      saturation: uniform(settings.toneMapping.saturation),
      sharpen: uniform(settings.sharpen.amount),
      vignetteIntensity: uniform(settings.vignette.intensity),
      vignetteInner: uniform(settings.vignette.innerRadius),
      vignetteOuter: uniform(settings.vignette.outerRadius),
      grain: uniform(settings.grain.intensity),
      focusDistance: uniform(settings.depthOfField.focusDistance),
      focalLength: uniform(settings.depthOfField.focalLength),
      bokehScale: uniform(settings.depthOfField.bokehScale),
    };
    try {
      this.build();
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  build() {
    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.pipeline.outputColorTransform = false;
    this.scenePass = pass(this.scene, this.camera, {
      samples: this.settings.antiAliasing.enabled ? 0 : undefined,
    });
    this.scenePass.setMRT(mrt({
      output,
      normal: packNormalToRGB(normalView),
      velocity,
      metalrough: vec2(metalness, roughness),
    }));
    this.scenePass.getTexture('normal').type = THREE.UnsignedByteType;
    this.scenePass.getTexture('metalrough').type = THREE.UnsignedByteType;
    this.materialOverrides.apply();

    const colorTexture = this.scenePass.getTextureNode('output');
    const depthTexture = this.scenePass.getTextureNode('depth');
    const linearDepth = this.scenePass.getLinearDepthNode();
    const normalTexture = this.scenePass.getTextureNode('normal');
    const velocityTexture = this.scenePass.getTextureNode('velocity');
    const metalRoughTexture = this.scenePass.getTextureNode('metalrough');
    const normalNode = sample((uvNode) => unpackRGBToNormal(normalTexture.sample(uvNode)));
    let hdr = colorTexture;

    const godRayResult = buildPostProcessingGodRays(
      this.godRays,
      depthTexture,
      this.camera,
      this.resources,
    );
    this.volumetricRays = godRayResult.rays;
    this.screenRaysTexture = godRayResult.screenTexture;
    if (godRayResult.color) hdr = vec4(hdr.rgb.add(godRayResult.color), hdr.a);

    if (this.settings.ssr.enabled) {
      const reflectionMask = metalRoughTexture.g.lessThanEqual(
        this.settings.ssr.roughnessCutoff,
      ).select(metalRoughTexture.r, 0);
      this.ssrNode = ssr(colorTexture, depthTexture, normalNode, {
        metalnessNode: reflectionMask,
        roughnessNode: metalRoughTexture.g,
        reflectNonMetals: false,
        binaryRefine: true,
        camera: this.camera,
      });
      this.ssrNode.screenEdgeFadeBlack = true;
      hdr = vec4(hdr.rgb.add(this.ssrNode.rgb), hdr.a);
    }

    let resolved = hdr;
    if (this.settings.antiAliasing.enabled) {
      this.traaNode = traa(hdr, depthTexture, velocityTexture, this.camera);
      resolved = this.traaNode;
    }

    const exposed = vec4(resolved.rgb.mul(this.uniforms.exposure), resolved.a);
    if (this.settings.bloom.enabled) {
      this.bloomNode = bloom(
        exposed,
        this.settings.bloom.intensity,
        this.settings.bloom.radius,
        this.settings.bloom.threshold,
      );
      this.bloomNode.smoothWidth.value = this.settings.bloom.softKnee;
    }

    let base = exposed;
    if (this.settings.depthOfField.enabled) {
      this.dofNode = dof(
        exposed,
        this.scenePass.getViewZNode(),
        this.uniforms.focusDistance,
        this.uniforms.focalLength,
        this.uniforms.bokehScale,
      );
      base = this.dofNode;
    }
    let composite = this.bloomNode
      ? vec4(base.rgb.add(this.bloomNode.rgb), base.a)
      : base;
    composite = gradeHdr(
      composite,
      float(1),
      this.uniforms.contrast,
      this.uniforms.saturation,
    );
    if (this.settings.vignette.enabled) {
      composite = vignette(
        composite,
        this.uniforms.vignetteIntensity,
        this.uniforms.vignetteInner,
        this.uniforms.vignetteOuter,
      );
    }

    const toneMapping = this.settings.toneMapping.enabled
      ? toneMappingConstant(this.settings.toneMapping.mode)
      : THREE.NoToneMapping;
    let display = renderOutput(composite, toneMapping, THREE.SRGBColorSpace);
    if (this.settings.sharpen.enabled) {
      const displayTexture = rtt(display);
      this.resources.push(displayTexture);
      display = contrastAdaptiveSharpen(displayTexture, this.uniforms.sharpen);
    }
    if (this.settings.grain.enabled) display = film(display, this.uniforms.grain);

    if (this.settings.diagnostics.enabled) {
      const views = {
        hdr: renderOutput(hdr, toneMapping, THREE.SRGBColorSpace),
        depth: debugDepth(linearDepth),
        normal: normalTexture,
        velocity: debugVelocity(velocityTexture),
        metalrough: vec4(metalRoughTexture.rg, 0, 1),
        bloom: this.bloomNode
          ? renderOutput(this.bloomNode, toneMapping, THREE.SRGBColorSpace)
          : vec4(0, 0, 0, 1),
        ssr: this.ssrNode
          ? renderOutput(this.ssrNode, toneMapping, THREE.SRGBColorSpace)
          : vec4(0, 0, 0, 1),
        taa: renderOutput(resolved, toneMapping, THREE.SRGBColorSpace),
      };
      display = views[this.settings.diagnostics.debugView] ?? display;
    }

    this.pipeline.outputNode = display;
    this.updateSettings(this.settings);
  }

  updateSettings(settings) {
    this.settings = settings;
    const { toneMapping, sharpen, vignette: vignetteSettings, grain, depthOfField } = settings;
    this.uniforms.exposure.value = toneMapping.exposure;
    this.uniforms.contrast.value = toneMapping.contrast;
    this.uniforms.saturation.value = toneMapping.saturation;
    this.uniforms.sharpen.value = sharpen.amount;
    this.uniforms.vignetteIntensity.value = vignetteSettings.intensity;
    this.uniforms.vignetteInner.value = vignetteSettings.innerRadius;
    this.uniforms.vignetteOuter.value = vignetteSettings.outerRadius;
    this.uniforms.grain.value = grain.intensity;
    this.uniforms.focusDistance.value = depthOfField.focusDistance;
    this.uniforms.focalLength.value = depthOfField.focalLength;
    this.uniforms.bokehScale.value = depthOfField.bokehScale;

    if (this.bloomNode) {
      this.bloomNode.strength.value = settings.bloom.intensity;
      this.bloomNode.radius.value = settings.bloom.radius;
      this.bloomNode.threshold.value = settings.bloom.threshold;
      this.bloomNode.smoothWidth.value = settings.bloom.softKnee;
    }
    if (this.traaNode) {
      this.traaNode.depthThreshold = settings.antiAliasing.depthThreshold;
      this.traaNode.edgeDepthDiff = settings.antiAliasing.edgeDepthDiff;
      this.traaNode.maxVelocityLength = settings.antiAliasing.maxVelocityPixels;
      this.traaNode.useSubpixelCorrection = settings.antiAliasing.subpixelCorrection;
    }
    if (this.ssrNode) {
      const quality = SSR_QUALITY[settings.ssr.quality];
      this.ssrNode.quality.value = quality.quality;
      this.ssrNode.resolutionScale = quality.resolutionScale;
      this.ssrNode.blurQuality = quality.blurQuality;
      this.ssrNode.intensity.value = settings.ssr.intensity;
      this.ssrNode.maxDistance.value = settings.ssr.maxDistance;
      this.ssrNode.thickness.value = settings.ssr.thickness;
      this.ssrNode.screenEdgeFade.value = settings.ssr.edgeFade;
    }
    syncPostProcessingGodRays(
      this.godRays,
      this.volumetricRays,
      this.screenRaysTexture,
    );
  }

  render() {
    this.godRays.updateUniforms(this.camera);
    syncPostProcessingGodRays(
      this.godRays,
      this.volumetricRays,
      this.screenRaysTexture,
    );
    this.pipeline.render();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.materialOverrides.restore();
    this.pipeline?.dispose();
    this.traaNode?.dispose();
    this.bloomNode?.dispose();
    this.ssrNode?.dispose();
    this.dofNode?.dispose();
    this.scenePass?.dispose();
    for (const resource of this.resources) resource?.dispose?.();
    this.resources.length = 0;
  }
}
