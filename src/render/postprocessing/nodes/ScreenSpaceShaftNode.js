import * as THREE from 'three/webgpu';
import {
  Fn,
  dot,
  float,
  floor,
  fract,
  max,
  rtt,
  screenUV,
  smoothstep,
  step,
  uniform,
  vec2,
  vec3,
  vec4,
} from 'three/tsl';

const SKY_DEPTH_THRESHOLD = 0.9999;
const SUN_INFLUENCE_MARGIN_UV = 0.35;
const SUN_FORWARD_FADE_END = 0.12;
const RADIAL_FALLOFF_RADIUS_UV = 1.4;

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smooth01(value) {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

/**
 * High-sun suppression used by the runtime node and Node-runnable tests.
 * Shafts are fully present through `startDegrees` and smoothly disappear by
 * `endDegrees`.
 */
export function sunElevationFadeReference(
  elevationDegrees,
  startDegrees = 35,
  endDegrees = 55,
) {
  const start = Number(startDegrees);
  const end = Math.max(start + 1e-4, Number(endDegrees));
  return 1 - smooth01((Number(elevationDegrees) - start) / (end - start));
}

export const screenSpaceShaftSunElevationFadeReference = sunElevationFadeReference;

export function screenSpaceShaftVisibilityReference(visibilities, decay = 0.955) {
  if (!Array.isArray(visibilities) || visibilities.length === 0) return 0;
  let illumination = 1;
  let accumulated = 0;
  let weight = 0;
  for (const sample of visibilities) {
    accumulated += clamp01(Number(sample)) * illumination;
    weight += illumination;
    illumination *= decay;
  }
  const visibleShare = accumulated / Math.max(weight, 1e-6);
  return visibleShare * visibleShare;
}

function screenCoverage(coord) {
  return step(0, coord.x)
    .mul(step(coord.x, 1))
    .mul(step(0, coord.y))
    .mul(step(coord.y, 1));
}

function spatialDither(pixel) {
  return fract(dot(pixel, vec2(127.1, 311.7)).sin().mul(43758.5453));
}

function buildShaftRadiance({
  depthNode,
  sunUv,
  intensity,
  reach,
  decay,
  resolution,
  samples,
}) {
  return Fn(() => {
    const uv = screenUV;
    const pixel = floor(uv.mul(resolution));
    const dither = spatialDither(pixel);
    const stepVector = sunUv.sub(uv).mul(reach.div(samples));
    const coord = uv.add(stepVector.mul(dither)).toVar();
    const illumination = float(1).toVar();
    const visibility = float(0).toVar();
    const totalWeight = float(0).toVar();

    for (let index = 0; index < samples; index += 1) {
      coord.addAssign(stepVector);
      const sampleVisible = step(SKY_DEPTH_THRESHOLD, depthNode.sample(coord).r)
        .mul(screenCoverage(coord));
      visibility.addAssign(sampleVisible.mul(illumination));
      totalWeight.addAssign(illumination);
      illumination.mulAssign(decay);
    }

    const visibleShare = visibility.div(max(totalWeight, 1e-5));
    const squaredVisibility = visibleShare.mul(visibleShare);
    const distanceToSun = uv.sub(sunUv).length();
    const radialFalloff = float(1).sub(smoothstep(
      0,
      RADIAL_FALLOFF_RADIUS_UV,
      distanceToSun,
    ));
    return vec4(vec3(squaredVisibility.mul(radialFalloff).mul(intensity)), 1);
  })();
}

function normalizedTint(value) {
  const color = new THREE.Color(value ?? '#ffffff');
  const peak = Math.max(color.r, color.g, color.b, 1e-4);
  return new THREE.Vector3(color.r / peak, color.g / peak, color.b / peak);
}

export class ScreenSpaceShaftNode {
  constructor({
    sourceNode,
    depthNode,
    settings,
    sunDirection,
    sunColor = '#ffffff',
  }) {
    this.settings = settings;
    this.sunDirection = (sunDirection ?? new THREE.Vector3(0, 0.25, -1))
      .clone()
      .normalize();
    this.resolutionScale = settings.resolutionScale;
    this.disposed = false;
    this.sunUv = uniform(new THREE.Vector2(0.5, 0.5));
    this.intensity = uniform(0);
    this.reach = uniform(settings.reach ?? 0.82);
    this.decay = uniform(settings.decay ?? 0.955);
    this.resolution = uniform(new THREE.Vector2(1, 1));
    this.tint = uniform(normalizedTint(sunColor));
    this.viewDirection = new THREE.Vector3();
    this.sunPoint = new THREE.Vector3();

    const samples = Math.max(1, Math.round(settings.samples));
    this.radianceNode = rtt(buildShaftRadiance({
      depthNode,
      sunUv: this.sunUv,
      intensity: this.intensity,
      reach: this.reach,
      decay: this.decay,
      resolution: this.resolution,
      samples,
    }), 1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
    });
    this.radianceNode.renderTarget.texture.generateMipmaps = false;

    this.compositeNode = rtt(Fn(() => {
      const source = sourceNode.sample(screenUV);
      const shafts = this.radianceNode.sample(screenUV).rgb.mul(this.tint);
      return vec4(source.rgb.add(shafts), source.a);
    })(), 1, 1, {
      format: THREE.RGBAFormat,
      type: THREE.HalfFloatType,
      colorSpace: THREE.NoColorSpace,
      depthBuffer: false,
    });
    this.compositeNode.renderTarget.texture.generateMipmaps = false;
    this.outputNode = this.compositeNode;
  }

  projectSun(camera) {
    this.viewDirection.copy(this.sunDirection)
      .transformDirection(camera.matrixWorldInverse);
    const forward = -this.viewDirection.z;
    camera.getWorldPosition(this.sunPoint);
    this.sunPoint.addScaledVector(this.sunDirection, 1e6).project(camera);
    return {
      u: this.sunPoint.x * 0.5 + 0.5,
      v: 0.5 - this.sunPoint.y * 0.5,
      forward,
    };
  }

  updateUniforms(frameState, settings = this.settings) {
    this.settings = settings;
    const projected = this.projectSun(frameState.camera);
    this.sunUv.value.set(projected.u, projected.v);

    const outsideU = Math.max(0, -projected.u, projected.u - 1);
    const outsideV = Math.max(0, -projected.v, projected.v - 1);
    const outside = Math.hypot(outsideU, outsideV);
    const edgeFade = smooth01(1 - outside / SUN_INFLUENCE_MARGIN_UV);
    const facingFade = projected.forward > 0
      ? smooth01(projected.forward / SUN_FORWARD_FADE_END)
      : 0;
    const elevation = THREE.MathUtils.radToDeg(Math.asin(
      THREE.MathUtils.clamp(this.sunDirection.y, -1, 1),
    ));
    const elevationFade = sunElevationFadeReference(
      elevation,
      settings.highSunFadeStartDegrees,
      settings.highSunFadeEndDegrees,
    );
    this.intensity.value = settings.intensity * edgeFade * facingFade * elevationFade;
    this.reach.value = settings.reach ?? 0.82;
    this.decay.value = settings.decay ?? 0.955;
  }

  resize(width, height) {
    const scaledWidth = Math.max(1, Math.floor(width * this.resolutionScale));
    const scaledHeight = Math.max(1, Math.floor(height * this.resolutionScale));
    this.radianceNode.setSize(scaledWidth, scaledHeight);
    this.compositeNode.setSize(width, height);
    this.resolution.value.set(scaledWidth, scaledHeight);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.radianceNode._quadMesh?.material?.dispose();
    this.radianceNode.renderTarget.dispose();
    this.compositeNode._quadMesh?.material?.dispose();
    this.compositeNode.renderTarget.dispose();
  }
}
