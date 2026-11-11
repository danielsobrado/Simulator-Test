import { frameUniform } from '../../render/FrameUniforms.js';
import * as THREE from 'three/webgpu';
import { CascadedSunShadows } from '../../render/shadows/CascadedSunShadows.js';
import {
  clamp,
  dot,
  max,
  mix,
  normalize,
  oneMinus,
  positionLocal,
  pow,
  smoothstep,
  uniform,
  vec3,
} from 'three/tsl';
import { cloudMotionCoordinatesNode } from './AtmosphereMotion.js';
import { directionFromAngles } from './StylizedGodRaysPostProcess.js';
import { cloudFbmBands } from './sky/cloudNoise.js';
import { updateCloudShadows, wrapCloudCoordinate } from './CloudShadow.js';
import { createSkyLookUniforms, resolveSkyLook, writeSkyLookUniforms } from './sky/SkyLook.js';
import { createHeatShimmerNodes, resolveHeatShimmerConfig } from './ambient/HeatShimmer.js';
import { createMoonDiscNode, createStarFieldNode, STAR_FIELD_DEFAULTS } from './sky/starField.js';
import { skyAmbientColor } from './sky/skyAmbient.js';
import { updateSkyLight, updateSnowLight } from './sky/skyLight.js';
import { applySceneEnvironment, environmentLightScale } from './sky/sceneEnvironment.js';
import { sceneExposure } from '../../render/sceneExposure.js';
import { resolveSunHazeConfig, sunHazeColor, SunHazeFog } from './sky/sunHaze.js';
import { lightningFlash, litCloudColorNode, resolveCloudLightingConfig } from './sky/cloudLighting.js';
import { writeLookGrade } from './sky/lookGrade.js';

/** How far past the cloud threshold the noise must climb for a cloud's body to be fully in its own shade. */
const CLOUD_BODY_DEPTH = 0.32;
/** The deepest a cloud's own shadow takes it from its lit colour toward its core colour. */
const CLOUD_SELF_SHADOW = 0.85;
/** How much of a scene exposure change the sky follows (a little, so the eye still adapts). */
const SKY_EXPOSURE_FOLLOW = 0.25;
/** How strongly the moon lights clouds and haze, as a share of the sun. */
const MOONLIGHT_SHARE = 0.25;

function cloudCoverageNode({
  config,
  look,
  time,
  direction,
  cameraWorldPosition,
}) {
  const projected = direction.xz.div(max(direction.y.add(0.55), 0.16));
  const cloudUv = cloudMotionCoordinatesNode({
    projected,
    cameraWorldPosition,
    timeNode: time,
    scale: config.sky.cloudScale,
    speed: config.sky.cloudSpeed,
    worldScale: config.sky.cloudWorldScale,
  });
  // The look weights the ragged detail octaves: below 1 the field is rounded
  // masses (cumulus), above 1 broken wisps. At 1 it is the plain fbm.
  const { low, detail } = cloudFbmBands(cloudUv);
  const cloudNoise = low.add(detail.mul(look.cloudDetail))
    .div(look.cloudDetail.mul(0.1875).add(0.75));
  const cloudShape = smoothstep(
    look.cloudDensity,
    look.cloudDensity.add(look.cloudSharpness),
    cloudNoise,
  );
  const cloudFloor = smoothstep(
    config.sky.cloudFloor,
    config.sky.cloudFloor + 0.08,
    direction.y,
  );
  const cloudCeiling = oneMinus(smoothstep(
    config.sky.cloudCeiling - 0.08,
    config.sky.cloudCeiling,
    direction.y,
  ));
  const coverage = cloudShape.mul(cloudFloor).mul(cloudCeiling);
  // Self-shadow from the same noise sample: where the field climbs well past the
  // threshold the cloud is thick and its body is in its own shade; its thin
  // edges stay lit. A second noise sample toward the sun looked the same and
  // cost 0.4 ms a frame, the sky being full screen.
  const body = smoothstep(
    look.cloudDensity.add(look.cloudSharpness),
    look.cloudDensity.add(look.cloudSharpness).add(CLOUD_BODY_DEPTH),
    cloudNoise,
  );
  return { coverage, shape: cloudShape, shadow: body.mul(CLOUD_SELF_SHADOW), body, noise: cloudNoise };
}

/**
 * The dome's view ray, wavering in its low band over hot ground (the ambient
 * layer drives the heat). With no ambient block or the shimmer off, the plain ray.
 */
