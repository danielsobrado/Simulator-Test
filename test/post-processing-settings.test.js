import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyPostProcessingPreset,
  normalizePostProcessingSettings,
  patchPostProcessingSettings,
} from '../src/editor/postprocessing/PostProcessingConfig.js';

const defaults = Object.freeze({
  enabled: true,
  preset: 'balanced',
  antiAliasing: Object.freeze({
    enabled: true,
    depthThreshold: 0.0005,
    edgeDepthDiff: 0.001,
    maxVelocityPixels: 96,
    subpixelCorrection: true,
  }),
  bloom: Object.freeze({ enabled: true, intensity: 0.18, radius: 0.55, threshold: 3, softKnee: 0.2 }),
  toneMapping: Object.freeze({ enabled: true, mode: 'agx', exposure: 1, contrast: 1, saturation: 1 }),
  sharpen: Object.freeze({ enabled: true, amount: 0.22 }),
  ssr: Object.freeze({
    enabled: false,
    quality: 'medium',
    intensity: 0.6,
    maxDistance: 80,
    thickness: 0.35,
    edgeFade: 0.08,
    roughnessCutoff: 0.45,
  }),
  depthOfField: Object.freeze({ enabled: false, focusDistance: 6.2, focalLength: 130, bokehScale: 1.5 }),
  vignette: Object.freeze({ enabled: false, intensity: 0.12, innerRadius: 0.35, outerRadius: 1.05 }),
  grain: Object.freeze({ enabled: false, intensity: 0.012 }),
  diagnostics: Object.freeze({ enabled: false, debugView: 'final' }),
});

test('normalization clamps unsafe values and rejects unknown enums', () => {
  const result = normalizePostProcessingSettings(defaults, {
    ...structuredClone(defaults),
    bloom: { ...defaults.bloom, intensity: 99 },
    toneMapping: { ...defaults.toneMapping, mode: 'invalid' },
    ssr: {
      ...defaults.ssr,
      quality: 'cinematic',
      maxDistance: 5_000,
      thickness: -2,
    },
  });
  assert.equal(result.bloom.intensity, 1.5);
  assert.equal(result.toneMapping.mode, 'agx');
  assert.equal(result.ssr.quality, 'medium');
  assert.equal(result.ssr.maxDistance, 200);
  assert.equal(result.ssr.thickness, 0.05);
});

test('normalization removes unknown fields and repairs vignette radii', () => {
  const result = normalizePostProcessingSettings(defaults, {
    ...structuredClone(defaults),
    unknown: true,
    bloom: { ...defaults.bloom, invented: 123 },
    vignette: { ...defaults.vignette, innerRadius: 0.9, outerRadius: 0.4 },
  });
  assert.equal('unknown' in result, false);
  assert.equal('invented' in result.bloom, false);
  assert.ok(result.vignette.outerRadius > result.vignette.innerRadius);
});

test('individual changes select the custom preset', () => {
  const result = patchPostProcessingSettings(defaults, structuredClone(defaults), {
    bloom: { intensity: 0.4 },
  });
  assert.equal(result.preset, 'custom');
  assert.equal(result.bloom.intensity, 0.4);
  assert.equal(result.bloom.radius, defaults.bloom.radius);
});

test('presets preserve artistic lens toggles', () => {
  for (const preset of ['low', 'balanced', 'high', 'ultra']) {
    const current = structuredClone(defaults);
    current.depthOfField.enabled = true;
    current.vignette.enabled = true;
    current.grain.enabled = true;
    const result = applyPostProcessingPreset(defaults, current, preset);
    assert.equal(result.preset, preset);
    assert.equal(result.depthOfField.enabled, true);
    assert.equal(result.vignette.enabled, true);
    assert.equal(result.grain.enabled, true);
  }
});

test('off preset disables the graph without erasing effect settings', () => {
  const current = structuredClone(defaults);
  current.bloom.intensity = 0.42;
  const result = applyPostProcessingPreset(defaults, current, 'off');
  assert.equal(result.enabled, false);
  assert.equal(result.bloom.intensity, 0.42);
});

test('balanced bloom stays limited to HDR highlights', () => {
  const result = applyPostProcessingPreset(defaults, structuredClone(defaults), 'balanced');
  assert.equal(result.bloom.threshold, 3);
  assert.ok(result.bloom.threshold > 1);
});
