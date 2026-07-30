import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_POST_PROCESSING_SETTINGS,
  normalizePostProcessingSettings,
} from '../../src/render/postprocessing/PostProcessingSettings.js';
import {
  applyPostProcessingPreset,
  applySsrQuality,
  listPostProcessingPresets,
  resolveSsrQuality,
} from '../../src/render/postprocessing/PostProcessingPresets.js';

test('lists every quality preset', () => {
  assert.deepEqual(
    listPostProcessingPresets().map((entry) => entry.id),
    ['off', 'low', 'balanced', 'high', 'ultra'],
  );
});

test('off disables master without wiping effect values', () => {
  const current = normalizePostProcessingSettings({
    bloom: { intensity: 0.4 },
    sharpen: { amount: 0.5 },
  });
  const next = applyPostProcessingPreset('off', current);
  assert.equal(next.enabled, false);
  assert.equal(next.preset, 'off');
  assert.equal(next.bloom.intensity, 0.4);
  assert.equal(next.sharpen.amount, 0.5);
});

test('low preset values', () => {
  const next = applyPostProcessingPreset('low', DEFAULT_POST_PROCESSING_SETTINGS);
  assert.equal(next.enabled, true);
  assert.equal(next.antiAliasing.enabled, false);
  assert.equal(next.bloom.intensity, 0.08);
  assert.equal(next.bloom.levels, 2);
  assert.equal(next.sharpen.enabled, false);
  assert.equal(next.ssr.enabled, false);
});

test('balanced preset values', () => {
  const next = applyPostProcessingPreset('balanced', DEFAULT_POST_PROCESSING_SETTINGS);
  assert.equal(next.antiAliasing.enabled, true);
  assert.equal(next.antiAliasing.feedback, 0.90);
  assert.equal(next.bloom.intensity, 0.18);
  assert.equal(next.bloom.levels, 4);
  assert.equal(next.sharpen.amount, 0.22);
  assert.equal(next.ssr.enabled, false);
});

test('high and ultra enable SSR with quality steps', () => {
  const high = applyPostProcessingPreset('high', DEFAULT_POST_PROCESSING_SETTINGS);
  assert.equal(high.ssr.enabled, true);
  assert.equal(high.ssr.resolutionScale, 0.5);
  assert.equal(high.ssr.maxSteps, 32);
  assert.equal(high.bloom.levels, 5);

  const ultra = applyPostProcessingPreset('ultra', DEFAULT_POST_PROCESSING_SETTINGS);
  assert.equal(ultra.ssr.resolutionScale, 0.75);
  assert.equal(ultra.ssr.maxSteps, 48);
  assert.equal(ultra.bloom.levels, 6);
  assert.equal(ultra.antiAliasing.feedback, 0.94);
});

test('presets preserve artistic toggles', () => {
  const current = normalizePostProcessingSettings({
    depthOfField: { enabled: true, maxCoCPixels: 4 },
    vignette: { enabled: true, intensity: 0.2 },
    grain: { enabled: true, intensity: 0.02 },
    diagnostics: { enabled: true, debugView: 'depth' },
  });
  const next = applyPostProcessingPreset('high', current);
  assert.equal(next.depthOfField.enabled, true);
  assert.equal(next.depthOfField.maxCoCPixels, 4);
  assert.equal(next.vignette.enabled, true);
  assert.equal(next.grain.enabled, true);
  assert.equal(next.diagnostics.enabled, true);
  assert.equal(next.diagnostics.debugView, 'depth');
});

test('SSR quality mapping', () => {
  let settings = applySsrQuality('low', DEFAULT_POST_PROCESSING_SETTINGS);
  assert.equal(resolveSsrQuality(settings), 'low');
  settings = applySsrQuality('high', settings);
  assert.equal(resolveSsrQuality(settings), 'high');
  assert.equal(settings.preset, 'custom');
});
