import { POST_PROCESSING_PRESET_NAMES, mergePreset } from './PostProcessingPresets.js';

const TONE_MAPPING_MODES = Object.freeze(['agx', 'aces', 'neutral', 'none']);
const SSR_QUALITIES = Object.freeze(['low', 'medium', 'high']);
const DEBUG_VIEWS = Object.freeze([
  'final',
  'hdr',
  'depth',
  'normal',
  'velocity',
  'metalrough',
  'bloom',
  'ssr',
  'taa',
]);

const LIMITS = Object.freeze({
  'antiAliasing.depthThreshold': [0.00001, 0.02],
  'antiAliasing.edgeDepthDiff': [0.00001, 0.05],
  'antiAliasing.maxVelocityPixels': [8, 256],
  'bloom.intensity': [0, 1.5],
  'bloom.radius': [0, 1],
  'bloom.threshold': [0.25, 8],
  'bloom.softKnee': [0.001, 1],
  'toneMapping.exposure': [0.25, 2.5],
  'toneMapping.contrast': [0.8, 1.2],
  'toneMapping.saturation': [0.8, 1.2],
  'sharpen.amount': [0, 0.8],
  'ssr.intensity': [0, 1],
  'ssr.maxDistance': [10, 200],
  'ssr.thickness': [0.05, 2],
  'ssr.edgeFade': [0, 0.25],
  'ssr.roughnessCutoff': [0, 0.8],
  'depthOfField.focusDistance': [0.5, 2000],
  'depthOfField.focalLength': [1, 1000],
  'depthOfField.bokehScale': [0, 8],
  'vignette.intensity': [0, 0.5],
  'vignette.innerRadius': [0, 1],
  'vignette.outerRadius': [0.1, 2],
  'grain.intensity': [0, 0.05],
});

const BOOLEAN_PATHS = Object.freeze([
  'enabled',
  'antiAliasing.enabled',
  'antiAliasing.subpixelCorrection',
  'bloom.enabled',
  'toneMapping.enabled',
  'sharpen.enabled',
  'ssr.enabled',
  'depthOfField.enabled',
  'vignette.enabled',
  'grain.enabled',
  'diagnostics.enabled',
]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function readPath(object, path) {
  return path.split('.').reduce((current, key) => current?.[key], object);
}

function writePath(object, path, value) {
  const parts = path.split('.');
  const leaf = parts.pop();
  let current = object;
  for (const part of parts) current = current[part];
  current[leaf] = value;
}

function mergeKnown(defaults, source) {
  const result = structuredClone(defaults);
  if (!source || typeof source !== 'object') return result;
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const sourceValue = source[key];
    if (sourceValue === undefined) continue;
    if (defaultValue && typeof defaultValue === 'object' && !Array.isArray(defaultValue)) {
      result[key] = mergeKnown(defaultValue, sourceValue);
    } else {
      result[key] = sourceValue;
    }
  }
  return result;
}

export function normalizePostProcessingSettings(defaults, source = defaults) {
  const settings = mergeKnown(defaults, source);
  for (const path of BOOLEAN_PATHS) {
    writePath(settings, path, Boolean(readPath(settings, path)));
  }
  for (const [path, [minimum, maximum]] of Object.entries(LIMITS)) {
    const value = Number(readPath(settings, path));
    const fallback = Number(readPath(defaults, path));
    writePath(settings, path, clamp(Number.isFinite(value) ? value : fallback, minimum, maximum));
  }
  if (!POST_PROCESSING_PRESET_NAMES.includes(settings.preset)) settings.preset = defaults.preset;
  if (!TONE_MAPPING_MODES.includes(settings.toneMapping.mode)) {
    settings.toneMapping.mode = defaults.toneMapping.mode;
  }
  if (!SSR_QUALITIES.includes(settings.ssr.quality)) settings.ssr.quality = defaults.ssr.quality;
  if (!DEBUG_VIEWS.includes(settings.diagnostics.debugView)) {
    settings.diagnostics.debugView = defaults.diagnostics.debugView;
  }
  if (settings.vignette.outerRadius <= settings.vignette.innerRadius) {
    settings.vignette.outerRadius = Math.min(2, settings.vignette.innerRadius + 0.1);
  }
  return settings;
}

export function applyPostProcessingPreset(defaults, settings, presetName) {
  return normalizePostProcessingSettings(defaults, mergePreset(settings, presetName));
}

export function patchPostProcessingSettings(defaults, settings, patch) {
  const merged = mergeKnown(settings, patch);
  merged.preset = patch?.preset ?? 'custom';
  return normalizePostProcessingSettings(defaults, merged);
}

export function applyPostProcessingConfig(config, source) {
  const defaults = normalizePostProcessingSettings(source, source);
  defaults.persistenceKey = `${config.storage?.key ?? 'drusniel'}:post-processing`;
  config.stylizedSurface ??= {};
  config.stylizedSurface.postProcessing = defaults;
  return defaults;
}
