import { bilateralBlur } from 'three/addons/tsl/display/BilateralBlurNode.js';
import { godrays } from 'three/addons/tsl/display/GodraysNode.js';
import { float, mix, rtt, screenUV } from 'three/tsl';
import { buildDustGodRays } from '../stylized/GodRaysScreenScattering.js';
import { exponentialHeightFog } from './PostProcessingNodes.js';

function buildVolumetric(effect, depthTexture, camera, resources) {
  const config = effect.config.volumetric;
  const rays = godrays(depthTexture, camera, effect.volumetricLight);
  rays.raymarchSteps.value = config.raymarchSteps;
  rays.density.value = config.density;
  rays.maxDensity.value = config.maxDensity;
  rays.distanceAttenuation.value = config.distanceAttenuation;
  rays.resolutionScale = config.resolutionScale;
  const blur = bilateralBlur(
    rays.getTextureNode(),
    effect.volumetricBlurSoftness,
    2,
    0.22,
  );
  const heightFog = exponentialHeightFog({
    depthTexture,
    cameraProjectionInverse: effect.cameraProjectionMatrixInverse,
    cameraMatrixWorld: effect.cameraMatrixWorld,
    density: effect.heightFogDensity,
    baseHeight: effect.heightFogBaseHeight,
    heightFalloff: effect.heightFogFalloff,
    maxDistance: effect.heightFogMaxDistance,
  });
  const cloudFactor = mix(
    float(1),
    effect.cloudTransmissionNode().sample(screenUV).r,
    effect.volumetricCloudInfluence,
  );
  const amount = blur.getTextureNode().sample(screenUV).r
    .mul(heightFog)
    .mul(cloudFactor)
    .mul(effect.volumetricIntensity);
  resources.push(rays, blur);
  return {
    color: effect.tint.mul(amount),
    rays,
    screenTexture: null,
  };
}

function buildScreenSpace(effect, depthTexture, resources) {
  const rays = buildDustGodRays({
    depthTex: depthTexture,
    cloudTex: effect.cloudTransmissionNode(),
    uvNode: screenUV,
    sunUv: effect.sunUv,
    intensity: effect.intensity,
    density: effect.density,
    decay: effect.decay,
    weight: effect.weight,
    exposure: effect.exposure,
    samples: effect.config.samples ?? 16,
    dustStrength: effect.dustStrength,
    dustScale: effect.dustScale,
    dustSpeed: effect.dustSpeed,
    timeNode: effect.atmosphereTime,
  });
  const raysTexture = rtt(rays).setResolutionScale(effect.config.resolutionScale ?? 0.5);
  resources.push(raysTexture);
  return {
    color: raysTexture.sample(screenUV).rgb.mul(effect.tint),
    rays: null,
    screenTexture: raysTexture,
  };
}

export function buildPostProcessingGodRays(effect, depthTexture, camera, resources) {
  if (!effect.shouldRender(camera)) {
    return { color: null, rays: null, screenTexture: null };
  }
  effect.ensureScenePass(camera);
  if (effect.technique === 'volumetric' && effect.canBuildVolumetricPipeline()) {
    return buildVolumetric(effect, depthTexture, camera, resources);
  }
  return buildScreenSpace(effect, depthTexture, resources);
}

export function syncPostProcessingGodRays(effect, rays, screenTexture) {
  if (screenTexture) {
    screenTexture.setResolutionScale(effect.config.resolutionScale ?? 0.5);
  }
  if (!rays) return;
  const config = effect.config.volumetric;
  rays.raymarchSteps.value = config.raymarchSteps;
  rays.density.value = config.density;
  rays.maxDensity.value = config.maxDensity;
  rays.distanceAttenuation.value = config.distanceAttenuation;
  rays.resolutionScale = config.resolutionScale;
}
