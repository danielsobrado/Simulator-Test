import assert from 'node:assert/strict';
import test from 'node:test';
import { NoBlending, Texture } from 'three';
import {
  createTreeImpostorBakeMaterial,
} from '../src/editor/stylized/impostor/TreeImpostorBaker.js';

test('normal bake writes foliage classification through material opacity', () => {
  const sourceMap = new Texture();
  const leaf = createTreeImpostorBakeMaterial({
    kind: 'leaf',
    sourceMap,
    material: { alphaTest: 0.61 },
  }, true);
  const trunk = createTreeImpostorBakeMaterial({ kind: 'trunk' }, true);

  try {
    assert.equal(leaf.opacityNode?.node?.value, 1);
    assert.equal(trunk.opacityNode?.node?.value, 0);
    assert.equal(leaf.blending, NoBlending);
    assert.equal(trunk.blending, NoBlending);
    const maskTextureNode = leaf.maskNode.node.aNode.node;
    assert.equal(maskTextureNode.uvNode, null);
    assert.equal(maskTextureNode.updateMatrix, true);
    assert.equal(leaf.maskNode.node.bNode.value, 0.61);
  } finally {
    leaf.dispose();
    trunk.dispose();
  }
});
