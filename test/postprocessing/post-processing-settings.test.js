import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_POST_PROCESSING_SETTINGS,
  createPostProcessingSettings,
  normalizePostProcessingSettings,
  postProcessingSettingsToPlain,
} from '../../src/render/postprocessing/PostProcessingSettings.js';

test('defaults match the balanced YAML contract', () => {
  const settings = normalizePostProcessingSettings({});
  assert.equal(settings.enabled, true);
  assert.equal(settings.preset, 'balanced');
  assert.equal(settings.antiAliasing.mode, 'traa');
  assert.equal(settings.bloom.intensity, 0.18);
  assert.equal(settings.toneMapping.mode, 'agx');
  assert.equal(settings.ssr.enabled, false);
  assert.equal(settings.depthOfField.enabled, false);
  assert.equal(settings.vignette.enabled, false);
  assert.equal(settings.grain.enabled, false);
});

test('clamps out-of-range values', () => {
  const settings = normalizePostProcessingSettings({
    renderScale: 0.1,
    bloom: { intensity: 99, levels: 1 },
    sharpen: { amount: 5 },
    grain: { intensity: 1 },
  });
  assert.equal(settings.renderScale, 0.67);
  assert.equal(settings.bloom.intensity, 1.5);
  assert.equal(settings.bloom.levels, 2);
  assert.equal(settings.sharpen.amount, 0.80);
  assert.equal(settings.grain.intensity, 0.05);
});

test('unknown fields warn and are ignored', () => {
  const warnings = [];
  const settings = normalizePostProcessingSettings({
    nonsense: true,
    bloom: { intensity: 0.2, glowMagic: 1 },
  }, { warnings });
  assert.equal(settings.bloom.intensity, 0.2);
  assert.equal(settings.bloom.glowMagic, undefined);
  assert.ok(warnings.some((entry) => entry.includes('nonsense')));
  assert.ok(warnings.some((entry) => entry.includes('glowMagic')));
});

test('invalid enums fall back to defaults', () => {
  const settings = normalizePostProcessingSettings({
    preset: 'ultra-mega',
    antiAliasing: { mode: 'fxaa' },
    toneMapping: { mode: 'filmic' },
    diagnostics: { debugView: 'albedo' },
  });
  assert.equal(settings.preset, 'balanced');
  assert.equal(settings.antiAliasing.mode, 'traa');
  assert.equal(settings.toneMapping.mode, 'agx');
  assert.equal(settings.diagnostics.debugView, 'final');
});

test('immutable store marks custom on individual edits', () => {
  const store = createPostProcessingSettings(DEFAULT_POST_PROCESSING_SETTINGS);
  store.set({ bloom: { intensity: 0.3 } });
  assert.equal(store.get().preset, 'custom');
  assert.equal(store.get().bloom.intensity, 0.3);
});

test('round-trip plain object persistence', () => {
  const store = createPostProcessingSettings({
    enabled: true,
    bloom: { intensity: 0.4, levels: 5 },
  });
  const plain = postProcessingSettingsToPlain(store.get());
  const restored = normalizePostProcessingSettings(plain);
  assert.deepEqual(restored.bloom.intensity, plain.bloom.intensity);
  assert.deepEqual(restored.bloom.levels, plain.bloom.levels);
});
