import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { getSunLightGpuAtlas } from '../src/editor/_clod_shims/sun_light_gpu_atlas.js';

test('fallback sun visibility atlas provides a stable texture binding', () => {
  const first = getSunLightGpuAtlas();
  const second = getSunLightGpuAtlas();

  assert.equal(first, second);
  assert.ok(first.texture?.isDataTexture);
  assert.equal(first.texture.format, THREE.RedFormat);
  assert.equal(first.texture.type, THREE.UnsignedByteType);
  assert.equal(first.texture.magFilter, THREE.NearestFilter);
  assert.equal(first.texture.minFilter, THREE.NearestFilter);
  assert.equal(first.texture.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(first.texture.wrapT, THREE.ClampToEdgeWrapping);
  assert.equal(first.texture.generateMipmaps, false);
  assert.equal(first.texture.image.width, 1);
  assert.equal(first.texture.image.height, 1);
  assert.deepEqual([...first.texture.image.data], [255]);
  assert.equal(first.valid, 0);
  assert.equal(first.worldSize, 1);
});
