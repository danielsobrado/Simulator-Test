import assert from 'node:assert/strict';
import test from 'node:test';
import { Texture } from 'three';
import { authoredTexture } from '../src/editor/stylized/AuthoredTextureNode.js';

test('authored glTF textures retain their KHR_texture_transform matrix', () => {
  const sourceMap = new Texture();
  sourceMap.repeat.set(16, 16);

  const sample = authoredTexture(sourceMap);

  assert.equal(sample.uvNode, null);
  assert.equal(sample.updateMatrix, true);
});
