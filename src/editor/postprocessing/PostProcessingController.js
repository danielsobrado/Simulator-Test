import * as THREE from 'three/webgpu';
import {
  applyPostProcessingPreset,
  normalizePostProcessingSettings,
  patchPostProcessingSettings,
} from './PostProcessingConfig.js';
import { PostProcessingGraph } from './PostProcessingGraph.js';

function loadStoredSettings(defaults) {
  if (typeof localStorage === 'undefined' || !defaults.persistenceKey) return defaults;
  try {
    const value = JSON.parse(localStorage.getItem(defaults.persistenceKey));
    return normalizePostProcessingSettings(defaults, value ?? defaults);
  } catch (error) {
    console.warn('Ignoring invalid stored post-processing settings.', error);
    return structuredClone(defaults);
  }
}

function persistSettings(settings) {
  if (typeof localStorage === 'undefined' || !settings.persistenceKey) return;
  try {
    localStorage.setItem(settings.persistenceKey, JSON.stringify(settings));
  } catch (error) {
    console.warn('Could not persist post-processing settings.', error);
  }
}

function topologyChanged(previous, next) {
  return previous.enabled !== next.enabled
    || previous.antiAliasing.enabled !== next.antiAliasing.enabled
    || previous.bloom.enabled !== next.bloom.enabled
    || previous.toneMapping.enabled !== next.toneMapping.enabled
    || previous.toneMapping.mode !== next.toneMapping.mode
    || previous.sharpen.enabled !== next.sharpen.enabled
    || previous.ssr.enabled !== next.ssr.enabled
    || previous.ssr.quality !== next.ssr.quality
    || previous.ssr.roughnessCutoff !== next.ssr.roughnessCutoff
    || previous.depthOfField.enabled !== next.depthOfField.enabled
    || previous.vignette.enabled !== next.vignette.enabled
    || previous.grain.enabled !== next.grain.enabled
    || previous.diagnostics.enabled !== next.diagnostics.enabled
    || previous.diagnostics.debugView !== next.diagnostics.debugView;
}

export class PostProcessingController {
  constructor({ renderer, scene, godRays, config }) {
    this.renderer = renderer;
    this.scene = scene;
    this.godRays = godRays;
    this.defaults = structuredClone(config);
    this.settings = loadStoredSettings(this.defaults);
    this.graph = null;
    this.camera = null;
    this.failed = false;
    this.listeners = new Set();
    this.lastGodRaysEnabled = null;
    this.lastGodRaysTechnique = null;
    this.lastVolumetricReady = null;
    this.savedRendererState = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    const snapshot = this.getSettings();
    for (const listener of this.listeners) listener(snapshot);
  }

  getSettings() {
    return structuredClone(this.settings);
  }

  commitSettings(previous, next, reason) {
    this.settings = next;
    persistSettings(next);
    if (topologyChanged(previous, next)) this.invalidate(reason);
    else this.graph?.updateSettings(next);
    this.emit();
    return this.getSettings();
  }

  setSettings(patch) {
    const previous = this.settings;
    return this.commitSettings(
      previous,
      patchPostProcessingSettings(this.defaults, previous, patch),
      'settings',
    );
  }

  applyPreset(presetName) {
    const previous = this.settings;
    return this.commitSettings(
      previous,
      applyPostProcessingPreset(this.defaults, previous, presetName),
      'preset',
    );
  }

  reset() {
    const previous = this.settings;
    return this.commitSettings(previous, structuredClone(this.defaults), 'reset');
  }

  setRendererOwnership(enabled) {
    if (enabled && this.savedRendererState === null) {
      this.savedRendererState = {
        toneMapping: this.renderer.toneMapping,
        exposure: this.renderer.toneMappingExposure,
      };
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1;
      return;
    }
    if (!enabled && this.savedRendererState !== null) {
      this.renderer.toneMapping = this.savedRendererState.toneMapping;
      this.renderer.toneMappingExposure = this.savedRendererState.exposure;
      this.savedRendererState = null;
    }
  }

  invalidate(reason = 'unknown') {
    this.disposeGraph();
    this.failed = false;
    this.lastInvalidationReason = reason;
  }

  graphNeedsRefresh(camera) {
    const volumetricReady = this.godRays.technique === 'volumetric'
      && this.godRays.canBuildVolumetricPipeline();
    return this.graph === null
      || this.camera !== camera
      || this.lastGodRaysEnabled !== this.godRays.enabled
      || this.lastGodRaysTechnique !== this.godRays.technique
      || this.lastVolumetricReady !== volumetricReady;
  }

  createGraph(camera) {
    this.graph = new PostProcessingGraph({
      renderer: this.renderer,
      scene: this.scene,
      godRays: this.godRays,
      camera,
      settings: this.settings,
    });
    this.camera = camera;
    this.lastGodRaysEnabled = this.godRays.enabled;
    this.lastGodRaysTechnique = this.godRays.technique;
    this.lastVolumetricReady = this.godRays.technique === 'volumetric'
      && this.godRays.canBuildVolumetricPipeline();
  }

  render(camera) {
    if (!this.settings.enabled || this.failed) {
      this.setRendererOwnership(false);
      return false;
    }
    this.setRendererOwnership(true);
    try {
      if (this.graphNeedsRefresh(camera)) {
        this.disposeGraph();
        this.createGraph(camera);
      }
      this.graph.render();
      return true;
    } catch (error) {
      console.error('Post-processing pipeline failed; restoring the base renderer.', error);
      this.failed = true;
      this.setRendererOwnership(false);
      this.disposeGraph();
      return false;
    }
  }

  prewarm(camera) {
    if (!this.settings.enabled) return false;
    return this.render(camera);
  }

  resize() {
    this.invalidate('resize');
  }

  disposeGraph() {
    this.graph?.dispose();
    this.graph = null;
    this.camera = null;
  }

  dispose() {
    this.disposeGraph();
    this.setRendererOwnership(false);
    this.listeners.clear();
  }
}
