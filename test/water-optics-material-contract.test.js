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
  // Assignment, not declaration: `opticalDistance` is declared `let` outside the
  // `depthOptics` branch so the legacy path can still read it, and only assigned
  // in here.
  assert.match(source, /\n\s*opticalDistance = min\(/);
  assert.match(
    source,
    /const transmission = exp\(opticalDistance\.mul\(-optics\.absorptionDensity\)\);/,
  );
  assert.match(source, /float\(optics\.maximumOpacity\)/);
});

test('underwater optical distance blends to camera submersion', () => {
  assert.match(
    source,
    /const cameraSubmersionDepth = max\(positionWorld\.y\.sub\(cameraPosition\.y\), 0\);/,
  );
  assert.match(source, /const underwaterBlend = smoothstep\(/);
  assert.match(
    source,
    /const verticalDistance = mix\(waterDepth, cameraSubmersionDepth, underwaterBlend\);/,
  );
});

test('the low-tier legacy opacity path remains available', () => {
  assert.match(
    source,
    /let alpha = mix\(float\(water\.deepOpacity\), float\(water\.opacity\), ramp\)/,
  );
  assert.match(source, /const legacyColor = mix\(/);
});
