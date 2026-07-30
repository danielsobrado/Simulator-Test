import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL(
  '../../src/editor/settings/PostProcessingSettingsPanel.js',
  import.meta.url,
);

test('settings panel exposes every screen-space shaft control', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  for (const path of [
    'screenSpaceShafts.enabled',
    'screenSpaceShafts.resolutionScale',
    'screenSpaceShafts.samples',
    'screenSpaceShafts.intensity',
    'screenSpaceShafts.reach',
    'screenSpaceShafts.decay',
    'screenSpaceShafts.highSunFadeStartDegrees',
    'screenSpaceShafts.highSunFadeEndDegrees',
  ]) {
    assert.ok(source.includes(`'${path}'`), `missing settings control: ${path}`);
  }
});

test('allocation and compile-time range controls update on change', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  for (const path of [
    'renderScale',
    'bloom.levels',
    'ssr.resolutionScale',
    'screenSpaceShafts.resolutionScale',
    'screenSpaceShafts.samples',
    'depthOfField.taps',
  ]) {
    assert.ok(source.includes(`'${path}'`), `missing topology range: ${path}`);
  }
  assert.match(source, /TOPOLOGY_RANGE_PATHS\.has\(path\)/);
  assert.match(source, /\? 'input'\s*:\s*'change'/);
});
