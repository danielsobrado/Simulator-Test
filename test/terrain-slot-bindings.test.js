import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { uniform, uv } from 'three/tsl';

import {
  TERRAIN_SLOT_KEY,
  createSlotBakeGpuState,
  slotTexture,
  slotVector2,
} from '../src/editor/materials/TerrainSlotBindings.js';
import {
  attachTerrainMaterialBakeGpuState,
  createTerrainMaterialBakeGpuState,
} from '../src/editor/materials/TerrainMaterialBakeGpu.js';

function dataTexture() {
  return new THREE.DataTexture(new Uint8Array(4), 1, 1);
}

function slotMesh(data, bake = null) {
  const mesh = new THREE.Mesh();
  mesh.userData[TERRAIN_SLOT_KEY] = data;
  if (bake) attachTerrainMaterialBakeGpuState(mesh, bake);
  return mesh;
}

test('slot textures follow the drawn mesh and stay per-object updates', () => {
  const template = dataTexture();
  const own = dataTexture();
  const node = slotTexture('heightTexture', template, uv());
  // TextureNode.setup resets updateType unless a uv-matrix uniform exists;
  // holding one the shader never reads keeps the per-object update alive.
  assert.equal(node.updateMatrix, false);
  assert.notEqual(node._matrixUniform, null);
  assert.equal(new THREE.TextureNode(template)._matrixUniform, null, 'three still names this field');
  assert.equal(node.updateType, 'object');

  node.update({ object: slotMesh({ heightTexture: own }) });
  assert.equal(node.value, own);
  node.update({ object: new THREE.Mesh() });
  assert.equal(node.value, template, 'a mesh without slot data draws the template');
});

test('slot uniforms and bake state are read per mesh', () => {
  const template = uniform(new THREE.Vector2(1, 2));
  const center = slotVector2('chunkCenter', template);
  const own = uniform(new THREE.Vector2(5, 6));
  center.update({ object: slotMesh({ chunkCenter: own }) });
  assert.equal(center.value, own.value);

  const config = { enabled: true, quality: 'q', qualityTiers: { q: { resolution: 2 } } };
  const templateState = createTerrainMaterialBakeGpuState(config);
  const shared = createSlotBakeGpuState(templateState);
  const ownState = createTerrainMaterialBakeGpuState(config);
  ownState.ready.value = 1;
  ownState.blend.value = 0.25;
  const mesh = slotMesh({}, ownState);
  shared.ready.update({ object: mesh });
  shared.blend.update({ object: mesh });
  assert.equal(shared.ready.value, 1);
  assert.equal(shared.blend.value, 0.25);
  const macro = shared.sampleTexture('macroTint', uv());
  macro.update({ object: mesh });
  assert.equal(macro.value, ownState.textures.macroTint);
  assert.equal(createSlotBakeGpuState(null), null);
});
