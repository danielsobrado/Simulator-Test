import * as THREE from 'three/webgpu';
import {
  builtinAOContext,
  mrt,
  normalView,
  packNormalToRGB,
  pass,
  sample,
  screenUV,
  unpackRGBToNormal,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';

const SETTINGS = Object.freeze({
  resolutionScale: 0.5,
  samples: 8,
  radius: 0.25,
  scale: 0.5,
  thickness: 1,
  distanceExponent: 1,
  distanceFallOff: 1,
  temporalFiltering: false,
});

/**
 * Workshop-only GTAO pipeline.
 *
 * AO is supplied to the physical lighting context instead of multiplying the
 * final frame. Direct sunlight, emissive materials, and editor helpers
 * therefore retain their authored colour while indirect light is occluded.
 */
export class WorkshopAmbientOcclusion {
  constructor({ renderer, scene, camera }) {
    this.disposed = false;
    this.renderer = renderer;

    // The depth/normal pass does not need MSAA. GTAO runs from its resolved
    // screen-space inputs, while the beauty pass retains the renderer's normal
    // antialiasing.
    this.prePass = pass(scene, camera, { samples: 1 });
    this.prePass.name = 'Workshop AO Pre-Pass';
    this.prePass.transparent = false;
    this.prePass.setMRT(mrt({
      output: packNormalToRGB(normalView),
    }));

    this.prePassNormal = sample((uvNode) => (
      unpackRGBToNormal(this.prePass.getTextureNode().sample(uvNode))
    ));
    this.prePassDepth = this.prePass.getTextureNode('depth');

    // Packed view normals do not need a floating-point render target. This is
    // the same bandwidth optimisation used by Three's WebGPU GTAO example.
    this.prePass.getTexture('output').type = THREE.UnsignedByteType;

    this.aoPass = ao(this.prePassDepth, this.prePassNormal, camera);
    this.aoPass.resolutionScale = SETTINGS.resolutionScale;
    this.aoPass.samples.value = SETTINGS.samples;
    this.aoPass.radius.value = SETTINGS.radius;
    this.aoPass.scale.value = SETTINGS.scale;
    this.aoPass.thickness.value = SETTINGS.thickness;
    this.aoPass.distanceExponent.value = SETTINGS.distanceExponent;
    this.aoPass.distanceFallOff.value = SETTINGS.distanceFallOff;
    this.aoPass.useTemporalFiltering = SETTINGS.temporalFiltering;

    this.scenePass = pass(scene, camera);
    const aoOutput = this.aoPass.getTextureNode();
    this.scenePass.contextNode = builtinAOContext(aoOutput.sample(screenUV).r);

    this.renderPipeline = new THREE.RenderPipeline(renderer);
    this.renderPipeline.outputNode = this.scenePass;
  }

  get status() {
    return Object.freeze({
      active: !this.disposed,
      resolutionScale: this.aoPass.resolutionScale,
      samples: this.aoPass.samples.value,
      radius: this.aoPass.radius.value,
      scale: this.aoPass.scale.value,
      thickness: this.aoPass.thickness.value,
      distanceExponent: this.aoPass.distanceExponent.value,
      distanceFallOff: this.aoPass.distanceFallOff.value,
      temporalFiltering: this.aoPass.useTemporalFiltering,
    });
  }

  render() {
    if (this.disposed) return;
    this.renderPipeline.render();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.aoPass.dispose();
    this.scenePass.dispose();
    this.prePass.dispose();
    this.renderer = null;
  }
}
