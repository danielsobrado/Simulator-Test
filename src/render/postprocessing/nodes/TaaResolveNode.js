import * as THREE from 'three/webgpu';
import {
  Fn,
  clamp,
  float,
  floor,
  max,
  mix,
  rtt,
  screenUV,
  step,
  texture,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

export const TAA_HALTON_JITTER_PIXELS = Object.freeze([
  Object.freeze([0.0000000, -0.1666667]),
  Object.freeze([-0.2500000, 0.1666667]),
  Object.freeze([0.2500000, -0.3888889]),
  Object.freeze([-0.3750000, -0.0555556]),
  Object.freeze([0.1250000, 0.2777778]),
  Object.freeze([-0.1250000, -0.2777778]),
  Object.freeze([0.3750000, 0.0555556]),
  Object.freeze([-0.4375000, 0.3888889]),
]);

export const HALTON_JITTER_PIXELS = TAA_HALTON_JITTER_PIXELS;

function clamp01Reference(value) {
  return Math.max(0, Math.min(1, value));
}

export function taaDepthRejectionThresholdReference(
  currentDepthMeters,
  depthRejectionMinMeters,
  depthRejectionScale,
) {
  return Math.max(
    depthRejectionMinMeters,
    currentDepthMeters * depthRejectionScale,
  );
}

export function taaFeedbackWeightReference(options) {
  const {
    feedback,
    motionPixels,
    motionRejectionPixels,
    reactiveMask,
    reactiveStrength,
    clipDistance,
    historyValid = true,
  } = options;
  if (!historyValid) return 0;
  const motionFactor = 1
    - clamp01Reference(motionPixels / motionRejectionPixels) * 0.60;
  const reactiveFactor = 1 - reactiveMask * reactiveStrength;
  const clipFactor = 1 - clamp01Reference(clipDistance * 4) * 0.50;
  return Math.max(
    0.05,
    Math.min(0.97, feedback * motionFactor * reactiveFactor * clipFactor),
  );
}

export const taaHistoryWeightReference = taaFeedbackWeightReference;

export function taaVarianceClipRangesReference(mean, sigma, varianceGamma) {
  const gamma = [
    varianceGamma,
    varianceGamma * 1.25,
    varianceGamma * 1.25,
  ];
  return {
    min: mean.map((value, index) => value - sigma[index] * gamma[index]),
    max: mean.map((value, index) => value + sigma[index] * gamma[index]),
  };
}

function rgbToYCoCg(rgb) {
  return vec3(
    rgb.r.mul(0.25).add(rgb.g.mul(0.5)).add(rgb.b.mul(0.25)),
    rgb.r.mul(0.5).sub(rgb.b.mul(0.5)),
    rgb.g.mul(0.5).sub(rgb.r.mul(0.25)).sub(rgb.b.mul(0.25)),
  );
}

function yCoCgToRgb(value) {
  return vec3(
    value.x.add(value.y).sub(value.z),
    value.x.add(value.z),
    value.x.sub(value.y).sub(value.z),
  );
}

/**
 * Five bilinear taps reconstruct the bicubic Catmull–Rom footprint. This is
 * used for history in both modes and for the low-resolution source in TAAU.
 */
function sampleCatmullRom5(textureNode, uvNode, resolutionNode) {
  const samplePosition = uvNode.mul(resolutionNode);
  const texelPosition1 = floor(samplePosition.sub(0.5)).add(0.5);
  const fraction = samplePosition.sub(texelPosition1);
  const fraction2 = fraction.mul(fraction);
  const fraction3 = fraction2.mul(fraction);

  const weight0 = fraction
    .mul(-0.5)
    .add(fraction2)
    .sub(fraction3.mul(0.5));
  const weight1 = float(1)
    .sub(fraction2.mul(2.5))
    .add(fraction3.mul(1.5));
  const weight2 = fraction
    .mul(0.5)
    .add(fraction2.mul(2))
    .sub(fraction3.mul(1.5));
  const weight3 = fraction2.mul(-0.5).add(fraction3.mul(0.5));
  const weight12 = weight1.add(weight2);
  const texelPosition12 = texelPosition1.add(weight2.div(max(weight12, vec2(1e-5))));
  const texelPosition0 = texelPosition1.sub(1);
  const texelPosition3 = texelPosition1.add(2);

  const uv12 = texelPosition12.div(resolutionNode);
  const uv0 = texelPosition0.div(resolutionNode);
  const uv3 = texelPosition3.div(resolutionNode);

  return textureNode.sample(uv12)
    .mul(weight12.x.mul(weight12.y))
    .add(textureNode.sample(vec2(uv0.x, uv12.y)).mul(weight0.x.mul(weight12.y)))
    .add(textureNode.sample(vec2(uv3.x, uv12.y)).mul(weight3.x.mul(weight12.y)))
    .add(textureNode.sample(vec2(uv12.x, uv0.y)).mul(weight12.x.mul(weight0.y)))
    .add(textureNode.sample(vec2(uv12.x, uv3.y)).mul(weight12.x.mul(weight3.y)));
}

function uvCoverage(uvNode) {
  return step(0, uvNode.x)
    .mul(step(uvNode.x, 1))
    .mul(step(0, uvNode.y))
    .mul(step(uvNode.y, 1));
}

function buildResolve({
  sourceTexture,
  rawDepthTexture,
  velocityTexture,
  materialTexture,
  currentDepthTexture,
  historyColourTexture,
  historyDepthTexture,
  sourceResolution,
  outputResolution,
  currentViewProjectionInverse,
  previousViewProjection,
  historyValid,
  feedback,
  varianceGamma,
  depthRejectionMinMeters,
  depthRejectionScale,
  reactiveStrength,
  motionRejectionPixels,
  jitterNdc,
  reconstructSource,
}) {
  return Fn(() => {
    const uvNode = screenUV;
    const sourceTexel = vec2(1).div(sourceResolution);
    const current = (
      reconstructSource
        ? sampleCatmullRom5(sourceTexture, uvNode, sourceResolution)
        : sourceTexture.sample(uvNode)
    ).rgb.max(vec3(0));
    const rawDepth = rawDepthTexture.sample(uvNode).r;
    const currentDepth = currentDepthTexture.sample(uvNode).r;
    const velocity = velocityTexture.sample(uvNode).rg;

    const clipPosition = vec4(
      uvNode.x.mul(2).sub(1).add(jitterNdc.x),
      float(1).sub(uvNode.y.mul(2)).add(jitterNdc.y),
      rawDepth,
      1,
    );
    const worldPositionH = currentViewProjectionInverse.mul(clipPosition);
    const worldPosition = worldPositionH.div(max(worldPositionH.w.abs(), 1e-6));
    const previousClip = previousViewProjection.mul(worldPosition);
    const previousNdc = previousClip.xy.div(max(previousClip.w.abs(), 1e-6));
    const cameraPreviousUv = vec2(
      previousNdc.x.mul(0.5).add(0.5),
      float(0.5).sub(previousNdc.y.mul(0.5)),
    );
    const velocityPreviousUv = uvNode.sub(vec2(
      velocity.x.mul(0.5),
      velocity.y.mul(-0.5),
    ));
    const velocityMagnitude = velocity.length();
    const velocityIsValid = velocityMagnitude
      .greaterThan(1e-6)
      .and(velocityMagnitude.lessThan(4));
    const previousUv = velocityIsValid.select(
      velocityPreviousUv,
      cameraPreviousUv,
    );

    const rawHistory = sampleCatmullRom5(
      historyColourTexture,
      previousUv,
      outputResolution,
    ).rgb.max(vec3(0));
    const previousDepth = historyDepthTexture.sample(previousUv).r;

    const mean = vec3(0).toVar();
    const secondMoment = vec3(0).toVar();
    for (let y = -1; y <= 1; y += 1) {
      for (let x = -1; x <= 1; x += 1) {
        const neighbour = sourceTexture
          .sample(uvNode.add(sourceTexel.mul(vec2(x, y))))
          .rgb
          .max(vec3(0));
        const yCoCg = rgbToYCoCg(neighbour);
        mean.addAssign(yCoCg);
        secondMoment.addAssign(yCoCg.mul(yCoCg));
      }
    }
    mean.divAssign(9);
    secondMoment.divAssign(9);
    const sigma = max(secondMoment.sub(mean.mul(mean)), vec3(0)).sqrt();
    const gamma = vec3(
      varianceGamma,
      varianceGamma.mul(1.25),
      varianceGamma.mul(1.25),
    );
    const extent = sigma.mul(gamma);
    const clippedYCoCg = clamp(
      rgbToYCoCg(rawHistory),
      mean.sub(extent),
      mean.add(extent),
    );
    const clippedHistory = yCoCgToRgb(clippedYCoCg).max(vec3(0));

    const currentGeometry = step(rawDepth, 0.9999);
    const previousGeometry = step(1e-6, previousDepth);
    const backgroundMismatch = currentGeometry.sub(previousGeometry).abs();
    const rejectionThreshold = max(
      depthRejectionMinMeters,
      currentDepth.mul(depthRejectionScale),
    );
    const depthRejected = currentDepth
      .sub(previousDepth)
      .abs()
      .greaterThan(rejectionThreshold);
    const accepted = uvCoverage(previousUv)
      .mul(float(1).sub(backgroundMismatch.min(1)))
      .mul(float(1).sub(depthRejected.select(1, 0)))
      .mul(historyValid);

    const motionPixels = velocity.mul(outputResolution).length();
    const motionFactor = float(1).sub(
      clamp(motionPixels.div(motionRejectionPixels), 0, 1).mul(0.60),
    );
    const reactiveMask = materialTexture.sample(uvNode).g;
    const reactiveFactor = float(1).sub(reactiveMask.mul(reactiveStrength));
    const clipDistance = rawHistory.sub(clippedHistory).length();
    const clipFactor = float(1).sub(
      clamp(clipDistance.mul(4), 0, 1).mul(0.50),
    );
    const historyWeight = clamp(
      feedback.mul(motionFactor).mul(reactiveFactor).mul(clipFactor),
      0.05,
      0.97,
    ).mul(accepted);

    return vec4(mix(current, clippedHistory, historyWeight), 1);
  })();
}

export class TaaResolveNode {
  constructor({
    scenePass,
    inputs,
    history,
    settings,
  }) {
    this.history = history;
    this.settings = settings;
    this.disposed = false;
    this.sourceResolution = uniform(new THREE.Vector2(1, 1));
    this.outputResolution = uniform(new THREE.Vector2(1, 1));
    this.currentViewProjectionInverse = uniform(new THREE.Matrix4());
    this.previousViewProjection = uniform(new THREE.Matrix4());
    this.historyValid = uniform(0);
    this.feedback = uniform(settings.feedback);
    this.varianceGamma = uniform(settings.varianceGamma);
    this.depthRejectionMinMeters = uniform(settings.depthRejectionMinMeters);
    this.depthRejectionScale = uniform(settings.depthRejectionScale);
    this.reactiveStrength = uniform(settings.reactiveStrength);
    this.motionRejectionPixels = uniform(settings.motionRejectionPixels);
    this.jitterNdc = uniform(new THREE.Vector2());

    history.ensureTaaResources(1, 1);
    this.historyColourTexture = texture(history.taaReadColourTarget.texture);
    this.historyDepthTexture = texture(history.taaReadDepthTarget.texture);

    const rawDepth = inputs.depth;
    const depthMeters = scenePass.getViewZNode().negate();
    const storedDepth = step(rawDepth, 0.9999).mul(depthMeters);
    this.depthWriteNode = rtt(vec4(storedDepth), 1, 1, {
      format: THREE.RedFormat,
      type: THREE.FloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
    });
    this.depthWriteNode.renderTarget.dispose();
    this.bindWriteTarget(
      this.depthWriteNode,
      history.taaWriteDepthTarget,
    );

    const resolved = buildResolve({
      sourceTexture: inputs.output,
      rawDepthTexture: rawDepth,
      velocityTexture: inputs.velocity,
      materialTexture: inputs.material,
      currentDepthTexture: this.depthWriteNode,
      historyColourTexture: this.historyColourTexture,
      historyDepthTexture: this.historyDepthTexture,
      sourceResolution: this.sourceResolution,
      outputResolution: this.outputResolution,
      currentViewProjectionInverse: this.currentViewProjectionInverse,
      previousViewProjection: this.previousViewProjection,
      historyValid: this.historyValid,
      feedback: this.feedback,
      varianceGamma: this.varianceGamma,
      depthRejectionMinMeters: this.depthRejectionMinMeters,
      depthRejectionScale: this.depthRejectionScale,
      reactiveStrength: this.reactiveStrength,
      motionRejectionPixels: this.motionRejectionPixels,
      jitterNdc: this.jitterNdc,
      reconstructSource: settings.mode === 'traau',
    });
    this.colourWriteNode = rtt(resolved, 1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
    });
    this.colourWriteNode.renderTarget.dispose();
    this.bindWriteTarget(
      this.colourWriteNode,
      history.taaWriteColourTarget,
    );
    this.outputNode = this.colourWriteNode;
  }

  bindWriteTarget(rttNode, target) {
    rttNode.renderTarget = target;
    rttNode.value = target.texture;
    rttNode.textureNeedsUpdate = true;
  }

  updateUniforms(frameState) {
    const history = this.history;
    this.sourceResolution.value.set(frameState.sourceWidth, frameState.sourceHeight);
    const outputWidth = Math.max(1, Math.floor(frameState.width * frameState.pixelRatio));
    const outputHeight = Math.max(1, Math.floor(frameState.height * frameState.pixelRatio));
    this.outputResolution.value.set(outputWidth, outputHeight);
    this.currentViewProjectionInverse.value.copy(
      frameState.currentViewProjectionInverse,
    );
    this.previousViewProjection.value.copy(frameState.previousViewProjection);
    this.jitterNdc.value.copy(frameState.jitterNdc);
    this.historyValid.value = frameState.historyValid ? 1 : 0;
    this.feedback.value = this.settings.feedback;
    this.varianceGamma.value = this.settings.varianceGamma;
    this.depthRejectionMinMeters.value = this.settings.depthRejectionMinMeters;
    this.depthRejectionScale.value = this.settings.depthRejectionScale;
    this.reactiveStrength.value = this.settings.reactiveStrength;
    this.motionRejectionPixels.value = this.settings.motionRejectionPixels;
    this.historyColourTexture.value = history.taaReadColourTarget.texture;
    this.historyDepthTexture.value = history.taaReadDepthTarget.texture;
    this.bindWriteTarget(this.depthWriteNode, history.taaWriteDepthTarget);
    this.bindWriteTarget(this.colourWriteNode, history.taaWriteColourTarget);
  }

  resize(width, height) {
    this.history.ensureTaaResources(width, height);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    // Render targets are owned by PostProcessingHistory.
    this.depthWriteNode._quadMesh?.material?.dispose();
    this.colourWriteNode._quadMesh?.material?.dispose();
  }
}
