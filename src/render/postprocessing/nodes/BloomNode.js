import * as THREE from 'three/webgpu';
import {
  Fn,
  clamp,
  float,
  max,
  rtt,
  screenUV,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

const EPSILON = 1e-5;
const MIN_LEVELS = 2;
const MAX_LEVELS = 6;

const LOW_PASS_TAPS = Object.freeze([
  Object.freeze([-2, -2, 0.03125]),
  Object.freeze([0, -2, 0.0625]),
  Object.freeze([2, -2, 0.03125]),
  Object.freeze([-2, 0, 0.0625]),
  Object.freeze([0, 0, 0.125]),
  Object.freeze([2, 0, 0.0625]),
  Object.freeze([-2, 2, 0.03125]),
  Object.freeze([0, 2, 0.0625]),
  Object.freeze([2, 2, 0.03125]),
  Object.freeze([-1, -1, 0.125]),
  Object.freeze([1, -1, 0.125]),
  Object.freeze([-1, 1, 0.125]),
  Object.freeze([1, 1, 0.125]),
]);

const TENT_TAPS = Object.freeze([
  Object.freeze([-1, -1, 1]),
  Object.freeze([0, -1, 2]),
  Object.freeze([1, -1, 1]),
  Object.freeze([-1, 0, 2]),
  Object.freeze([0, 0, 4]),
  Object.freeze([1, 0, 2]),
  Object.freeze([-1, 1, 1]),
  Object.freeze([0, 1, 2]),
  Object.freeze([1, 1, 1]),
]);

function clampBloomLevels(levels) {
  return Math.max(MIN_LEVELS, Math.min(MAX_LEVELS, Math.round(levels)));
}

export function bloomKarisWeightReference(colour) {
  const luminance = colour[0] * 0.2126
    + colour[1] * 0.7152
    + colour[2] * 0.0722;
  return 1 / (1 + luminance);
}

export function bloomSoftKneeReference(colour, threshold, knee, epsilon = EPSILON) {
  const brightness = Math.max(colour[0], colour[1], colour[2]);
  const softRange = Math.max(0, Math.min(2 * knee, brightness - threshold + knee));
  const soft = (softRange * softRange) / Math.max(4 * knee, epsilon);
  const contribution = Math.max(brightness - threshold, soft);
  const scale = contribution / Math.max(brightness, epsilon);
  return colour.map((channel) => channel * scale);
}

function karisWeight(colour) {
  const luminance = colour.dot(vec3(0.2126, 0.7152, 0.0722));
  return float(1).div(float(1).add(luminance));
}

function sampleLowPass13(textureNode, resolutionNode, useKaris, exposureNode = null) {
  const texel = vec2(1).div(resolutionNode);
  const colourSum = vec3(0).toVar();
  const weightSum = float(0).toVar();

  for (const [x, y, kernelWeight] of LOW_PASS_TAPS) {
    const sampledColour = textureNode
      .sample(screenUV.add(texel.mul(vec2(x, y))))
      .rgb
      .max(vec3(0));
    const colour = exposureNode
      ? sampledColour.mul(exposureNode)
      : sampledColour;
    const weight = useKaris
      ? karisWeight(colour).mul(kernelWeight)
      : float(kernelWeight);
    colourSum.addAssign(colour.mul(weight));
    weightSum.addAssign(weight);
  }

  return colourSum.div(max(weightSum, EPSILON));
}

function sampleTent9(textureNode, resolutionNode) {
  const texel = vec2(1).div(resolutionNode);
  const colour = vec3(0).toVar();
  for (const [x, y, weight] of TENT_TAPS) {
    colour.addAssign(
      textureNode
        .sample(screenUV.add(texel.mul(vec2(x, y))))
        .rgb
        .mul(weight),
    );
  }
  return colour.div(16);
}

function createHdrTarget(node) {
  return rtt(node, 1, 1, {
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    colorSpace: THREE.NoColorSpace,
    depthBuffer: false,
  });
}

/**
 * HDR bloom pyramid. The exposed bloom texture is half resolution; the source
 * itself is never blurred. The temporary composite is replaced by Phase 7's
 * exposure/tone-mapping stage.
 */
export class BloomNode {
  constructor({
    sourceNode,
    materialNode,
    settings,
    exposure = 1,
  }) {
    this.settings = settings;
    this.disposed = false;
    this.levelCount = clampBloomLevels(settings.levels);
    this.exposure = uniform(exposure);
    this.threshold = uniform(settings.threshold);
    this.knee = uniform(settings.knee);
    this.bloomBoost = uniform(settings.bloomBoost);
    this.sourceResolution = uniform(new THREE.Vector2(1, 1));
    this.levelResolutions = Array.from(
      { length: this.levelCount },
      () => uniform(new THREE.Vector2(1, 1)),
    );
    this.targets = [];

    const prefiltered = Fn(() => {
      const exposedLowPass = sampleLowPass13(
        sourceNode,
        this.sourceResolution,
        true,
        this.exposure,
      );
      const brightness = max(
        exposedLowPass.r,
        max(exposedLowPass.g, exposedLowPass.b),
      );
      const softRange = clamp(
        brightness.sub(this.threshold).add(this.knee),
        0,
        this.knee.mul(2),
      );
      const soft = softRange
        .mul(softRange)
        .div(max(this.knee.mul(4), EPSILON));
      const contribution = max(brightness.sub(this.threshold), soft);
      const thresholded = exposedLowPass.mul(
        contribution.div(max(brightness, EPSILON)),
      );
      const materialBloomBoost = materialNode.sample(screenUV).a;
      return vec4(
        thresholded.mul(
          float(1).add(materialBloomBoost.mul(this.bloomBoost)),
        ),
        1,
      );
    })();
    this.targets.push(createHdrTarget(prefiltered));

    for (let level = 1; level < this.levelCount; level += 1) {
      const source = this.targets[level - 1];
      const downsampled = Fn(() => vec4(
        sampleLowPass13(source, this.levelResolutions[level - 1], false),
        1,
      ))();
      this.targets.push(createHdrTarget(downsampled));
    }

    let combined = this.targets[this.levelCount - 1];
    this.upsampleTargets = [];
    for (let level = this.levelCount - 2; level >= 0; level -= 1) {
      const larger = this.targets[level];
      const smaller = combined;
      const upsampled = Fn(() => vec4(
        larger.sample(screenUV).rgb.add(
          sampleTent9(smaller, this.levelResolutions[level + 1]),
        ),
        1,
      ))();
      combined = createHdrTarget(upsampled);
      this.upsampleTargets.push(combined);
    }

    this.outputNode = combined;
  }

  updateUniforms(settings, exposure = 1) {
    this.settings = settings;
    this.exposure.value = exposure;
    this.threshold.value = settings.threshold;
    this.knee.value = settings.knee;
    this.bloomBoost.value = settings.bloomBoost;
  }

  resize(width, height) {
    this.sourceResolution.value.set(width, height);
    let levelWidth = Math.max(1, Math.floor(width / 2));
    let levelHeight = Math.max(1, Math.floor(height / 2));
    for (let level = 0; level < this.levelCount; level += 1) {
      this.levelResolutions[level].value.set(levelWidth, levelHeight);
      this.targets[level].setSize(levelWidth, levelHeight);
      levelWidth = Math.max(1, Math.floor(levelWidth / 2));
      levelHeight = Math.max(1, Math.floor(levelHeight / 2));
    }
    for (let index = 0; index < this.upsampleTargets.length; index += 1) {
      const level = this.levelCount - 2 - index;
      const resolution = this.levelResolutions[level].value;
      this.upsampleTargets[index].setSize(resolution.x, resolution.y);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const target of [...this.targets, ...this.upsampleTargets]) {
      target._quadMesh?.material?.dispose();
      target.renderTarget.dispose();
    }
  }
}
