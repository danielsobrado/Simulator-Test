import * as THREE from 'three/webgpu';
import { generateTerrainMaterialFamilyPixels } from './TerrainMaterialFamilyPixels.js';

const atlasEntries = new Map();

function atlasKey(config) {
  const families = config.families;
  return JSON.stringify({
    seed: families.seed,
    resolution: families.resolution,
    variantsPerFamily: families.variantsPerFamily,
    profiles: families.profiles,
  });
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
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, resolution, depth, refs: 0 };
}

export function acquireTerrainMaterialFamilyAtlas(config) {
  if (!config?.families?.enabled) return null;
  const key = atlasKey(config);
  let entry = atlasEntries.get(key);
  if (!entry) {
    entry = createAtlas(config);
    atlasEntries.set(key, entry);
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
