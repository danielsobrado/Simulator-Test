import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const postSource = await readFile(
  new URL('../src/editor/water/UnderwaterCausticsPostProcess.js', import.meta.url),
  'utf8',
);
const controllerSource = await readFile(
  new URL('../src/editor/water/UnderwaterViewController.js', import.meta.url),
  'utf8',
);

test('projected caustics reconstruct world position from scene depth', () => {
  assert.match(postSource, /getViewPosition\(/);
  assert.match(postSource, /const worldPosition = cameraMatrixWorld\.mul\(viewPosition\)\.xyz;/);
  assert.match(postSource, /const belowSurfaceDepth = max\(surfaceHeight\.sub\(worldPosition\.y\), 0\);/);
  assert.match(postSource, /const geometry = oneMinus\(step\(SKY_DEPTH_THRESHOLD, depth\)\);/);
});

test('projected caustics are depth, distance, and transition bounded', () => {
  assert.match(postSource, /const shallow = oneMinus\(smoothstep\(/);
  assert.match(postSource, /const distanceFade = oneMinus\(smoothstep\(/);
  assert.match(postSource, /\.mul\(blend\)/);
  assert.match(
    postSource,
    /PerfCounters\.inc\(PERF_COUNTER_WATER_PROJECTED_CAUSTIC_FRAMES\)/,
  );
});

test('underwater controller installs and ownership-safely restores render hooks', () => {
  assert.match(controllerSource, /this\.causticsRenderHook = \(camera\) => \{/);
  assert.match(controllerSource, /this\.causticsPostProcess\.render\(camera\)/);
  assert.match(controllerSource, /this\.causticsPrewarmHook = \(camera\) => \{/);
  assert.match(controllerSource, /this\.terrainView\.render === this\.causticsRenderHook/);
  assert.match(controllerSource, /this\.terrainView\.prewarmPostProcessing === this\.causticsPrewarmHook/);
});

test('surface height is retained while the underwater blend fades out', () => {
  assert.match(postSource, /update\(\{ blend = 0, surfaceHeight \} = \{\}\)/);
  assert.match(controllerSource, /if \(status\.headSubmerged \|\| status\.waterDepth > 0\)/);
  assert.match(controllerSource, /causticsState\.surfaceHeight = status\.waterSurfaceHeight;/);
});
