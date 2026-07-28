import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/editor/stylized/StylizedWaterMaterial.js', import.meta.url),
  'utf8',
);

test('shore foam reads the semantic shore-distance channel', () => {
  assert.match(source, /const shoreDistance = max\(waterField\.a, 0\);/);
  assert.match(source, /const shoreBand = oneMinus\(smoothstep\(0, foam\.shoreWidth, shoreDistance\)\);/);
  assert.match(source, /foamAmount = max\(shoreBand, flowBand\)/);
});

test('river bands require streamed current strength', () => {
  assert.match(source, /let currentStrength = float\(0\);/);
  assert.match(source, /currentStrength = clamp\(length\(decodedFlow\), 0, 1\);/);
  assert.match(source, /\.mul\(currentStrength\)\.mul\(foam\.flowStrength\)/);
});

test('intersection foam uses accepted opaque depth behind water', () => {
  assert.match(source, /const baseViewDistance = linearDepth\(/);
  assert.match(source, /const acceptedViewDistance = mix\(/);
  assert.match(source, /const sceneGap = max\(acceptedViewDistance\.sub\(waterViewDistance\), 0\);/);
  assert.match(source, /quality\.intersectionFoam && water\.foam\.enabled/);
});

test('foam is composited after surface caustics', () => {
  const causticIndex = source.indexOf('if (quality.caustics)');
  const foamCompositeIndex = source.lastIndexOf('if (quality.foam && water.foam.enabled)');
  assert.ok(causticIndex >= 0);
  assert.ok(foamCompositeIndex > causticIndex);
  assert.match(source, /colorNode\(water\.foam\.color\)/);
});
