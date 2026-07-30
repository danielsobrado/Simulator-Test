/**
 * Immutable post-processing settings: defaults, clamping, unknown-key warnings,
 * and coalesced UI updates (at most one flush per animation frame).
 */

export const POST_PROCESSING_PRESET_IDS = Object.freeze([
  'off',
  'low',
  'balanced',
  'high',
  'ultra',
  'custom',
]);

export const ANTI_ALIASING_MODES = Object.freeze(['traa', 'traau']);
export const TONE_MAPPING_MODES = Object.freeze(['agx', 'aces', 'neutral', 'none']);
export const DOF_FOCUS_MODES = Object.freeze([
  'player',
  'selection',
  'centre-raycast',
  'manual',
]);
export const DEBUG_VIEWS = Object.freeze([
  'final',
  'hdr-colour',
  'depth',
  'normal',
  'velocity',
  'reactive-mask',
  'reflection-class',
  'bloom',
  'ssr',
  'taa-history',
  'taa-rejection',
]);

export const POST_PROCESSING_RANGES = Object.freeze({
  renderScale: Object.freeze({ min: 0.67, max: 1.0 }),
  feedback: Object.freeze({ min: 0.70, max: 0.97 }),
  varianceGamma: Object.freeze({ min: 0.75, max: 2.50 }),
  bloomIntensity: Object.freeze({ min: 0.0, max: 1.50 }),
  bloomThreshold: Object.freeze({ min: 0.50, max: 8.0 }),
  bloomKnee: Object.freeze({ min: 0.05, max: 3.0 }),
  bloomLevels: Object.freeze({ min: 2, max: 6, integer: true }),
  exposure: Object.freeze({ min: 0.25, max: 2.50 }),
  contrast: Object.freeze({ min: 0.80, max: 1.20 }),
  saturation: Object.freeze({ min: 0.80, max: 1.20 }),
  sharpenAmount: Object.freeze({ min: 0.0, max: 0.80 }),
  ssrResolutionScale: Object.freeze({ min: 0.25, max: 0.75 }),
  ssrMaxSteps: Object.freeze({ min: 8, max: 64, integer: true }),
  ssrBinarySteps: Object.freeze({ min: 0, max: 8, integer: true }),
  ssrMaxDistanceMeters: Object.freeze({ min: 10, max: 200 }),
  ssrThicknessMeters: Object.freeze({ min: 0.05, max: 2.0 }),
  ssrRoughnessCutoff: Object.freeze({ min: 0.0, max: 0.80 }),
  ssrIntensity: Object.freeze({ min: 0.0, max: 1.0 }),
  shaftResolutionScale: Object.freeze({ min: 0.25, max: 0.75 }),
  shaftSamples: Object.freeze({ min: 8, max: 48, integer: true }),
  shaftIntensity: Object.freeze({ min: 0.0, max: 2.0 }),
  dofManualFocusMeters: Object.freeze({ min: 0.5, max: 2000 }),
  dofMaxCoCPixels: Object.freeze({ min: 0, max: 8 }),
  vignetteIntensity: Object.freeze({ min: 0.0, max: 0.50 }),
  grainIntensity: Object.freeze({ min: 0.0, max: 0.05 }),
});

