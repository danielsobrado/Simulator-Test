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
  assert.match(source, /const distortedViewDistance = linearDepth\(/);
});

test('distorted foreground samples fall back using view-distance metres', () => {
  assert.match(source, /const depthRange = cameraFar\.sub\(cameraNear\);/);
  assert.match(source, /const waterViewDistance = linearDepth\(\)\.mul\(depthRange\)\.add\(cameraNear\);/);
  assert.match(source, /waterViewDistance\.add\(refraction\.depthBiasMeters\)/);
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
  // Coverage composites the body manually because the refracted colour already
  // carries the scene behind it; the waterline fade is what keeps that opaque
  // sheet from painting over the beach where the body has no thickness.
  assert.match(source, /alpha = waterCoverage\.mul\(waterlineFade\);/);
});

test('refraction uses only two bounded FBM samples', () => {
  const helper = source.match(/function refractionWarp\([\s\S]*?\n\}/)?.[0] ?? '';
  assert.equal((helper.match(/stylizedFbm2\(/g) ?? []).length, 2);
  assert.equal((helper.match(/stylizedFbm\(/g) ?? []).length, 0);
});
