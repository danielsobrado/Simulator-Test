import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(
  new URL('../src/editor/stylized/StylizedWaterMaterial.js', import.meta.url),
  'utf8',
);

test('W2B samples opaque colour and copied depth through safe viewport UVs', () => {
  assert.match(source, /viewportOpaqueMipTexture/);
  assert.match(source, /viewportDepthTexture/);
  assert.match(source, /viewportSafeUV/);
  assert.match(source, /const baseViewportUv = viewportSafeUV\(screenUV\);/);
  assert.match(
    source,
    /const distortedLinearDepth = linearDepth\(viewportDepthTexture\(distortedViewportUv\)\);/,
  );
});

test('distorted foreground samples fall back before scene colour is read', () => {
  assert.match(source, /const validDepth = step\(/);
  assert.match(source, /waterLinearDepth\.add\(refraction\.depthBias\)/);
  assert.match(source, /const acceptedViewportUv = mix\(/);
  assert.match(source, /baseViewportUv,[\s\S]*distortedViewportUv,[\s\S]*validDepth/);
});

test('captured scene colour uses RGB absorption and manual coverage compositing', () => {
  assert.match(
    source,
    /const channelTransmission = exp\(coefficients\.mul\(opticalDistance\)\.negate\(\)\);/,
  );
  assert.match(source, /sceneColor\.mul\(channelTransmission\)/);
  assert.match(source, /bodyColor\.mul\(oneMinus\(channelTransmission\)\)/);
  assert.match(source, /alpha = waterCoverage;/);
});
