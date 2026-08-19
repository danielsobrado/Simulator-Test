import * as THREE from 'three/webgpu';
import { PerfCounters } from '../performance/qa/PerfCounters.js';
import { generateTerrainMaterialFamilyPixels } from './TerrainMaterialFamilyPixels.js';

const atlasEntries = new Map();
const FULL_MIP_CHAIN_RATIO = 4 / 3;

function publishCounters() {
  let bytes = 0;
  for (const entry of atlasEntries.values()) bytes += entry.estimatedGpuBytes;
  PerfCounters.set('terrainMaterialFamilyAtlasEntries', atlasEntries.size);
  PerfCounters.set('terrainMaterialFamilyAtlasBytes', bytes);
}

function createAtlas(config) {
  const { pixels, resolution, depth } = generateTerrainMaterialFamilyPixels(config);
  const texture = new THREE.DataArrayTexture(pixels, resolution, resolution, depth);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return {
    texture,
    resolution,
    depth,
    refs: 0,
    estimatedGpuBytes: Math.ceil(pixels.byteLength * FULL_MIP_CHAIN_RATIO),
  };
}

export function acquireTerrainMaterialFamilyAtlas(config) {
  const key = config?.families;
  if (!config?.enabled || !key?.enabled) return null;
  let entry = atlasEntries.get(key);
  if (!entry) {
    entry = createAtlas(config);
    atlasEntries.set(key, entry);
    publishCounters();
  }
  entry.refs += 1;
  let released = false;
  return Object.freeze({
    texture: entry.texture,
    resolution: entry.resolution,
    depth: entry.depth,
    release() {
      if (released) return;
      released = true;
      entry.refs -= 1;
      if (entry.refs <= 0 && atlasEntries.get(key) === entry) {
        atlasEntries.delete(key);
        entry.texture.dispose();
        publishCounters();
      }
    },
  });
}

export function attachTerrainMaterialFamilyAtlas(material, lease) {
  if (!lease) return;
  const dispose = () => {
    lease.release();
    material.removeEventListener('dispose', dispose);
  };
  material.addEventListener('dispose', dispose);
}

export function getTerrainMaterialFamilyAtlasEntryCount() {
  return atlasEntries.size;
}
