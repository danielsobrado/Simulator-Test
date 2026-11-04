import assert from 'node:assert/strict';
import test from 'node:test';

import { NORMAL_SIZE, TownKitAtlas } from '../../src/editor/towns/TownKitAtlas.js';

const image = (rgba) => ({ rgba });
const pixels = (source, size) => {
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < out.length; i += 4) out.set(source.rgba, i);
  return out;
};
const material = (name, normal, roughness) => ({
  name, normalMap: normal && { image: normal }, roughnessMap: roughness && { image: roughness }, roughness: 0.8,
});

test('roughness preserves the glTF green channel in normal alpha without changing normals', () => {
  const normal = image([91, 133, 247, 0]);
  const rough = image([12, 173, 44, 255]);
  const atlas = new TownKitAtlas([material('stone', normal, rough)], pixels);
  const layer = atlas.row('stone').normalLayer;
  const offset = layer * NORMAL_SIZE * NORMAL_SIZE * 4;
  assert.deepEqual([...atlas.normal.image.data.slice(offset, offset + 4)], [91, 133, 247, 173]);
  assert.equal(atlas.row('stone').roughness, 0.8, 'the material factor remains independent');
  atlas.dispose();
});

test('normal/roughness pairs share layers, distinct finishes do not, and absent maps stay neutral', () => {
  const normal = image([128, 128, 255, 0]);
  const rough = image([0, 180, 0, 255]);
  const other = image([0, 90, 0, 255]);
  const atlas = new TownKitAtlas([
    material('a', normal, rough), material('b', normal, rough), material('polished', normal, other),
    material('plain', normal, null), material('bare', null, null), material('finish-only', null, rough),
  ], pixels);
  assert.equal(atlas.row('a').normalLayer, atlas.row('b').normalLayer);
  assert.notEqual(atlas.row('a').normalLayer, atlas.row('polished').normalLayer);
  for (const name of ['plain', 'bare']) {
    const offset = atlas.row(name).normalLayer * NORMAL_SIZE * NORMAL_SIZE * 4;
    assert.equal(atlas.normal.image.data[offset + 3], 255, name);
  }
  const offset = atlas.row('finish-only').normalLayer * NORMAL_SIZE * NORMAL_SIZE * 4;
  assert.deepEqual([...atlas.normal.image.data.slice(offset, offset + 4)], [128, 128, 255, 180]);
  atlas.dispose();
});
