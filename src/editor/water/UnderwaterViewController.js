import * as THREE from 'three/webgpu';
import { validateUnderwaterConfig } from './UnderwaterConfig.js';
import { advanceUnderwaterBlend, mixNumber } from './UnderwaterTransition.js';
import { resolveWaterQualityFeatures } from './WaterQuality.js';
import { UnderwaterCausticsPostProcess } from './UnderwaterCausticsPostProcess.js';

const MAX_DELTA_SECONDS = 0.1;
const SKY_HIDE_THRESHOLD = 0.98;

function cloneColor(value, fallback) {
  return value?.isColor ? value.clone() : new THREE.Color(fallback);
}

export class UnderwaterViewController {
  constructor({ terrainView, playerController, config }) {
    this.terrainView = terrainView;
    this.playerController = playerController;
    this.skyMesh = terrainView.scene.getObjectByName('stylized-sky-dome') ?? null;
    this.cloudMaskMesh = terrainView.godRays?.cloudMaskScene
      ?.getObjectByName('stylized-cloud-transmission-dome') ?? null;
    this.hemisphere = terrainView.scene.children.find((child) => child.isHemisphereLight) ?? null;
    this.directional = terrainView.scene.children.find((child) => child.isDirectionalLight) ?? null;
    this.config = validateUnderwaterConfig(config);
    this.scene = terrainView.scene;
    this.camera = playerController.camera;
    this.blend = 0;
    this.lastTimestamp = null;
    this.surfaceBackground = cloneColor(this.scene.background, '#0a100c');
    this.surfaceFogColor = cloneColor(this.scene.fog?.color, '#9ab4c0');
    this.surfaceFogDensity = this.scene.fog?.density ?? 0;
    // Latch existence once. Diving creates a temporary FogExp2; re-reading
    // existence from the live scene after surfacing would leak that fog forever.
    this.originalFogExists = Boolean(this.scene.fog?.isFogExp2);
    this.surfaceNearPlane = this.camera.near;
    this.surfaceHemisphereIntensity = this.hemisphere?.intensity ?? 0;
    this.surfaceDirectionalIntensity = this.directional?.intensity ?? 0;
    this.surfaceSkyVisible = this.skyMesh?.visible ?? true;
    this.surfaceCloudVisible = this.cloudMaskMesh?.visible ?? true;
    this.godRays = terrainView.godRays ?? null;
    this.originalGodRaysRender = this.godRays?.render ?? null;
    if (this.godRays && this.originalGodRaysRender) {
      this.godRays.render = (camera) => (
        this.blend > 0 || this.playerController.getStatus().headSubmerged
          ? false
          : this.originalGodRaysRender.call(this.godRays, camera)
      );
    }
    this.underwaterBackground = new THREE.Color(config.backgroundColor);
    this.underwaterFogColor = new THREE.Color(config.fogColor);
    this.appliedBackground = new THREE.Color();
    this.appliedFogColor = new THREE.Color();
    this.appliedFogDensity = this.surfaceFogDensity;

    const waterVisual = terrainView.stylizedConfig?.water ?? {};
    const quality = resolveWaterQualityFeatures(waterVisual);
    this.causticsPostProcess = quality.projectedCaustics && waterVisual.projectedCaustics
      ? new UnderwaterCausticsPostProcess({
        renderer: terrainView.renderer,
        scene: terrainView.scene,
        config: waterVisual.projectedCaustics,
        qualityStrength: quality.projectedCausticStrength,
      })
      : null;
    this.originalTerrainRender = terrainView.render;
    this.originalTerrainPrewarm = terrainView.prewarmPostProcessing;
    this.causticsRenderHook = null;
    this.causticsPrewarmHook = null;
    if (this.causticsPostProcess) {
      this.causticsRenderHook = (camera) => {
        if (this.causticsPostProcess.render(camera)) return undefined;
        return this.originalTerrainRender.call(terrainView, camera);
      };
      this.causticsPrewarmHook = (camera) => {
        const original = this.originalTerrainPrewarm?.call(terrainView, camera) ?? false;
        const projected = this.causticsPostProcess.prewarm(camera);
        return Boolean(original || projected);
      };
      terrainView.render = this.causticsRenderHook;
      terrainView.prewarmPostProcessing = this.causticsPrewarmHook;
    }
  }

  captureSurfaceEnvironment() {
    if (this.blend > 0) return;
    this.surfaceBackground.copy(cloneColor(this.scene.background, '#0a100c'));
    if (this.originalFogExists && this.scene.fog?.isFogExp2) {
      this.surfaceFogColor.copy(this.scene.fog.color);
      this.surfaceFogDensity = this.scene.fog.density;
    }
    this.surfaceNearPlane = this.camera.near;
    if (this.hemisphere) this.surfaceHemisphereIntensity = this.hemisphere.intensity;
    if (this.directional) this.surfaceDirectionalIntensity = this.directional.intensity;
    if (this.skyMesh) this.surfaceSkyVisible = this.skyMesh.visible;
    if (this.cloudMaskMesh) this.surfaceCloudVisible = this.cloudMaskMesh.visible;
  }

