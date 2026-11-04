import * as THREE from 'three/webgpu';

/**
 * Packs the kit's textures into two array textures (albedo and normal) and
 * describes every kit material as one row of a table the town material indexes
 * per vertex — so all opaque kit surfaces share a single material and a module
 * draws once.
 *
 * Layer 0 of each array is neutral (white albedo, flat normal) for untextured
 * materials such as gold or water. Materials that share an image share a layer.
 * Albedo layers keep the kit's 1k detail; normal layers are half size, which
 * the normal map's low-frequency relief hardly needs.
 */

export const ALBEDO_SIZE = 1024;
export const NORMAL_SIZE = 512;

/** Draws an image into a size x size RGBA8 buffer (browser only; injectable for tests). */
export function readImagePixels(image, size) {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0, size, size);
  return context.getImageData(0, 0, size, size).data;
}

function arrayTexture(layers, size, colorSpace) {
  const data = new Uint8Array(size * size * 4 * layers.length);
  layers.forEach((pixels, layer) => data.set(pixels, layer * size * size * 4));
  const texture = new THREE.DataArrayTexture(data, size, size, layers.length);
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

function solidLayer(size, rgba) {
  const pixels = new Uint8Array(size * size * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(rgba, i);
  return pixels;
}

export class TownKitAtlas {
  /**
   * @param {Iterable<THREE.Material>} materials the near kit's opaque materials
   * @param {(image, size) => Uint8Array|Uint8ClampedArray} [readPixels]
   */
  constructor(materials, readPixels = readImagePixels) {
    this.entries = new Map();
    this.rows = [];
    const albedoLayers = [solidLayer(ALBEDO_SIZE, [255, 255, 255, 255])];
    const normalLayers = [solidLayer(NORMAL_SIZE, [128, 128, 255, 255])];
    const albedoByImage = new Map();
    const normalByImage = new Map();
    const layerFor = (texture, byImage, layers, size) => {
      const image = texture?.image;
      if (!image) return 0;
      if (!byImage.has(image)) {
        byImage.set(image, layers.length);
        layers.push(readPixels(image, size));
      }
      return byImage.get(image);
    };
    // Roughness uses the spare normal alpha channel: no new array or shader tap.
    // Deduplicate pairs, since two materials can share normals but differ in finish.
    const surfaceLayer = (material) => {
      const normal = material.normalMap?.image;
      const roughness = material.roughnessMap?.image;
      if (!normal && !roughness) return 0;
      let finishes = normalByImage.get(normal);
      if (!finishes) { finishes = new Map(); normalByImage.set(normal, finishes); }
      if (!finishes.has(roughness)) {
        const pixels = normal ? new Uint8Array(readPixels(normal, NORMAL_SIZE))
          : solidLayer(NORMAL_SIZE, [128, 128, 255, 255]);
        const rough = roughness ? readPixels(roughness, NORMAL_SIZE) : null;
        for (let i = 3; i < pixels.length; i += 4) pixels[i] = rough ? rough[i - 2] : 255;
        finishes.set(roughness, normalLayers.length);
        normalLayers.push(pixels);
      }
      return finishes.get(roughness);
    };
    for (const material of materials) {
      if (this.entries.has(material.name)) continue;
      const row = Object.freeze({
        index: this.rows.length,
        name: material.name,
        albedoLayer: layerFor(material.map, albedoByImage, albedoLayers, ALBEDO_SIZE),
        normalLayer: surfaceLayer(material),
        color: material.color ? material.color.toArray() : [1, 1, 1],
        roughness: material.roughness ?? 0.9,
        metalness: material.metalness ?? 0,
        emissive: (material.emissiveIntensity ?? 0) * (material.emissive?.getHex?.() ? 1 : 0),
      });
      this.entries.set(material.name, row);
      this.rows.push(row);
    }
    this.albedo = arrayTexture(albedoLayers, ALBEDO_SIZE, THREE.SRGBColorSpace);
    this.normal = arrayTexture(normalLayers, NORMAL_SIZE, THREE.NoColorSpace);
    this.albedo.name = 'town-kit-albedo';
    this.normal.name = 'town-kit-normal';
  }

  index(materialName) {
    return this.entries.get(materialName)?.index ?? 0;
  }

  row(materialName) {
    return this.entries.get(materialName) ?? null;
  }

  /** The albedo layer of another material, for swaps such as stone to ashlar. */
  albedoLayer(materialName) {
    return this.entries.get(materialName)?.albedoLayer ?? 0;
  }

  dispose() {
    this.albedo.dispose();
    this.normal.dispose();
  }
}