function shimmeredRay(ambientEffects) {
  const ray = normalize(positionLocal);
  if (!ambientEffects || ambientEffects.enabled === false) return ray;
  const shimmer = createHeatShimmerNodes({ direction: ray, settings: resolveHeatShimmerConfig(ambientEffects) });
  return shimmer?.direction ?? ray;
}

function createSkyMaterial({
  config,
  look,
  time,
  sunDirection,
  cameraWorldPosition,
  night,
  moonDirection,
  moonIllumination,
  exposureCompensation,
}) {
  const direction = shimmeredRay(config.ambientEffects);
  const sunHaze = resolveSunHazeConfig(config.sky);
  const cloudLighting = resolveCloudLightingConfig(config.sky);
  // How much the sun is out: dimmed by overcast (which lowers its emission) and
  // gone once it sets.
  // Under a night look the "sun" is the moon: it lights clouds and haze far
  // more faintly than the sun (MOONLIGHT_SHARE, matched in update()).
  const sunOut = clamp(look.sunEmission.div(Math.max(1e-4, config.sky.sunEmission)), 0, 1)
    .mul(oneMinus(night.mul(1 - MOONLIGHT_SHARE)));
  const sunPresence = sunOut.mul(smoothstep(-0.1, 0.06, sunDirection.y));
  const horizon = smoothstep(
    config.sky.horizonLine - config.sky.horizonSpread,
    config.sky.horizonLine + config.sky.horizonSpread,
    direction.y,
  );
  let color = mix(look.lowColor, look.highColor, horizon);
  if (sunHaze.enabled) {
    // The fog's sun-facing haze, on the horizon band it fades the terrain into.
    const hazed = sunHazeColor({
      baseColor: color,
      glowColor: look.sunGlowColor,
      direction,
      sunDirection,
      settings: sunHaze,
      // Matches SunHazeFog.sync, so the terrain meets the sky without a seam.
      presence: sunOut,
    });
    color = mix(hazed, color, horizon);
  }

  const sunAlignment = clamp(dot(direction, sunDirection), 0, 1);
  const sunInner = Math.cos(config.sky.sunSize);
  const sunOuter = Math.cos(config.sky.sunSize + config.sky.sunEdgeSoftness);
  const sunDisc = smoothstep(sunOuter, sunInner, sunAlignment);
  const sunGlow = pow(sunAlignment, config.sky.sunGlowFalloff)
    .mul(look.sunGlowIntensity);
  color = color.add(look.sunGlowColor.mul(sunGlow));
  color = mix(color, look.sunColor.mul(look.sunEmission), sunDisc);

  const cloud = cloudCoverageNode({
    config,
    look,
    time,
    direction,
    cameraWorldPosition,
  });
  const cloudMask = cloud.coverage.mul(look.cloudOpacity);
  const cloudEdge = smoothstep(0.15, 0.85, cloud.shape);
  const cloudRim = pow(sunAlignment, config.sky.cloudRimFalloff)
    .mul(config.sky.cloudRimStrength)
    .mul(cloudEdge);
  const litCloud = litCloudColorNode({
    cloud,
    look,
    direction,
    sunDirection,
    sunAlignment,
    presence: sunPresence,
    horizonColor: color,
    rim: look.cloudRim.mul(cloudRim),
    cloudFloor: config.sky.cloudFloor,
    settings: cloudLighting,
  });
  color = mix(color, litCloud, cloudMask);

  // Night bodies: a star field and a moon disc, added over the gradient and hidden
  // by cloud. `night` is the active look's own flag (matchSkyLooks owns it), so a
  // moonlit preset shows them and a daylight one does not, whether the look came
  // from the Time selector or the day/night cycle. Both compile to nothing when
  // disabled, leaving the material byte-for-byte the plain sky.
  const stars = config.sky?.stars;
  const moon = config.sky?.stars?.moon;
  if (night && (stars?.enabled !== false || moon?.enabled !== false)) {
    const clear = oneMinus(cloudMask).mul(night.clamp(0, 1));
    if (stars?.enabled !== false) {
      const starRadiance = createStarFieldNode({
        direction,
        time,
        density: stars?.density ?? STAR_FIELD_DEFAULTS.density,
        presence: stars?.presence ?? STAR_FIELD_DEFAULTS.presence,
        magnitudePower: stars?.magnitudePower ?? STAR_FIELD_DEFAULTS.magnitudePower,
        rotationDegreesPerSecond:
          stars?.rotationDegreesPerSecond ?? STAR_FIELD_DEFAULTS.rotationDegreesPerSecond,
        brightness: stars?.brightness ?? STAR_FIELD_DEFAULTS.brightness,
      });
      color = color.add(starRadiance.mul(clear));
    }
    if (moon?.enabled !== false) {
      color = color.add(createMoonDiscNode({
        direction,
        moonDirection,
        illumination: moonIllumination,
        mask: clear,
        size: moon?.size,
        softness: moon?.softness,
        emission: moon?.emission,
        color: moon?.color,
      }));
    }
  }

  // Fogged dome: wholly at the horizon, half at the zenith, so the far trees and
  // the sky behind them are one murk; a whiteout carries it to the zenith too.
  color = mix(color, look.fogColor, look.skyFog.mul(oneMinus(
    smoothstep(0, 0.9, direction.y).mul(oneMinus(look.whiteout).mul(0.5)))));

  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  // Snow country stops the exposure down for the ground; the sky keeps most of
  // its brightness, or the alpine zenith turned a garish saturated blue.
  material.colorNode = max(color, vec3(0)).mul(exposureCompensation);
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  return material;
}

