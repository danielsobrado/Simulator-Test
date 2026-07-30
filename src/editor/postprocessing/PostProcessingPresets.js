export const POST_PROCESSING_PRESET_NAMES = Object.freeze([
  'off',
  'low',
  'balanced',
  'high',
  'ultra',
  'custom',
]);

export const POST_PROCESSING_PRESETS = Object.freeze({
  off: Object.freeze({ enabled: false }),
  low: Object.freeze({
    enabled: true,
    antiAliasing: Object.freeze({ enabled: false }),
    bloom: Object.freeze({ enabled: true, intensity: 0.08, radius: 0.35, threshold: 3.5 }),
    toneMapping: Object.freeze({ enabled: true, mode: 'agx' }),
    sharpen: Object.freeze({ enabled: false }),
    ssr: Object.freeze({ enabled: false }),
  }),
  balanced: Object.freeze({
    enabled: true,
    antiAliasing: Object.freeze({ enabled: true }),
    bloom: Object.freeze({ enabled: true, intensity: 0.18, radius: 0.55, threshold: 3.0 }),
    toneMapping: Object.freeze({ enabled: true, mode: 'agx' }),
    sharpen: Object.freeze({ enabled: true, amount: 0.22 }),
    ssr: Object.freeze({ enabled: false }),
  }),
  high: Object.freeze({
    enabled: true,
    antiAliasing: Object.freeze({ enabled: true }),
    bloom: Object.freeze({ enabled: true, intensity: 0.22, radius: 0.62, threshold: 2.8 }),
    toneMapping: Object.freeze({ enabled: true, mode: 'agx' }),
    sharpen: Object.freeze({ enabled: true, amount: 0.2 }),
    ssr: Object.freeze({ enabled: true, quality: 'medium' }),
  }),
  ultra: Object.freeze({
    enabled: true,
    antiAliasing: Object.freeze({ enabled: true }),
    bloom: Object.freeze({ enabled: true, intensity: 0.24, radius: 0.7, threshold: 2.6 }),
    toneMapping: Object.freeze({ enabled: true, mode: 'agx' }),
    sharpen: Object.freeze({ enabled: true, amount: 0.18 }),
    ssr: Object.freeze({ enabled: true, quality: 'high' }),
  }),
});

export function mergePreset(settings, presetName) {
  const preset = POST_PROCESSING_PRESETS[presetName];
  if (!preset) return structuredClone(settings);
  const next = structuredClone(settings);
  for (const [key, value] of Object.entries(preset)) {
    next[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? { ...next[key], ...value }
      : value;
  }
  next.preset = presetName;
  return next;
}
