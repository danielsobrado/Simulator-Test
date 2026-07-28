import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/editor/stylized/StylizedWaterMaterial.js', import.meta.url),
  'utf8',
);

test('medium and higher tiers derive opacity from semantic water depth', () => {
  assert.match(source, /const waterDepth = max\(waterField\.b, 0\);/);
  assert.match(source, /if \(quality\.depthOptics\)/);
  assert.match(source, /const opticalDistance = min\(/);
  assert.match(
    source,
    /const transmission = exp\(opticalDistance\.mul\(-optics\.absorptionDensity\)\);/,
  );
  assert.match(source, /float\(optics\.maximumOpacity\)/);
});

test('the low-tier legacy opacity path remains available', () => {
  assert.match(
    source,
    /let alpha = mix\(float\(water\.deepOpacity\), float\(water\.opacity\), ramp\)/,
  );
  assert.match(source, /const legacyColor = mix\(/);
});
