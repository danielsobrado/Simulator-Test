import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DepthTexture,
  FramebufferTexture,
  Source,
} from 'three/webgpu';
import {
  isViewportFramebufferSourcesPatched,
  patchViewportFramebufferSources,
} from '../../src/render/patchViewportFramebufferSources.js';

test('patchViewportFramebufferSources detaches Source on FramebufferTexture clones', () => {
  patchViewportFramebufferSources();
  assert.equal(isViewportFramebufferSourcesPatched(), true);

  const original = new FramebufferTexture(128, 64);
  const clone = original.clone();

  assert.notEqual(clone.source, original.source);
  assert.ok(clone.source instanceof Source);
  assert.equal(clone.image.width, 128);
  assert.equal(clone.image.height, 64);

  original.image.width = 256;
  original.image.height = 128;
  assert.equal(clone.image.width, 128);
  assert.equal(clone.image.height, 64);
});

test('patchViewportFramebufferSources detaches Source on DepthTexture clones', () => {
  patchViewportFramebufferSources();

  const original = new DepthTexture(96, 48);
  const clone = original.clone();

  assert.notEqual(clone.source, original.source);
  clone.image.width = 192;
  clone.image.height = 96;
  assert.equal(original.image.width, 96);
  assert.equal(original.image.height, 48);
});
