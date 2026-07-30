import * as THREE from 'three/webgpu';
import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import {
  Fn,
  clamp,
  exp,
  float,
  getViewPosition,
  mix,
  pass,
  rtt,
  screenUV,
  uniform,
  vec3,
  vec4,
} from 'three/tsl';
import { buildDustGodRays } from './GodRaysScreenScattering.js';
export {
  advectedDustDensityReference,
  dustModulationReference,
  godRaysCloudTransmissionReference,
  godRaysOcclusionContrastReference,
  godRaysRadialStepReference,
  godRaysScreenFalloffReference,
  godRaysScreenUvCoverageReference,
  godRaysSunSourceReference,
  godRaysVisibilityReference,
} from './GodRaysScreenScattering.js';

const SUN_FADE_UV_MARGIN = 0.35;
const SUN_FADE_FORWARD_END = 0.12;
const GOD_RAY_TECHNIQUES = Object.freeze(['screen-space', 'volumetric']);

export function directionFromAngles(elevationDegrees, azimuthDegrees) {
  const elevation = THREE.MathUtils.degToRad(elevationDegrees);
  const azimuth = THREE.MathUtils.degToRad(azimuthDegrees);
  return new THREE.Vector3(
    Math.cos(elevation) * Math.cos(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.sin(azimuth),
  ).normalize();
}

const viewDirection = new THREE.Vector3();
const sunPoint = new THREE.Vector3();

export function projectSunToScreen(sunDirection, camera) {
  viewDirection.copy(sunDirection).transformDirection(camera.matrixWorldInverse);
  const forward = -viewDirection.z;

  camera.getWorldPosition(sunPoint);
  sunPoint.addScaledVector(sunDirection, 1e6).project(camera);
  return {
    u: sunPoint.x * 0.5 + 0.5,
    // screenUV follows WebGPU's top-left origin, while projected NDC uses +Y up.
    v: 0.5 - sunPoint.y * 0.5,
    visible: forward > 0,
    forward,
  };
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smooth01(value) {
  const clamped = clamp01(value);
  return clamped * clamped * (3 - 2 * clamped);
}

export function sunScreenFade(info, marginUv = SUN_FADE_UV_MARGIN) {
  if (!(info.forward > 0)) return 0;
  const outsideU = Math.max(0, -info.u, info.u - 1);
  const outsideV = Math.max(0, -info.v, info.v - 1);
  const outside = Math.hypot(outsideU, outsideV);
  const edgeFade = smooth01(1 - outside / Math.max(1e-4, marginUv));
  const facingFade = smooth01(info.forward / SUN_FADE_FORWARD_END);
  return edgeFade * facingFade;
}

function normalizedColorVector(colorValue) {
  const color = new THREE.Color(colorValue);
  const peak = Math.max(color.r, color.g, color.b, 1e-4);
  return new THREE.Vector3(color.r / peak, color.g / peak, color.b / peak);
}

export function exponentialHeightFogReference({
  cameraHeight,
  targetHeight,
  distance,
  density,
  baseHeight,
  heightFalloff,
  maxDistance,
}) {
  const pathLength = Math.min(Math.max(0, distance), Math.max(0, maxDistance));
  const midpointHeight = (cameraHeight + targetHeight) * 0.5;
  const heightDensity = Math.min(
    8,
    Math.exp(-(midpointHeight - baseHeight) * heightFalloff),
  );
  return 1 - Math.exp(-pathLength * density * heightDensity);
}

function buildExponentialHeightFog({
  depthTex,
  uvNode,
  cameraMatrixWorld,
  cameraProjectionMatrixInverse,
  cameraPosition,
  density,
  baseHeight,
  heightFalloff,
  maxDistance,
}) {
  return Fn(() => {
    const depth = depthTex.sample(uvNode).r;
    const viewPosition = getViewPosition(
      uvNode,
      depth,
      cameraProjectionMatrixInverse,
    );
    const worldPosition = cameraMatrixWorld.mul(viewPosition).xyz;
    const pathLength = worldPosition
      .sub(cameraPosition)
      .length()
      .min(maxDistance);
    const midpointHeight = cameraPosition.y.add(worldPosition.y).mul(0.5);
    const heightDensity = clamp(
      exp(midpointHeight.sub(baseHeight).mul(heightFalloff).negate()),
      0,
      8,
    );
    return exp(pathLength.mul(density).mul(heightDensity).negate()).oneMinus();
  })();
}

export class StylizedGodRaysPostProcess {
  constructor({
    renderer,
    scene,
    config,
    sunDirection,
    sunColor,
  }) {
    this.renderer = renderer;
    this.scene = scene;
    this.config = config ?? {};
    this.config.volumetric ??= {};
    this.enabled = Boolean(config?.enabled);
    this.technique = GOD_RAY_TECHNIQUES.includes(config?.technique)
      ? config.technique
      : 'screen-space';
    this.disposed = false;
    this.sunDirection = sunDirection.clone().normalize();
    this.sunUv = uniform(new THREE.Vector2(0.5, 0.5));
    this.intensity = uniform(0);
    this.density = uniform(config?.density ?? 0.96);
    this.decay = uniform(config?.decay ?? 0.92);
    this.weight = uniform(config?.weight ?? 0.35);
    this.exposure = uniform(config?.exposure ?? 0.18);
    this.dustStrength = uniform(config?.dustStrength ?? 0.85);
    this.dustScale = uniform(config?.dustScale ?? 9);
    this.dustSpeed = uniform(config?.dustSpeed ?? 0.025);
    this.atmosphereTime = uniform(0);
    this.tint = uniform(normalizedColorVector(sunColor ?? '#ffffff'));
    const volumetric = this.config.volumetric;
    this.volumetricIntensity = uniform(volumetric.intensity ?? 1);
    this.volumetricBlurSoftness = uniform(volumetric.blurSoftness ?? 0.85);
    this.volumetricCloudInfluence = uniform(volumetric.cloudInfluence ?? 0.75);
    this.heightFogDensity = uniform(volumetric.fogDensity ?? 0.018);
    this.heightFogBaseHeight = uniform(volumetric.fogBaseHeight ?? 2);
    this.heightFogFalloff = uniform(volumetric.fogHeightFalloff ?? 0.035);
    this.heightFogMaxDistance = uniform(volumetric.fogMaxDistance ?? 180);
    this.cameraMatrixWorld = uniform(new THREE.Matrix4());
    this.cameraProjectionMatrixInverse = uniform(new THREE.Matrix4());
    this.cameraPosition = uniform(new THREE.Vector3());
    this.pipeline = null;
    this.screenPipeline = null;
    this.volumetricPipeline = null;
    this.scenePass = null;
    this.cloudPass = null;
    this.cloudMaskScene = null;
    this.cloudOcclusionUniform = null;
    this.raysTexture = null;
    this.volumetricLight = null;
    this.volumetricRays = null;
    this.volumetricBlur = null;
    this.volumetricCamera = null;
    this.camera = null;
  }

  setCloudMaskScene(scene, { cloudOcclusionUniform = null } = {}) {
    this.cloudMaskScene = scene;
    this.cloudOcclusionUniform = cloudOcclusionUniform;
  }

  setVolumetricLight(light) {
    if (this.volumetricLight === light) return;
    this.disposeVolumetricPipeline();
    this.volumetricLight = light;
  }

  setTime(timeSeconds) {
    if (Number.isFinite(timeSeconds)) this.atmosphereTime.value = timeSeconds;
  }

  shouldRender(camera) {
    return this.enabled && !this.disposed && Boolean(camera?.isPerspectiveCamera);
  }

  ensureScenePass(camera) {
    if (!this.scenePass) {
      this.scenePass = pass(this.scene, camera, { samples: this.renderer.samples });
      this.scenePass.name = 'God Rays Scene Pass';
    }
    // Cloud mask is attached by StylizedSkyView after InfiniteTerrainView
    // constructs god rays. If the first ensureScenePass raced ahead of that,
    // bind the pass here instead of freezing cloudPass at null forever.
    if (!this.cloudPass && this.cloudMaskScene) {
      this.cloudPass = pass(this.cloudMaskScene, camera);
      this.cloudPass.name = 'God Rays Cloud Transmission Pass';
      this.cloudPass.getTexture('output').name = 'God Rays Cloud Transmission';
    }
    this.scenePass.camera = camera;
    if (this.cloudPass) this.cloudPass.camera = camera;
    this.camera = camera;
    this.updateCloudResolution();
  }

  cloudTransmissionNode() {
    return this.cloudPass ? this.cloudPass.getTextureNode('output') : null;
  }

  ensureScreenPipeline(camera) {
    this.ensureScenePass(camera);
    if (this.screenPipeline) return this.screenPipeline;
    const beauty = this.scenePass.getTextureNode('output');
    const depth = this.scenePass.getTextureNode('depth');
    const cloudTransmission = this.cloudTransmissionNode();
    const rays = buildDustGodRays({
      depthTex: depth,
      cloudTex: cloudTransmission,
      uvNode: screenUV,
      sunUv: this.sunUv,
      intensity: this.intensity,
      density: this.density,
      decay: this.decay,
      weight: this.weight,
      exposure: this.exposure,
      samples: this.config.samples ?? 16,
      dustStrength: this.dustStrength,
      dustScale: this.dustScale,
      dustSpeed: this.dustSpeed,
      timeNode: this.atmosphereTime,
    });
    this.raysTexture = rtt(rays).setResolutionScale(this.config.resolutionScale ?? 0.5);
    this.raysTexture.renderTarget.texture.name = 'God Rays Half Resolution';

    this.screenPipeline = new THREE.RenderPipeline(this.renderer);
    this.screenPipeline.outputNode = vec4(
      beauty.rgb.add(this.raysTexture.sample(screenUV).rgb.mul(this.tint)),
      beauty.a,
    );
    return this.screenPipeline;
  }

  canBuildVolumetricPipeline() {
    return Boolean(
      this.volumetricLight?.castShadow
      && this.volumetricLight.shadow?.map?.depthTexture,
    );
  }

  ensureVolumetricPipeline(camera) {
    this.ensureScenePass(camera);
    if (this.volumetricPipeline && this.volumetricCamera !== camera) {
      this.disposeVolumetricPipeline();
    }
    if (this.volumetricPipeline) return this.volumetricPipeline;
    if (!this.canBuildVolumetricPipeline()) return null;

    const volumetric = this.config.volumetric;
    const beauty = this.scenePass.getTextureNode('output');
    const depth = this.scenePass.getTextureNode('depth');
    const cloudTransmission = this.cloudTransmissionNode();
    this.volumetricRays = godrays(depth, camera, this.volumetricLight);
    this.volumetricRays.raymarchSteps.value = volumetric.raymarchSteps ?? 40;
    this.volumetricRays.density.value = volumetric.density ?? 0.7;
    this.volumetricRays.maxDensity.value = volumetric.maxDensity ?? 0.45;
    this.volumetricRays.distanceAttenuation.value = volumetric.distanceAttenuation ?? 2;
    this.volumetricRays.resolutionScale = volumetric.resolutionScale ?? 0.5;
    this.volumetricBlur = bilateralBlur(
      this.volumetricRays.getTextureNode(),
      this.volumetricBlurSoftness,
      2,
      0.22,
    );
    const blurredRays = this.volumetricBlur.getTextureNode();
    const heightFog = buildExponentialHeightFog({
      depthTex: depth,
      uvNode: screenUV,
      cameraMatrixWorld: this.cameraMatrixWorld,
      cameraProjectionMatrixInverse: this.cameraProjectionMatrixInverse,
      cameraPosition: this.cameraPosition,
      density: this.heightFogDensity,
      baseHeight: this.heightFogBaseHeight,
      heightFalloff: this.heightFogFalloff,
      maxDistance: this.heightFogMaxDistance,
    });
    const cloudTransmissionFactor = cloudTransmission
      ? mix(
        float(1),
        cloudTransmission.sample(screenUV).r,
        this.volumetricCloudInfluence,
      )
      : float(1);
    const rayAmount = blurredRays
      .sample(screenUV)
      .r
      .mul(heightFog)
      .mul(cloudTransmissionFactor)
      .mul(this.volumetricIntensity);

    this.volumetricPipeline = new THREE.RenderPipeline(this.renderer);
    this.volumetricPipeline.outputNode = vec4(
      beauty.rgb.add(this.tint.mul(rayAmount)),
      beauty.a,
    );
    this.volumetricCamera = camera;
    return this.volumetricPipeline;
  }

  ensurePipeline(camera) {
    const selected = this.technique === 'volumetric'
      ? this.ensureVolumetricPipeline(camera)
      : this.ensureScreenPipeline(camera);
    this.pipeline = selected ?? this.ensureScreenPipeline(camera);
    return this.pipeline;
  }

  updateCloudResolution() {
    if (!this.cloudPass) return;
    const scale = this.technique === 'volumetric'
      ? this.config.volumetric.resolutionScale ?? 0.5
      : this.config.resolutionScale ?? 0.5;
    this.cloudPass.setResolutionScale(scale);
  }

  updateUniforms(camera) {
    camera.updateMatrixWorld();
    const info = projectSunToScreen(this.sunDirection, camera);
    this.sunUv.value.set(info.u, info.v);
    this.intensity.value = (this.config.intensity ?? 1) * sunScreenFade(info);
    this.cameraMatrixWorld.value.copy(camera.matrixWorld);
    this.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    camera.getWorldPosition(this.cameraPosition.value);
  }

  render(camera) {
    if (!this.shouldRender(camera)) return false;
    this.ensurePipeline(camera);
    this.updateUniforms(camera);
    this.pipeline.render();
    return true;
  }

  prewarm(camera) {
    if (!this.shouldRender(camera)) return false;
    this.ensurePipeline(camera);
    this.updateUniforms(camera);
    this.pipeline.render();
    return true;
  }

  getSettings() {
    const volumetric = this.config.volumetric;
    return {
      enabled: this.enabled,
      technique: this.technique,
      screenIntensity: this.config.intensity,
      screenResolutionScale: this.config.resolutionScale,
      screenDensity: this.config.density,
      screenDecay: this.config.decay,
      screenWeight: this.config.weight,
      screenExposure: this.config.exposure,
      screenDustStrength: this.config.dustStrength,
      screenDustScale: this.config.dustScale,
      screenDustSpeed: this.config.dustSpeed,
      cloudOcclusion: this.config.cloudOcclusion,
      volumetricIntensity: volumetric.intensity,
      volumetricResolutionScale: volumetric.resolutionScale,
      volumetricRaymarchSteps: volumetric.raymarchSteps,
      volumetricDensity: volumetric.density,
      volumetricMaxDensity: volumetric.maxDensity,
      volumetricDistanceAttenuation: volumetric.distanceAttenuation,
      volumetricBlurSoftness: volumetric.blurSoftness,
      volumetricCloudInfluence: volumetric.cloudInfluence,
      heightFogDensity: volumetric.fogDensity,
      heightFogBaseHeight: volumetric.fogBaseHeight,
      heightFogFalloff: volumetric.fogHeightFalloff,
      heightFogMaxDistance: volumetric.fogMaxDistance,
    };
  }

  setSettings(patch) {
    if (!patch || typeof patch !== 'object') return this.getSettings();
    const number = (key, fallback, minimum = -Infinity, maximum = Infinity) => {
      if (!(key in patch)) return fallback;
      const value = Number(patch[key]);
      return Number.isFinite(value)
        ? THREE.MathUtils.clamp(value, minimum, maximum)
        : fallback;
    };
    if ('enabled' in patch) this.enabled = Boolean(patch.enabled);
    if (GOD_RAY_TECHNIQUES.includes(patch.technique)) this.technique = patch.technique;

    this.config.intensity = number('screenIntensity', this.config.intensity, 0, 5);
    this.config.resolutionScale = number(
      'screenResolutionScale',
      this.config.resolutionScale,
      0.25,
      1,
    );
    this.config.density = number('screenDensity', this.config.density, 0.1, 2);
    this.config.decay = number('screenDecay', this.config.decay, 0, 1);
    this.config.weight = number('screenWeight', this.config.weight, 0.01, 2);
    this.config.exposure = number('screenExposure', this.config.exposure, 0.01, 3);
    this.config.dustStrength = number('screenDustStrength', this.config.dustStrength, 0, 1);
    this.config.dustScale = number('screenDustScale', this.config.dustScale, 0.1, 20);
    this.config.dustSpeed = number('screenDustSpeed', this.config.dustSpeed, 0, 0.2);
    this.config.cloudOcclusion = number('cloudOcclusion', this.config.cloudOcclusion, 0, 1);

    const volumetric = this.config.volumetric;
    volumetric.intensity = number('volumetricIntensity', volumetric.intensity, 0, 5);
    volumetric.resolutionScale = number(
      'volumetricResolutionScale',
      volumetric.resolutionScale,
      0.25,
      1,
    );
    volumetric.raymarchSteps = Math.round(number(
      'volumetricRaymarchSteps',
      volumetric.raymarchSteps,
      8,
      128,
    ));
    volumetric.density = number('volumetricDensity', volumetric.density, 0.01, 3);
    volumetric.maxDensity = number('volumetricMaxDensity', volumetric.maxDensity, 0.01, 1);
    volumetric.distanceAttenuation = number(
      'volumetricDistanceAttenuation',
      volumetric.distanceAttenuation,
      0.01,
      8,
    );
    volumetric.blurSoftness = number(
      'volumetricBlurSoftness',
      volumetric.blurSoftness,
      0,
      3,
    );
    volumetric.cloudInfluence = number(
      'volumetricCloudInfluence',
      volumetric.cloudInfluence,
      0,
      1,
    );
    volumetric.fogDensity = number('heightFogDensity', volumetric.fogDensity, 0.0001, 0.2);
    volumetric.fogBaseHeight = number(
      'heightFogBaseHeight',
      volumetric.fogBaseHeight,
      -100,
      200,
    );
    volumetric.fogHeightFalloff = number(
      'heightFogFalloff',
      volumetric.fogHeightFalloff,
      0.0001,
      1,
    );
    volumetric.fogMaxDistance = number(
      'heightFogMaxDistance',
      volumetric.fogMaxDistance,
      1,
      1000,
    );

    this.density.value = this.config.density;
    this.decay.value = this.config.decay;
    this.weight.value = this.config.weight;
    this.exposure.value = this.config.exposure;
    this.dustStrength.value = this.config.dustStrength;
    this.dustScale.value = this.config.dustScale;
    this.dustSpeed.value = this.config.dustSpeed;
    this.raysTexture?.setResolutionScale(this.config.resolutionScale);
    if (this.cloudOcclusionUniform) {
      this.cloudOcclusionUniform.value = this.config.cloudOcclusion;
    }
    this.volumetricIntensity.value = volumetric.intensity;
    this.volumetricBlurSoftness.value = volumetric.blurSoftness;
    this.volumetricCloudInfluence.value = volumetric.cloudInfluence;
    this.heightFogDensity.value = volumetric.fogDensity;
    this.heightFogBaseHeight.value = volumetric.fogBaseHeight;
    this.heightFogFalloff.value = volumetric.fogHeightFalloff;
    this.heightFogMaxDistance.value = volumetric.fogMaxDistance;
    if (this.volumetricRays) {
      this.volumetricRays.raymarchSteps.value = volumetric.raymarchSteps;
      this.volumetricRays.density.value = volumetric.density;
      this.volumetricRays.maxDensity.value = volumetric.maxDensity;
      this.volumetricRays.distanceAttenuation.value = volumetric.distanceAttenuation;
      this.volumetricRays.resolutionScale = volumetric.resolutionScale;
    }
    this.updateCloudResolution();
    return this.getSettings();
  }

  disposeVolumetricPipeline() {
    this.volumetricPipeline?.dispose();
    this.volumetricRays?.dispose();
    this.volumetricBlur?.dispose();
    this.volumetricPipeline = null;
    this.volumetricRays = null;
    this.volumetricBlur = null;
    this.volumetricCamera = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.screenPipeline?.dispose();
    this.disposeVolumetricPipeline();
    this.scenePass?.dispose();
    this.cloudPass?.dispose();
    this.raysTexture?.renderTarget?.dispose();
    this.raysTexture?._quadMesh?.material?.dispose();
    this.raysTexture?.dispose();
    this.pipeline = null;
    this.screenPipeline = null;
    this.volumetricPipeline = null;
    this.scenePass = null;
    this.cloudPass = null;
    this.cloudMaskScene = null;
    this.cloudOcclusionUniform = null;
    this.raysTexture = null;
    this.volumetricLight = null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
  }
}
