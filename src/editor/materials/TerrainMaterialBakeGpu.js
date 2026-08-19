import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

const MATERIAL_BAKE_GPU_KEY = 'terrainMaterialBakeGpu';

const CHANNEL_LAYOUTS = Object.freeze({
  macroTint: Object.freeze({
    components: 4,
    ArrayType: Uint8Array,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
  }),
  terrainShape: Object.freeze({
    components: 2,
    ArrayType: Uint16Array,
    format: THREE.RGFormat,
    type: THREE.HalfFloatType,
    colorSpace: THREE.NoColorSpace,
  }),
  materialWeights: Object.freeze({
    components: 4,
    ArrayType: Uint8Array,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
  }),
  wetnessShoreline: Object.freeze({
    components: 2,
    ArrayType: Uint8Array,
    format: THREE.RGFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
  }),
  farColor: Object.freeze({
    components: 4,
    ArrayType: Uint8Array,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.SRGBColorSpace,
  }),
  farNormal: Object.freeze({
    components: 2,
    ArrayType: Int8Array,
    format: THREE.RGFormat,
    type: THREE.ByteType,
    colorSpace: THREE.NoColorSpace,
  }),
  canopyWater: Object.freeze({
    components: 2,
    ArrayType: Uint8Array,
    format: THREE.RGFormat,
    type: THREE.UnsignedByteType,
    colorSpace: THREE.NoColorSpace,
  }),
});

function createTexture(layout, resolution) {
  const pixels = new layout.ArrayType(resolution * resolution * layout.components);
  const texture = new THREE.DataTexture(
    pixels,
    resolution,
    resolution,
    layout.format,
    layout.type,
  );
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.unpackAlignment = 1;
  texture.colorSpace = layout.colorSpace;
  texture.needsUpdate = true;
  return texture;
}

function assertBakePage(page, resolution) {
  if (!page?.descriptor?.key || page.resolution !== resolution || !page.channels) {
    throw new Error('Terrain material GPU upload requires a matching baked page.');
  }
  for (const [name, layout] of Object.entries(CHANNEL_LAYOUTS)) {
    const pixels = page.channels[name];
    const expectedLength = resolution * resolution * layout.components;
    if (!(pixels instanceof layout.ArrayType) || pixels.length !== expectedLength) {
      throw new Error(`Terrain material GPU channel ${name} does not match its layout.`);
    }
  }
}

export function createTerrainMaterialBakeGpuState(config) {
  if (!config?.enabled) return null;
  const resolution = config.qualityTiers?.[config.quality]?.resolution;
  if (!Number.isInteger(resolution) || resolution <= 0) {
    throw new Error('Terrain material GPU state requires a valid bake resolution.');
  }

  const textures = {};
  for (const [name, layout] of Object.entries(CHANNEL_LAYOUTS)) {
    textures[name] = createTexture(layout, resolution);
  }

  return {
    resolution,
    textures: Object.freeze(textures),
    ready: uniform(0),
    stale: uniform(0),
    blend: uniform(0),
    key: null,
    disposed: false,
  };
}

export function attachTerrainMaterialBakeGpuState(material, state) {
  if (!state) return;
  material.userData[MATERIAL_BAKE_GPU_KEY] = state;
  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    for (const texture of Object.values(state.textures)) texture.dispose();
    state.ready.value = 0;
    state.stale.value = 0;
    state.blend.value = 0;
    state.key = null;
    material.removeEventListener('dispose', dispose);
  };
  material.addEventListener('dispose', dispose);
}

export function getTerrainMaterialBakeGpuState(material) {
  return material?.userData?.[MATERIAL_BAKE_GPU_KEY] ?? null;
}

export function clearTerrainMaterialBakeGpu(material) {
  const state = getTerrainMaterialBakeGpuState(material);
  if (!state || state.disposed) return;
  state.ready.value = 0;
  state.stale.value = 0;
  state.blend.value = 0;
}

export function uploadTerrainMaterialBakeGpu(material, page, { stale = false } = {}) {
  const state = getTerrainMaterialBakeGpuState(material);
  if (!state || state.disposed) return 0;
  assertBakePage(page, state.resolution);

  let uploadedBytes = 0;
  if (state.key !== page.descriptor.key) {
    for (const [name, texture] of Object.entries(state.textures)) {
      const source = page.channels[name];
      texture.image.data.set(source);
      texture.needsUpdate = true;
      uploadedBytes += source.byteLength;
    }
    state.key = page.descriptor.key;
    state.blend.value = 0;
  }
  state.ready.value = 1;
  state.stale.value = stale ? 1 : 0;
  return uploadedBytes;
}
