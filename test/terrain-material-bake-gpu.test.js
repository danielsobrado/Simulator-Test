import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import { TerrainMaterialBakeGpuBridge } from '../src/editor/materials/TerrainMaterialBakeGpuBridge.js';
import {
  attachTerrainMaterialBakeGpuState,
  clearTerrainMaterialBakeGpu,
  createTerrainMaterialBakeGpuState,
  uploadTerrainMaterialBakeGpu,
} from '../src/editor/materials/TerrainMaterialBakeGpu.js';

const RESOLUTION = 4;

function config() {
  return {
    enabled: true,
    quality: 'balanced',
    qualityTiers: { balanced: { resolution: RESOLUTION } },
    render: { publishFadeMs: 100 },
  };
}

function page(key = 'terrain-material:v1:balanced:0:0:0.0.0.0.0') {
  const texels = RESOLUTION * RESOLUTION;
  return {
    descriptor: { key },
    resolution: RESOLUTION,
    channels: {
      macroTint: new Uint8Array(texels * 4).fill(127),
      terrainShape: new Uint16Array(texels * 2).fill(1),
      materialWeights: new Uint8Array(texels * 4).fill(64),
      wetnessShoreline: new Uint8Array(texels * 2).fill(32),
      farColor: new Uint8Array(texels * 4).fill(96),
      farNormal: new Int8Array(texels * 2).fill(-12),
      canopyWater: new Uint8Array(texels * 2).fill(48),
    },
  };
}

function materialWithState() {
  const material = new THREE.EventDispatcher();
  material.userData = {};
  const state = createTerrainMaterialBakeGpuState(config());
  attachTerrainMaterialBakeGpuState(material, state);
  return { material, state };
}

test('GPU state preserves packed channel formats and uploads one page without reallocating', () => {
  const { material, state } = materialWithState();
  const baked = page();
  const textureReferences = { ...state.textures };

  const uploaded = uploadTerrainMaterialBakeGpu(material, baked, { stale: true });
  assert.equal(uploaded, RESOLUTION * RESOLUTION * 22);
  assert.equal(state.ready.value, 1);
  assert.equal(state.stale.value, 1);
  assert.equal(state.blend.value, 0);
  assert.equal(state.textures.farColor.colorSpace, THREE.SRGBColorSpace);
  assert.equal(state.textures.macroTint.colorSpace, THREE.NoColorSpace);
  assert.equal(state.textures.terrainShape.type, THREE.HalfFloatType);
  assert.equal(state.textures.farNormal.type, THREE.ByteType);
  assert.deepEqual(state.textures.farNormal.image.data, baked.channels.farNormal);

  assert.equal(uploadTerrainMaterialBakeGpu(material, baked), 0);
  for (const [name, texture] of Object.entries(textureReferences)) {
    assert.strictEqual(state.textures[name], texture);
  }

  clearTerrainMaterialBakeGpu(material);
  assert.equal(state.ready.value, 0);
  assert.equal(state.stale.value, 0);
  assert.equal(state.blend.value, 0);
});

test('material disposal releases every owned bake texture exactly once', () => {
  const { material, state } = materialWithState();
  let disposed = 0;
  for (const texture of Object.values(state.textures)) {
    texture.addEventListener('dispose', () => {
      disposed += 1;
    });
  }

  material.dispatchEvent({ type: 'dispose' });
  material.dispatchEvent({ type: 'dispose' });
  assert.equal(disposed, 7);
  assert.equal(state.disposed, true);
  assert.equal(state.ready.value, 0);
  assert.equal(state.blend.value, 0);
});

test('GPU bridge fades a newly published bake without reallocating its textures', () => {
  const { material, state } = materialWithState();
  const slot = {
    slotIndex: 0,
    descriptor: { key: '0:0' },
    mesh: { visible: true },
    material,
    materialBake: page(),
    materialBakeStale: false,
  };
  let now = 1000;
  const bridge = new TerrainMaterialBakeGpuBridge({
    terrainView: { slots: [slot] },
    config: config(),
    now: () => now,
  });

  bridge.update();
  assert.equal(state.ready.value, 1);
  assert.equal(state.blend.value, 0);

  now = 1050;
  bridge.update();
  assert.equal(state.blend.value, 0.5);

  now = 1100;
  bridge.update();
  assert.equal(state.blend.value, 1);
  bridge.dispose();
});

test('GPU bridge publishes a bake and disables it immediately when the slot loses residency', () => {
  const { material, state } = materialWithState();
  const slot = {
    slotIndex: 0,
    descriptor: { key: '0:0' },
    mesh: { visible: true },
    material,
    materialBake: page(),
    materialBakeStale: true,
  };
  const bridge = new TerrainMaterialBakeGpuBridge({
    terrainView: { slots: [slot] },
    config: { render: { publishFadeMs: 0 } },
  });

  bridge.update();
  assert.equal(state.ready.value, 1);
  assert.equal(state.stale.value, 1);
  assert.equal(state.blend.value, 1);

  slot.materialBake = null;
  bridge.update();
  assert.equal(state.ready.value, 0);
  assert.equal(state.stale.value, 0);
  assert.equal(state.blend.value, 0);

  bridge.dispose();
});

test('GPU bridge isolates a malformed page and retries only after the bake revision changes', () => {
  const { material, state } = materialWithState();
  const broken = page('broken');
  broken.channels.farColor = new Uint8Array(1);
  const slot = {
    slotIndex: 0,
    descriptor: { key: '0:0' },
    mesh: { visible: true },
    material,
    materialBake: broken,
    materialBakeStale: false,
  };
  let errors = 0;
  const bridge = new TerrainMaterialBakeGpuBridge({
    terrainView: { slots: [slot] },
    config: { render: { publishFadeMs: 0 } },
    onError: () => {
      errors += 1;
    },
  });

  bridge.update();
  bridge.update();
  assert.equal(errors, 1);
  assert.equal(state.ready.value, 0);

  slot.materialBake = page('repaired');
  bridge.update();
  assert.equal(errors, 1);
  assert.equal(state.ready.value, 1);
  bridge.dispose();
});