export const DEFAULT_POST_PROCESSING_SETTINGS = Object.freeze({
  enabled: true,
  preset: 'balanced',
  renderScale: 1.0,
  antiAliasing: Object.freeze({
    enabled: true,
    mode: 'traa',
    jitterSamples: 8,
    feedback: 0.90,
    varianceGamma: 1.25,
    depthRejectionMinMeters: 0.05,
    depthRejectionScale: 0.02,
    reactiveStrength: 0.90,
    motionRejectionPixels: 32,
    historyClampStrength: 1.0,
  }),
  bloom: Object.freeze({
    enabled: true,
    intensity: 0.18,
    threshold: 3.0,
    knee: 1.4,
    levels: 4,
    bloomBoost: 3.0,
  }),
  toneMapping: Object.freeze({
    enabled: true,
    mode: 'agx',
    exposure: 1.0,
    contrast: 1.0,
    saturation: 1.0,
  }),
  sharpen: Object.freeze({
    enabled: true,
    amount: 0.22,
  }),
  ssr: Object.freeze({
    enabled: false,
    resolutionScale: 0.5,
    maxSteps: 32,
    binarySteps: 5,
    maxDistanceMeters: 80,
    thicknessMeters: 0.35,
    roughnessCutoff: 0.45,
    intensity: 0.60,
    temporalFeedback: 0.85,
    edgeFade: 0.08,
  }),
  screenSpaceShafts: Object.freeze({
    enabled: true,
    resolutionScale: 0.5,
    samples: 24,
    intensity: 0.40,
    reach: 0.82,
    decay: 0.955,
    highSunFadeStartDegrees: 35,
    highSunFadeEndDegrees: 55,
  }),
  depthOfField: Object.freeze({
    enabled: false,
    focusMode: 'player',
    manualFocusMeters: 6.2,
    focusSmoothing: 4.0,
    maxCoCPixels: 3.5,
    taps: 16,
    nearStartRatio: 0.55,
    nearFullRatio: 0.16,
    farStartMeters: 130,
    farFullMeters: 620,
  }),
  vignette: Object.freeze({
    enabled: false,
    intensity: 0.12,
    innerRadius: 0.35,
    outerRadius: 1.05,
  }),
  grain: Object.freeze({
    enabled: false,
    intensity: 0.012,
  }),
  diagnostics: Object.freeze({
    enabled: false,
    debugView: 'final',
    showGpuTimings: false,
  }),
});

const KNOWN_ROOT_KEYS = new Set(Object.keys(DEFAULT_POST_PROCESSING_SETTINGS));

function clampNumber(value, range, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  let next = Math.min(range.max, Math.max(range.min, number));
  if (range.integer) next = Math.round(next);
  return next;
}

function clampBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  return fallback;
}

function pickEnum(value, allowed, fallback) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function warnUnknown(path, key, warnings) {
  const message = `Unknown post-processing setting ignored: ${path}.${key}`;
  warnings.push(message);
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(message);
  }
}

function cloneDefaults() {
  return structuredClone(DEFAULT_POST_PROCESSING_SETTINGS);
}

/**
 * Normalize and clamp a partial or full settings object.
 * Unknown keys are ignored with a warning. Invalid enums fall back to defaults.
 */