function createCloudTransmissionMaterial({
  config,
  look,
  time,
  cloudOcclusion,
  cameraWorldPosition,
}) {
  const direction = normalize(positionLocal);
  const { coverage } = cloudCoverageNode({
    config,
    look,
    time,
    direction,
    cameraWorldPosition,
  });
  const transmission = oneMinus(
    coverage.mul(cloudOcclusion),
  );
  const material = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide });
  material.colorNode = vec3(transmission);
  material.depthTest = false;
  material.depthWrite = false;
  material.fog = false;
  material.toneMapped = false;
  return material;
}

export class StylizedSkyView {
  constructor({ terrainView, config }) {
    this.terrainView = terrainView;
    this.config = config;
    this.time = frameUniform(0);
    this.cameraWorldPosition = uniform(new THREE.Vector2());
    /** Sunlight a cloud takes away; each look sets it (setCloudShadowStrength). */
    this.cloudShadowStrength = config.sky.cloudShadows?.strength ?? 0;
    this.cloudOcclusion = frameUniform(
      config.sky.godRays?.cloudOcclusion ?? config.sky.cloudOpacity,
    );
    this.sunDirectionValue = directionFromAngles(config.sky.sunElevation, config.sky.sunAzimuth);
    // Live: a new time of day turns this vector in place (applyLook), and every
    // material holding the uniform follows.
    this.sunDirection = frameUniform(this.sunDirectionValue);
    this.look = resolveSkyLook(config.sky);
    this.configuredLook = resolveSkyLook(config.sky, 'configured');
    this.lookUniforms = createSkyLookUniforms(this.look);
    // Night bodies. `night` follows the active look, so choosing a moonlit preset
    // (or the cycle reaching one) is what lights the stars; the moon's direction
    // and phase are driven by the day/night cycle when it runs, and otherwise
    // stand at the fixed angles in the config so a manually chosen night still has
    // a moon.
    this.night = frameUniform(this.look.nightness ?? (this.look.night ? 1 : 0));
    const moonConfig = config.sky?.stars?.moon ?? {};
    this.moonDirectionValue = directionFromAngles(
      moonConfig.elevation ?? 25,
      moonConfig.azimuth ?? 20,
    );
    this.moonDirection = frameUniform(this.moonDirectionValue);
    this.moonIllumination = frameUniform(moonConfig.illumination ?? 1);
    this.fogDensityScale = 1;
    /** The configured exposure; a look scales it (snow country stops down). */
    this.baseExposure = terrainView.renderer?.toneMappingExposure ?? 1;
    this.baseFogDensity = config.sky.fogDensity;
    /** 1 / the scene exposure scale, mostly (SKY_EXPOSURE_FOLLOW): see createSkyMaterial. */
    this.exposureCompensation = frameUniform(1);
    this.geometry = new THREE.SphereGeometry(1, 64, 32);
    this.material = createSkyMaterial({
      config,
      look: this.lookUniforms,
      time: this.time,
      sunDirection: this.sunDirection,
      cameraWorldPosition: this.cameraWorldPosition,
      night: this.night,
      moonDirection: this.moonDirection,
      moonIllumination: this.moonIllumination,
      exposureCompensation: this.exposureCompensation,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.scale.setScalar(config.sky.radius);
    this.mesh.renderOrder = -1000;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'stylized-sky-dome';
    terrainView.scene.add(this.mesh);
    this.cloudMaskScene = new THREE.Scene();
    this.cloudMaskMaterial = createCloudTransmissionMaterial({
      config,
      look: this.lookUniforms,
      time: this.time,
      cloudOcclusion: this.cloudOcclusion,
      cameraWorldPosition: this.cameraWorldPosition,
    });
    this.cloudMaskMesh = new THREE.Mesh(this.geometry, this.cloudMaskMaterial);
    this.cloudMaskMesh.scale.setScalar(config.sky.radius);
    this.cloudMaskMesh.frustumCulled = false;
    this.cloudMaskMesh.name = 'stylized-cloud-transmission-dome';
    this.cloudMaskScene.add(this.cloudMaskMesh);
    terrainView.godRays.setCloudMaskScene(this.cloudMaskScene, {
      cloudOcclusionUniform: this.cloudOcclusion,
    });

    // This rig is the scene's single lighting authority. Evict any fallback
    // lighting added before it was constructed (see `ObjectView`), otherwise the
    // world runs a second unshadowed sun from a different direction and every
    // building reads flat.
    for (const child of [...terrainView.scene.children]) {
      if (child.userData?.fallbackLighting) terrainView.scene.remove(child);
    }

    this.hemisphere = new THREE.HemisphereLight(
      skyAmbientColor(this.look),
      config.sky.groundLightColor,
      config.sky.ambientIntensity,
    );
    this.directional = new THREE.DirectionalLight(
      config.sky.directionalColor,
      config.sky.directionalIntensity,
    );
    this.directional.castShadow = config.sky.shadows;
    this.directional.shadow.mapSize.set(config.sky.shadowMapSize, config.sky.shadowMapSize);
    this.directional.shadow.bias = config.sky.shadowBias;
    this.directional.shadow.normalBias = config.sky.shadowNormalBias;
    this.directional.shadow.radius = config.sky.shadowRadius ?? 2.4;
    this.directional.shadow.camera.near = 1;
    this.directional.shadow.camera.far = config.sky.shadowDistance * 2;
    const extent = config.sky.shadowDistance;
    this.directional.shadow.camera.left = -extent;
    this.directional.shadow.camera.right = extent;
    this.directional.shadow.camera.top = extent;
    this.directional.shadow.camera.bottom = -extent;
    terrainView.scene.add(this.hemisphere, this.directional, this.directional.target);
    this.cascades = config.sky.shadows && config.enhancements?.shadowCascades === 2
      ? new CascadedSunShadows(this.directional, config.sky.shadowDistance) : null;
    terrainView.godRays.setVolumetricLight(this.directional);
    terrainView.scene.fog = new THREE.FogExp2(config.sky.fogColor, config.sky.fogDensity);
    const sunHaze = resolveSunHazeConfig(config.sky);
    this.sunHazeFog = sunHaze.enabled ? new SunHazeFog({
      scene: terrainView.scene,
      skyFog: terrainView.scene.fog,
      sunDirection: this.sunDirection,
      glowColor: this.lookUniforms.sunGlowColor,
      settings: sunHaze,
    }) : null;
    // The soft outdoor HDR standard materials take their fill and reflections from.
    this.environment = applySceneEnvironment(terrainView.scene, config.sky.environment);
  }

  /**
   * A lightning flash, 0..1, from LightningScheduler: lights the cloud deck and
   * lifts the hemisphere ambient for the frame — uniform writes, no new light.
   * Call after the look is applied each frame; 0 restores the look's ambient.
   */
  setLightningFlash(flash) {
    lightningFlash.value = flash;
    this.hemisphere.intensity = this.look.ambientIntensity * (1 + 2.5 * flash);
  }

  setCloudShadowStrength(strength) {
    if (Number.isFinite(strength)) this.cloudShadowStrength = Math.max(0, Math.min(1, strength));
  }

  /**
   * Place the moon and its phase, from the day/night cycle: the cycle owns *when*
   * and *which body*; the sky still owns the light. A caller with no cycle leaves
   * these at the configured angles. The direction is in the dome's own convention
   * (`directionFromAngles`), the same one the presets and the cycle use.
   *
   * @param {{ moon: { elevation: number, azimuth: number }, moonIllumination?: number }} state
   */
  setCelestial(state) {
    if (!state?.moon) return;
    this.moonDirectionValue.copy(directionFromAngles(state.moon.elevation, state.moon.azimuth));
    this.moonDirection.value.copy(this.moonDirectionValue);
    if (Number.isFinite(state.moonIllumination)) {
      this.moonIllumination.value = Math.max(0, Math.min(1, state.moonIllumination));
    }
  }

  setRadius(radius) {
    if (Number.isFinite(radius) && radius > 0) {
      this.mesh.scale.setScalar(radius);
      this.cloudMaskMesh.scale.setScalar(radius);
    }
  }

  setFogDensity(density) {
    if (Number.isFinite(density) && density >= 0) this.baseFogDensity = density;
    if (this.terrainView.scene.fog) {
      this.terrainView.scene.fog.density = this.baseFogDensity * this.fogDensityScale;
    }
  }

  /**
   * Show a look (SkyLook): sky colours, sun and lights, fog, cloud shadows.
   * The sun vector turns in place, and the god rays' shared copy with it.
   */
  applyLook(look) {
    this.look = look;
    this.night.value = look.nightness ?? (look.night ? 1 : 0);
    writeSkyLookUniforms(this.lookUniforms, look);
    this.sunDirectionValue.copy(directionFromAngles(look.sunElevation, look.sunAzimuth));
    this.terrainView.godRays.sunDirection?.copy(this.sunDirectionValue);
    this.terrainView.godRays.setLight?.(
      look.directionalColor,
      look.directionalIntensity / Math.max(1e-4, this.configuredLook.directionalIntensity),
    );
    skyAmbientColor(look, this.hemisphere.color);
    this.hemisphere.groundColor.set(look.groundLightColor);
    this.hemisphere.intensity = look.ambientIntensity;
    this.directional.color.set(look.directionalColor);
    this.directional.intensity = look.directionalIntensity;
    this.directional.shadow.radius = look.shadowRadius;
    this.terrainView.scene.fog?.color.set(look.fogColor);
    this.fogDensityScale = look.fogDensityScale;
    this.setFogDensity();
    this.setCloudShadowStrength(look.cloudShadowStrength);
    updateSkyLight(look, this.configuredLook);
    this.environment.setLightScale(environmentLightScale(look, this.configuredLook));
    updateSnowLight(look);
    // Snow country stops the exposure down (sceneExposure). While the post
    // graph owns the output it reads the scale itself and the renderer stays
    // at its neutral 1, so only write the renderer when it tone-maps.
    writeLookGrade(look);
    sceneExposure.scale = Number.isFinite(look.exposure) ? look.exposure : 1;
    this.exposureCompensation.value = sceneExposure.scale ** -(1 - SKY_EXPOSURE_FOLLOW);
    const renderer = this.terrainView.renderer;
    if (renderer && renderer.toneMapping !== THREE.NoToneMapping) {
      renderer.toneMappingExposure = this.baseExposure * sceneExposure.scale;
    }
  }

  update(timestamp, camera) {
    if (!camera) return;
    const timeSeconds = timestamp / 1000;
    this.time.value = timeSeconds;
    this.terrainView.godRays.setTime(timeSeconds);
    const canonicalCamera = this.terrainView.floatingOrigin.toCanonical(
      camera.position.x,
      camera.position.z,
    );
    // Wrapped in double precision: raw canonical metres overflow the cloud
    // hash's float32 range on a planet-scale world (see CloudShadow).
    const worldScale = this.config.sky.cloudWorldScale;
    this.cameraWorldPosition.value.set(
      wrapCloudCoordinate(canonicalCamera.x, worldScale),
      wrapCloudCoordinate(canonicalCamera.z, worldScale),
    );
    updateCloudShadows({
      timeSeconds,
      cameraRender: camera.position,
      cameraCanonical: canonicalCamera,
      worldScale,
      strength: this.cloudShadowStrength,
      sunDirection: this.sunDirectionValue,
      sky: this.config.sky,
      cloudDensity: this.look.cloudDensity,
      cloudSharpness: this.look.cloudSharpness,
    });
    this.sunHazeFog?.sync({
      sunPresence: Math.min(1, this.look.sunEmission / Math.max(1e-4, this.config.sky.sunEmission))
        * (1 - (1 - MOONLIGHT_SHARE) * (this.look.nightness ?? (this.look.night ? 1 : 0))),
      densityScale: this.fogDensityScale,
    });
    this.mesh.position.copy(camera.position);
    this.cloudMaskMesh.position.copy(camera.position);
    this.directional.position.copy(camera.position).addScaledVector(
      this.sunDirectionValue,
      this.config.sky.lightDistance,
    );
    this.directional.target.position.copy(camera.position);
    this.directional.target.updateMatrixWorld();
  }

  dispose() {
    this.cascades?.dispose();
    this.environment?.dispose();
    this.terrainView.scene.remove(
      this.mesh,
      this.hemisphere,
      this.directional,
      this.directional.target,
    );
    this.geometry.dispose();
    this.material.dispose();
    this.cloudMaskMaterial.dispose();
    this.sunHazeFog?.dispose();
    this.terrainView.scene.fog = null;
    this.directional.dispose();
  }
}
