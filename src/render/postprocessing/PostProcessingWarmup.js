import {
  DEBUG_VIEWS,
  postProcessingSettingsToPlain,
} from './PostProcessingSettings.js';
import { SSR_QUALITY_PRESETS } from './PostProcessingPresets.js';
import { POST_PROCESSING_EFFECT_KEYS } from './nodes/PostCommon.js';

function isolatedSettings(base, patch = {}) {
  const settings = postProcessingSettingsToPlain(base);
  settings.enabled = true;
  settings.renderScale = 1;
  settings.diagnostics = {
    ...settings.diagnostics,
    enabled: false,
    debugView: 'final',
  };
  for (const key of POST_PROCESSING_EFFECT_KEYS) {
    settings[key] = { ...settings[key], enabled: false };
  }
  for (const [key, value] of Object.entries(patch)) {
    settings[key] = (
      value
      && typeof value === 'object'
      && !Array.isArray(value)
      && settings[key]
    )
      ? { ...settings[key], ...value }
      : value;
  }
  return settings;
}

/**
 * Small, intentionally overlapping variants. Values controlled by uniforms do
 * not require distinct pipelines, but are still submitted here so warmup stays
 * aligned with the options promised by the UI.
 */
export function createPostProcessingWarmupVariants(base) {
  const variants = [
    ['pass-through', isolatedSettings(base)],
    ['traa', isolatedSettings(base, {
      antiAliasing: { enabled: true, mode: 'traa' },
    })],
    ['traa-upscale', isolatedSettings(base, {
      renderScale: 0.67,
      antiAliasing: { enabled: true, mode: 'traau' },
    })],
  ];

  for (const levels of [2, 4, 6]) {
    variants.push([`bloom-${levels}`, isolatedSettings(base, {
      bloom: { enabled: true, levels },
    })]);
  }
  for (const mode of ['agx', 'aces', 'neutral']) {
    variants.push([`tone-${mode}`, isolatedSettings(base, {
      toneMapping: { enabled: true, mode },
    })]);
  }
  variants.push(['sharpen', isolatedSettings(base, {
    sharpen: { enabled: true },
  })]);
  for (const [quality, values] of Object.entries(SSR_QUALITY_PRESETS)) {
    variants.push([`ssr-${quality}`, isolatedSettings(base, {
      ssr: { enabled: true, ...values },
    })]);
  }
  variants.push(
    ['screen-space-shafts', isolatedSettings(base, {
      screenSpaceShafts: { enabled: true },
    })],
    ['dof', isolatedSettings(base, {
      depthOfField: { enabled: true },
    })],
    ['vignette', isolatedSettings(base, {
      vignette: { enabled: true },
    })],
    ['grain', isolatedSettings(base, {
      grain: { enabled: true },
    })],
  );
  for (const debugView of DEBUG_VIEWS) {
    variants.push([`debug-${debugView}`, isolatedSettings(base, {
      diagnostics: { enabled: true, debugView },
    })]);
  }
  return variants.map(([id, settings]) => Object.freeze({ id, settings }));
}