export function normalizePostProcessingSettings(input = {}, {
  warnings = [],
  markCustom = false,
} = {}) {
  const source = (input && typeof input === 'object' && !Array.isArray(input))
    ? input
    : {};
  const base = cloneDefaults();

  for (const key of Object.keys(source)) {
    if (key === '__markCustom') continue;
    if (!KNOWN_ROOT_KEYS.has(key)) warnUnknown('postProcessing', key, warnings);
  }

  base.enabled = clampBoolean(source.enabled, base.enabled);
  base.preset = pickEnum(source.preset, POST_PROCESSING_PRESET_IDS, base.preset);
  base.renderScale = clampNumber(
    source.renderScale,
    POST_PROCESSING_RANGES.renderScale,
    base.renderScale,
  );

  const aa = source.antiAliasing && typeof source.antiAliasing === 'object'
    ? source.antiAliasing
    : {};
  for (const key of Object.keys(aa)) {
    if (!(key in base.antiAliasing)) warnUnknown('postProcessing.antiAliasing', key, warnings);
  }
  base.antiAliasing = {
    enabled: clampBoolean(aa.enabled, base.antiAliasing.enabled),
    mode: pickEnum(aa.mode, ANTI_ALIASING_MODES, base.antiAliasing.mode),
    jitterSamples: clampNumber(aa.jitterSamples, { min: 1, max: 16, integer: true }, base.antiAliasing.jitterSamples),
    feedback: clampNumber(aa.feedback, POST_PROCESSING_RANGES.feedback, base.antiAliasing.feedback),
    varianceGamma: clampNumber(aa.varianceGamma, POST_PROCESSING_RANGES.varianceGamma, base.antiAliasing.varianceGamma),
    depthRejectionMinMeters: clampNumber(aa.depthRejectionMinMeters, { min: 0, max: 10 }, base.antiAliasing.depthRejectionMinMeters),
    depthRejectionScale: clampNumber(aa.depthRejectionScale, { min: 0, max: 1 }, base.antiAliasing.depthRejectionScale),
    reactiveStrength: clampNumber(aa.reactiveStrength, { min: 0, max: 1 }, base.antiAliasing.reactiveStrength),
    motionRejectionPixels: clampNumber(aa.motionRejectionPixels, { min: 1, max: 256 }, base.antiAliasing.motionRejectionPixels),
    historyClampStrength: clampNumber(aa.historyClampStrength, { min: 0, max: 2 }, base.antiAliasing.historyClampStrength),
  };

  const bloom = source.bloom && typeof source.bloom === 'object' ? source.bloom : {};
  for (const key of Object.keys(bloom)) {
    if (!(key in base.bloom)) warnUnknown('postProcessing.bloom', key, warnings);
  }
  base.bloom = {
    enabled: clampBoolean(bloom.enabled, base.bloom.enabled),
    intensity: clampNumber(bloom.intensity, POST_PROCESSING_RANGES.bloomIntensity, base.bloom.intensity),
    threshold: clampNumber(bloom.threshold, POST_PROCESSING_RANGES.bloomThreshold, base.bloom.threshold),
    knee: clampNumber(bloom.knee, POST_PROCESSING_RANGES.bloomKnee, base.bloom.knee),
    levels: clampNumber(bloom.levels, POST_PROCESSING_RANGES.bloomLevels, base.bloom.levels),
    bloomBoost: clampNumber(bloom.bloomBoost, { min: 0, max: 8 }, base.bloom.bloomBoost),
  };

  const tone = source.toneMapping && typeof source.toneMapping === 'object'
    ? source.toneMapping
    : {};
  for (const key of Object.keys(tone)) {
    if (!(key in base.toneMapping)) warnUnknown('postProcessing.toneMapping', key, warnings);
  }
  base.toneMapping = {
    enabled: clampBoolean(tone.enabled, base.toneMapping.enabled),
    mode: pickEnum(tone.mode, TONE_MAPPING_MODES, base.toneMapping.mode),
    exposure: clampNumber(tone.exposure, POST_PROCESSING_RANGES.exposure, base.toneMapping.exposure),
    contrast: clampNumber(tone.contrast, POST_PROCESSING_RANGES.contrast, base.toneMapping.contrast),
    saturation: clampNumber(tone.saturation, POST_PROCESSING_RANGES.saturation, base.toneMapping.saturation),
  };

  const sharpen = source.sharpen && typeof source.sharpen === 'object' ? source.sharpen : {};
  for (const key of Object.keys(sharpen)) {
    if (!(key in base.sharpen)) warnUnknown('postProcessing.sharpen', key, warnings);
  }
  base.sharpen = {
    enabled: clampBoolean(sharpen.enabled, base.sharpen.enabled),
    amount: clampNumber(sharpen.amount, POST_PROCESSING_RANGES.sharpenAmount, base.sharpen.amount),
  };

  const ssr = source.ssr && typeof source.ssr === 'object' ? source.ssr : {};
  for (const key of Object.keys(ssr)) {
    if (!(key in base.ssr)) warnUnknown('postProcessing.ssr', key, warnings);
  }
  base.ssr = {
    enabled: clampBoolean(ssr.enabled, base.ssr.enabled),
    resolutionScale: clampNumber(ssr.resolutionScale, POST_PROCESSING_RANGES.ssrResolutionScale, base.ssr.resolutionScale),
    maxSteps: clampNumber(ssr.maxSteps, POST_PROCESSING_RANGES.ssrMaxSteps, base.ssr.maxSteps),
    binarySteps: clampNumber(ssr.binarySteps, POST_PROCESSING_RANGES.ssrBinarySteps, base.ssr.binarySteps),
    maxDistanceMeters: clampNumber(ssr.maxDistanceMeters, POST_PROCESSING_RANGES.ssrMaxDistanceMeters, base.ssr.maxDistanceMeters),
    thicknessMeters: clampNumber(ssr.thicknessMeters, POST_PROCESSING_RANGES.ssrThicknessMeters, base.ssr.thicknessMeters),
    roughnessCutoff: clampNumber(ssr.roughnessCutoff, POST_PROCESSING_RANGES.ssrRoughnessCutoff, base.ssr.roughnessCutoff),
    intensity: clampNumber(ssr.intensity, POST_PROCESSING_RANGES.ssrIntensity, base.ssr.intensity),
    temporalFeedback: clampNumber(ssr.temporalFeedback, POST_PROCESSING_RANGES.feedback, base.ssr.temporalFeedback),
    edgeFade: clampNumber(ssr.edgeFade, { min: 0, max: 0.5 }, base.ssr.edgeFade),
  };

  const shafts = source.screenSpaceShafts && typeof source.screenSpaceShafts === 'object'
    ? source.screenSpaceShafts
    : {};
  for (const key of Object.keys(shafts)) {
    if (!(key in base.screenSpaceShafts)) {
      warnUnknown('postProcessing.screenSpaceShafts', key, warnings);
    }
  }
  base.screenSpaceShafts = {
    enabled: clampBoolean(shafts.enabled, base.screenSpaceShafts.enabled),
    resolutionScale: clampNumber(shafts.resolutionScale, POST_PROCESSING_RANGES.shaftResolutionScale, base.screenSpaceShafts.resolutionScale),
    samples: clampNumber(shafts.samples, POST_PROCESSING_RANGES.shaftSamples, base.screenSpaceShafts.samples),
    intensity: clampNumber(shafts.intensity, POST_PROCESSING_RANGES.shaftIntensity, base.screenSpaceShafts.intensity),
    reach: clampNumber(shafts.reach, { min: 0.1, max: 1 }, base.screenSpaceShafts.reach),
    decay: clampNumber(shafts.decay, { min: 0.5, max: 1 }, base.screenSpaceShafts.decay),
    highSunFadeStartDegrees: clampNumber(shafts.highSunFadeStartDegrees, { min: 0, max: 90 }, base.screenSpaceShafts.highSunFadeStartDegrees),
    highSunFadeEndDegrees: clampNumber(shafts.highSunFadeEndDegrees, { min: 0, max: 90 }, base.screenSpaceShafts.highSunFadeEndDegrees),
  };

  const dof = source.depthOfField && typeof source.depthOfField === 'object'
    ? source.depthOfField
    : {};
  for (const key of Object.keys(dof)) {
    if (!(key in base.depthOfField)) warnUnknown('postProcessing.depthOfField', key, warnings);
  }
  base.depthOfField = {
    enabled: clampBoolean(dof.enabled, base.depthOfField.enabled),
    focusMode: pickEnum(dof.focusMode, DOF_FOCUS_MODES, base.depthOfField.focusMode),
    manualFocusMeters: clampNumber(dof.manualFocusMeters, POST_PROCESSING_RANGES.dofManualFocusMeters, base.depthOfField.manualFocusMeters),
    focusSmoothing: clampNumber(dof.focusSmoothing, { min: 0, max: 32 }, base.depthOfField.focusSmoothing),
    maxCoCPixels: clampNumber(dof.maxCoCPixels, POST_PROCESSING_RANGES.dofMaxCoCPixels, base.depthOfField.maxCoCPixels),
    taps: clampNumber(dof.taps, { min: 4, max: 32, integer: true }, base.depthOfField.taps),
    nearStartRatio: clampNumber(dof.nearStartRatio, { min: 0, max: 1 }, base.depthOfField.nearStartRatio),
    nearFullRatio: clampNumber(dof.nearFullRatio, { min: 0, max: 1 }, base.depthOfField.nearFullRatio),
    farStartMeters: clampNumber(dof.farStartMeters, { min: 1, max: 5000 }, base.depthOfField.farStartMeters),
    farFullMeters: clampNumber(dof.farFullMeters, { min: 1, max: 10000 }, base.depthOfField.farFullMeters),
  };

  const vignette = source.vignette && typeof source.vignette === 'object' ? source.vignette : {};
  for (const key of Object.keys(vignette)) {
    if (!(key in base.vignette)) warnUnknown('postProcessing.vignette', key, warnings);
  }
  base.vignette = {
    enabled: clampBoolean(vignette.enabled, base.vignette.enabled),
    intensity: clampNumber(vignette.intensity, POST_PROCESSING_RANGES.vignetteIntensity, base.vignette.intensity),
    innerRadius: clampNumber(vignette.innerRadius, { min: 0, max: 2 }, base.vignette.innerRadius),
    outerRadius: clampNumber(vignette.outerRadius, { min: 0, max: 2 }, base.vignette.outerRadius),
  };

  const grain = source.grain && typeof source.grain === 'object' ? source.grain : {};
  for (const key of Object.keys(grain)) {
    if (!(key in base.grain)) warnUnknown('postProcessing.grain', key, warnings);
  }
  base.grain = {
    enabled: clampBoolean(grain.enabled, base.grain.enabled),
    intensity: clampNumber(grain.intensity, POST_PROCESSING_RANGES.grainIntensity, base.grain.intensity),
  };

  const diagnostics = source.diagnostics && typeof source.diagnostics === 'object'
    ? source.diagnostics
    : {};
  for (const key of Object.keys(diagnostics)) {
    if (!(key in base.diagnostics)) warnUnknown('postProcessing.diagnostics', key, warnings);
  }
  base.diagnostics = {
    enabled: clampBoolean(diagnostics.enabled, base.diagnostics.enabled),
    debugView: pickEnum(diagnostics.debugView, DEBUG_VIEWS, base.diagnostics.debugView),
    showGpuTimings: clampBoolean(diagnostics.showGpuTimings, base.diagnostics.showGpuTimings),
  };

  if (markCustom) base.preset = 'custom';
  return Object.freeze(deepFreeze(base));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function createPostProcessingSettings(initial = {}) {
  const warnings = [];
  let current = normalizePostProcessingSettings(initial, { warnings });
  let pendingPatch = null;
  let rafHandle = null;
  const listeners = new Set();

  const emit = () => {
    for (const listener of listeners) listener(current);
  };

  const flush = () => {
    rafHandle = null;
    if (!pendingPatch) return;
    const patch = pendingPatch;
    pendingPatch = null;
    current = normalizePostProcessingSettings(
      mergeSettings(current, patch),
      { markCustom: patch.__markCustom !== false },
    );
    emit();
  };

  return {
    get() {
      return current;
    },
    set(patch, { coalesce = false, markCustom = true } = {}) {
      const nextPatch = { ...patch, __markCustom: markCustom };
      if (!coalesce) {
        if (pendingPatch) {
          if (rafHandle != null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(rafHandle);
          }
          flush();
        }
        current = normalizePostProcessingSettings(
          mergeSettings(current, nextPatch),
          { markCustom },
        );
        emit();
        return current;
      }
      pendingPatch = pendingPatch
        ? mergeSettings(pendingPatch, nextPatch)
        : nextPatch;
      if (rafHandle == null && typeof requestAnimationFrame === 'function') {
        rafHandle = requestAnimationFrame(flush);
      } else if (rafHandle == null) {
        flush();
      }
      return current;
    },
    reset(defaults = DEFAULT_POST_PROCESSING_SETTINGS) {
      pendingPatch = null;
      if (rafHandle != null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafHandle);
      }
      rafHandle = null;
      current = normalizePostProcessingSettings(defaults, { markCustom: false });
      emit();
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    warnings: () => warnings.slice(),
  };
}

function mergeSettings(base, patch) {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (key === '__markCustom') {
      result.__markCustom = value;
      continue;
    }
    if (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && base[key]
      && typeof base[key] === 'object'
    ) {
      result[key] = { ...base[key], ...value };
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function postProcessingSettingsToPlain(settings) {
  return structuredClone(settings);
}