  applyEnvironment() {
    this.appliedBackground.copy(this.surfaceBackground).lerp(this.underwaterBackground, this.blend);
    this.scene.background = this.appliedBackground;

    if (!this.scene.fog?.isFogExp2) {
      this.scene.fog = new THREE.FogExp2(this.surfaceFogColor, this.surfaceFogDensity);
    }
    this.appliedFogColor.copy(this.surfaceFogColor).lerp(this.underwaterFogColor, this.blend);
    this.scene.fog.color.copy(this.appliedFogColor);
    this.appliedFogDensity = mixNumber(
      this.surfaceFogDensity,
      this.config.fogDensity,
      this.blend,
    );
    this.scene.fog.density = this.appliedFogDensity;

    const lightBlend = mixNumber(1, this.config.lightScale, this.blend);
    if (this.hemisphere) {
      this.hemisphere.intensity = this.surfaceHemisphereIntensity * lightBlend;
    }
    if (this.directional) {
      this.directional.intensity = this.surfaceDirectionalIntensity * lightBlend;
    }
    const showSky = this.blend < SKY_HIDE_THRESHOLD;
    if (this.skyMesh) this.skyMesh.visible = showSky && this.surfaceSkyVisible;
    if (this.cloudMaskMesh) this.cloudMaskMesh.visible = showSky && this.surfaceCloudVisible;

    const nearPlane = mixNumber(this.surfaceNearPlane, this.config.nearPlane, this.blend);
    if (Math.abs(this.camera.near - nearPlane) > 1e-6) {
      this.camera.near = nearPlane;
      this.camera.updateProjectionMatrix();
    }
  }

  update(timestamp) {
    const current = Number.isFinite(timestamp) ? timestamp : performance.now();
    const deltaSeconds = this.lastTimestamp === null
      ? 0
      : Math.min(MAX_DELTA_SECONDS, Math.max(0, (current - this.lastTimestamp) / 1000));
    this.lastTimestamp = current;
    if (this.blend > 0
        && this.scene.fog?.isFogExp2
        && Math.abs(this.scene.fog.density - this.appliedFogDensity) > 1e-6) {
      this.surfaceFogDensity = this.scene.fog.density;
    }
    const status = this.playerController.getStatus();
    const submerged = status.enabled && status.headSubmerged;
    if (this.blend === 0) this.captureSurfaceEnvironment();
    this.blend = advanceUnderwaterBlend(
      this.blend,
      submerged,
      deltaSeconds,
      this.config.transitionSeconds,
    );
    const causticsState = { blend: this.blend };
    if (status.headSubmerged || status.waterDepth > 0) {
      causticsState.surfaceHeight = status.waterSurfaceHeight;
    }
    this.causticsPostProcess?.update(causticsState);
    this.applyEnvironment();
    return this.blend;
  }

  getStatus() {
    return Object.freeze({
      blend: this.blend,
      active: this.blend > 0,
      submerged: this.playerController.getStatus().headSubmerged,
      projectedCaustics: this.causticsPostProcess?.getStatus() ?? null,
    });
  }

  restoreSurfaceEnvironment() {
    this.blend = 0;
    this.causticsPostProcess?.update({ blend: 0 });
    this.scene.background = this.surfaceBackground;
    if (this.originalFogExists) {
      if (!this.scene.fog?.isFogExp2) {
        this.scene.fog = new THREE.FogExp2(this.surfaceFogColor, this.surfaceFogDensity);
      }
      this.scene.fog.color.copy(this.surfaceFogColor);
      this.scene.fog.density = this.surfaceFogDensity;
    } else {
      this.scene.fog = null;
    }
    if (this.hemisphere) this.hemisphere.intensity = this.surfaceHemisphereIntensity;
    if (this.directional) this.directional.intensity = this.surfaceDirectionalIntensity;
    if (this.skyMesh) this.skyMesh.visible = this.surfaceSkyVisible;
    if (this.cloudMaskMesh) this.cloudMaskMesh.visible = this.surfaceCloudVisible;
    if (Math.abs(this.camera.near - this.surfaceNearPlane) > 1e-6) {
      this.camera.near = this.surfaceNearPlane;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose() {
    this.restoreSurfaceEnvironment();
    if (this.godRays && this.originalGodRaysRender) {
      this.godRays.render = this.originalGodRaysRender;
    }
    if (this.causticsPostProcess) {
      if (this.terrainView.render === this.causticsRenderHook) {
        this.terrainView.render = this.originalTerrainRender;
      }
      if (this.terrainView.prewarmPostProcessing === this.causticsPrewarmHook) {
        this.terrainView.prewarmPostProcessing = this.originalTerrainPrewarm;
      }
      this.causticsPostProcess.dispose();
      this.causticsPostProcess = null;
      this.causticsRenderHook = null;
      this.causticsPrewarmHook = null;
    }
    this.lastTimestamp = null;
  }
}
