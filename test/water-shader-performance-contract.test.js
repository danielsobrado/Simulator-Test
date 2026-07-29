import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const materialSource = await readFile(
  new URL('../src/editor/stylized/StylizedWaterMaterial.js', import.meta.url),
  'utf8',
);
const noiseSource = await readFile(
  new URL('../src/editor/stylized/StylizedNoiseNodes.js', import.meta.url),
  'utf8',
);

test('water reuses one Voronoi neighbourhood for edge metrics', () => {
  assert.match(materialSource, /function voronoiMetrics\(/);
  assert.match(materialSource, /const distances = voronoiDistances\(/);
  assert.match(materialSource, /const edge = metrics\.nearest\.sub\(metrics\.smoothNearest\);/);
});

test('low quality skips cellular surface work', () => {
  assert.match(materialSource, /if \(quality\.cellularSurface\)/);
  assert.match(materialSource, /let ramp = smoothstep\(LOW_SURFACE_RAMP_MIN, LOW_SURFACE_RAMP_MAX, noiseFac\);/);
});

test('water uses bounded two-octave noise for vector distortion and refraction', () => {
  assert.match(noiseSource, /export function stylizedFbm2\(/);
  assert.match(materialSource, /const surfaceNoise = vec2\(/);
  assert.match(materialSource, /stylizedFbm2\(coarsePoint\)/);
  assert.match(materialSource, /stylizedFbm2\(finePoint\)/);
});

test('procedural water edges use derivative anti-aliasing', () => {
  assert.match(materialSource, /fwidth\(edge\)/);
  assert.match(materialSource, /fwidth\(causticRing\)/);
});
