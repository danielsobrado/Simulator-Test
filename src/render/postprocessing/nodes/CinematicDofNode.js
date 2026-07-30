import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  abs,
  dot,
  float,
  floor,
  fract,
  mix,
  orthographicDepthToViewZ,
  perspectiveDepthToViewZ,
  rtt,
  screenUV,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const DEFAULT_TAP_COUNT = 16;
const MIN_TAP_COUNT = 4;
const MAX_TAP_COUNT = 32;
const MIN_BLUR_RADIUS_PIXELS = 1.5;

function clampTapCount(value) {
  const taps = Number(value);
  return Math.max(
    MIN_TAP_COUNT,
    Math.min(MAX_TAP_COUNT, Math.round(Number.isFinite(taps) ? taps : DEFAULT_TAP_COUNT)),
  );
}

function smoothstepReference(edge0, edge1, value) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function cinematicDofCoCReference(
  depth,
  focusDistance,
  {
    nearStartRatio = 0.55,
    nearFullRatio = 0.16,
    farStartMeters = 130,
    farFullMeters = 620,
    maxCoCPixels = 3.5,
  } = {},
) {
  const farCoC = smoothstepReference(farStartMeters, farFullMeters, depth);
  const nearCoC = smoothstepReference(
    focusDistance * nearStartRatio,
    focusDistance * nearFullRatio,
    depth,
  );
  const signedCoC = farCoC - nearCoC;
  return {
    farCoC,
    nearCoC,
    signedCoC,
    radiusPixels: Math.abs(signedCoC) * maxCoCPixels,
  };
}

export function smoothFocusDistanceReference(
  previousFocus,
  targetFocus,
  focusSmoothing,
  deltaSeconds,
) {
  const alpha = 1 - Math.exp(-focusSmoothing * deltaSeconds);
  return previousFocus + (targetFocus - previousFocus) * alpha;
}

function stablePixelNoise(pixel) {
  return fract(dot(pixel, vec2(127.1, 311.7)).sin().mul(43758.5453));
}

export class CinematicDofNode {
  constructor({ sourceNode, depthNode, settings }) {
    this.disposed = false;
    this.settings = settings;
    this.tapCount = clampTapCount(settings.taps);
    this.focusDistance = uniform(settings.manualFocusMeters);
    this.maxCoCPixels = uniform(settings.maxCoCPixels);
    this.nearStartRatio = uniform(settings.nearStartRatio);
    this.nearFullRatio = uniform(settings.nearFullRatio);
    this.farStartMeters = uniform(settings.farStartMeters);
    this.farFullMeters = uniform(settings.farFullMeters);
    this.cameraNear = uniform(0.1);
    this.cameraFar = uniform(5000);
    this.isPerspective = uniform(1);
    this.resolution = uniform(new THREE.Vector2(1, 1));
    this.sourceTarget = rtt(sourceNode, 1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
    });

    const linearDepthAt = (uv) => {
      const rawDepth = depthNode.sample(uv).r;
      const perspectiveDepth = perspectiveDepthToViewZ(
        rawDepth,
        this.cameraNear,
        this.cameraFar,
      ).negate();
      const orthographicDepth = orthographicDepthToViewZ(
        rawDepth,
        this.cameraNear,
        this.cameraFar,
      ).negate();
      return mix(orthographicDepth, perspectiveDepth, this.isPerspective);
    };
    const signedCoCAt = (uv) => {
      const depth = linearDepthAt(uv);
      const farCoC = smoothstep(
        this.farStartMeters,
        this.farFullMeters,
        depth,
      );
      // WGSL smoothstep requires ordered edges. This is algebraically the
      // specification's reversed-edge smoothstep, expressed without undefined
      // edge ordering.
      const nearCoC = smoothstep(
        this.focusDistance.mul(this.nearFullRatio),
        this.focusDistance.mul(this.nearStartRatio),
        depth,
      ).oneMinus();
      return farCoC.sub(nearCoC);
    };

    this.outputNode = Fn(() => {
      const uv = screenUV;
      const centre = this.sourceTarget.sample(uv).rgb;
      const centreRadius = abs(signedCoCAt(uv)).mul(this.maxCoCPixels);
      const outputColour = centre.toVar();

      If(centreRadius.greaterThanEqual(MIN_BLUR_RADIUS_PIXELS), () => {
        const pixel = floor(uv.mul(this.resolution));
        const rotation = stablePixelNoise(pixel).mul(Math.PI * 2);
        const colourSum = centre.toVar();
        const weightSum = float(1).toVar();

        for (let index = 0; index < this.tapCount; index += 1) {
          const radialShare = Math.sqrt((index + 0.5) / this.tapCount);
          const angle = rotation.add(index * GOLDEN_ANGLE);
          const tapDistance = centreRadius.mul(radialShare);
          const offsetPixels = vec2(angle.cos(), angle.sin()).mul(tapDistance);
          const sampleUv = uv.add(offsetPixels.div(this.resolution));
          const sampleRadius = abs(signedCoCAt(sampleUv)).mul(this.maxCoCPixels);
          const reachesCentre = step(tapDistance, sampleRadius);
          const inBounds = step(0, sampleUv.x)
            .mul(step(sampleUv.x, 1))
            .mul(step(0, sampleUv.y))
            .mul(step(sampleUv.y, 1));
          const weight = reachesCentre.mul(inBounds);
          colourSum.addAssign(this.sourceTarget.sample(sampleUv).rgb.mul(weight));
          weightSum.addAssign(weight);
        }
        outputColour.assign(colourSum.div(weightSum));
      });

      return vec4(outputColour.max(vec3(0)), 1);
    })();
  }

  updateUniforms(frameState, settings) {
    this.settings = settings;
    this.focusDistance.value = frameState.focusDistance;
    this.maxCoCPixels.value = settings.maxCoCPixels;
    this.nearStartRatio.value = settings.nearStartRatio;
    this.nearFullRatio.value = settings.nearFullRatio;
    this.farStartMeters.value = settings.farStartMeters;
    this.farFullMeters.value = settings.farFullMeters;
    this.cameraNear.value = frameState.camera.near;
    this.cameraFar.value = frameState.camera.far;
    this.isPerspective.value = frameState.camera.isPerspectiveCamera ? 1 : 0;
  }

  resize(width, height) {
    this.resolution.value.set(width, height);
    this.sourceTarget.setSize(width, height);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.sourceTarget._quadMesh?.material?.dispose();
    this.sourceTarget.renderTarget.dispose();
  }
}
