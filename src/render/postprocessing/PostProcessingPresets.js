import {
  DEFAULT_POST_PROCESSING_SETTINGS,
  normalizePostProcessingSettings,
  postProcessingSettingsToPlain,
} from './PostProcessingSettings.js';

/**
 * Quality presets. Artistic options (DOF, grain, vignette) and diagnostics are
 * never modified. God-ray technique is also preserved (Phase 10 owns that UI).
 */
const ARTISTIC_KEYS = Object.freeze([
  'depthOfField',
  'vignette',
  'grain',
  'diagnostics',
]);

function preserveArtistic(current, next) {
  const plain = postProcessingSettingsToPlain(next);
  for (const key of ARTISTIC_KEYS) {
    if (current?.[key]) plain[key] = structuredClone(current[key]);
  }
  return plain;
}

export const POST_PROCESSING_PRESETS = Object.freeze({
  off: Object.freeze({
    id: 'off',
    label: 'Off',
    apply(current) {
      const plain = postProcessingSettingsToPlain(current ?? DEFAULT_POST_PROCESSING_SETTINGS);
      plain.enabled = false;
      plain.preset = 'off';
      return normalizePostProcessingSettings(plain, { markCustom: false });
    },
  }),
  low: Object.freeze({
    id: 'low',
    label: 'Low',
    apply(current) {
      const plain = preserveArtistic(current, DEFAULT_POST_PROCESSING_SETTINGS);
      plain.enabled = true;
      plain.preset = 'low';
      plain.renderScale = 1.0;
      plain.antiAliasing = { ...plain.antiAliasing, enabled: false };
      plain.bloom = {
        ...plain.bloom,
        enabled: true,
        intensity: 0.08,
        levels: 2,
      };
      plain.toneMapping = {
        ...plain.toneMapping,
        enabled: true,
        mode: 'agx',
      };
      plain.sharpen = { ...plain.sharpen, enabled: false };
      plain.ssr = { ...plain.ssr, enabled: false };
      return normalizePostProcessingSettings(plain, { markCustom: false });
    },
  }),
  balanced: Object.freeze({
    id: 'balanced',
    label: 'Balanced',
    apply(current) {
      const plain = preserveArtistic(current, DEFAULT_POST_PROCESSING_SETTINGS);
      plain.enabled = true;
      plain.preset = 'balanced';
      plain.renderScale = 1.0;
      plain.antiAliasing = {
        ...plain.antiAliasing,
        enabled: true,
        mode: 'traa',
        feedback: 0.90,
      };
      plain.bloom = {
        ...plain.bloom,
        enabled: true,
        intensity: 0.18,
        levels: 4,
      };
      plain.toneMapping = {
        ...plain.toneMapping,
        enabled: true,
        mode: 'agx',
      };
      plain.sharpen = {
        ...plain.sharpen,
        enabled: true,
        amount: 0.22,
      };
      plain.ssr = { ...plain.ssr, enabled: false };
      return normalizePostProcessingSettings(plain, { markCustom: false });
    },
  }),
  high: Object.freeze({
    id: 'high',
    label: 'High',
    apply(current) {
      const plain = preserveArtistic(current, DEFAULT_POST_PROCESSING_SETTINGS);
      plain.enabled = true;
      plain.preset = 'high';
      plain.renderScale = 1.0;
      plain.antiAliasing = {
        ...plain.antiAliasing,
        enabled: true,
        mode: 'traa',
        feedback: 0.92,
      };
      plain.bloom = {
        ...plain.bloom,
        enabled: true,
        intensity: 0.22,
        levels: 5,
      };
      plain.toneMapping = {
        ...plain.toneMapping,
        enabled: true,
        mode: 'agx',
      };
      plain.sharpen = {
        ...plain.sharpen,
        enabled: true,
        amount: 0.20,
      };
      plain.ssr = {
        ...plain.ssr,
        enabled: true,
        resolutionScale: 0.50,
        maxSteps: 32,
        binarySteps: 5,
      };
      return normalizePostProcessingSettings(plain, { markCustom: false });
    },
  }),
  ultra: Object.freeze({
    id: 'ultra',
    label: 'Ultra',
    apply(current) {
      const plain = preserveArtistic(current, DEFAULT_POST_PROCESSING_SETTINGS);
      plain.enabled = true;
      plain.preset = 'ultra';
      plain.renderScale = 1.0;
      plain.antiAliasing = {
        ...plain.antiAliasing,
        enabled: true,
        mode: 'traa',
        feedback: 0.94,
      };
      plain.bloom = {
        ...plain.bloom,
        enabled: true,
        intensity: 0.24,
        levels: 6,
      };
      plain.toneMapping = {
        ...plain.toneMapping,
        enabled: true,
        mode: 'agx',
      };
      plain.sharpen = {
        ...plain.sharpen,
        enabled: true,
        amount: 0.18,
      };
      plain.ssr = {
        ...plain.ssr,
        enabled: true,
        resolutionScale: 0.75,
        maxSteps: 48,
        binarySteps: 5,
      };
      return normalizePostProcessingSettings(plain, { markCustom: false });
    },
  }),
});

export function listPostProcessingPresets() {
  return Object.values(POST_PROCESSING_PRESETS).map((preset) => ({
    id: preset.id,
    label: preset.label,
  }));
}

export function applyPostProcessingPreset(presetId, current) {
  const preset = POST_PROCESSING_PRESETS[presetId];
  if (!preset) {
    return normalizePostProcessingSettings(
      { ...(current ?? DEFAULT_POST_PROCESSING_SETTINGS), preset: 'custom' },
      { markCustom: true },
    );
  }
  return preset.apply(current);
}

export const SSR_QUALITY_PRESETS = Object.freeze({
  low: Object.freeze({ resolutionScale: 0.25, maxSteps: 16, binarySteps: 3 }),
  medium: Object.freeze({ resolutionScale: 0.50, maxSteps: 32, binarySteps: 5 }),
  high: Object.freeze({ resolutionScale: 0.75, maxSteps: 48, binarySteps: 5 }),
});

export function resolveSsrQuality(settings) {
  const ssr = settings?.ssr;
  if (!ssr) return 'medium';
  for (const [id, values] of Object.entries(SSR_QUALITY_PRESETS)) {
    if (
      ssr.resolutionScale === values.resolutionScale
      && ssr.maxSteps === values.maxSteps
      && ssr.binarySteps === values.binarySteps
    ) {
      return id;
    }
  }
  return 'custom';
}

export function applySsrQuality(qualityId, current) {
  const values = SSR_QUALITY_PRESETS[qualityId];
  if (!values) return current;
  return normalizePostProcessingSettings({
    ...postProcessingSettingsToPlain(current),
    preset: 'custom',
    ssr: {
      ...current.ssr,
      ...values,
    },
  }, { markCustom: true });
}
