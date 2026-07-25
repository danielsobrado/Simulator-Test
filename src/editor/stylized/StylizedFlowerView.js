import * as THREE from 'three/webgpu';
import { normalizeBaseUrl, resolveAssetUrl } from '../assets/assetUrl.js';
import { StylizedFlowerSlot } from './StylizedFlowerSlot.js';

function configureTexture(texture, colorSpace = THREE.NoColorSpace) {
  texture.colorSpace = colorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function createCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function combineTextures(left, right, colorSpace) {
  const width = Math.max(left.image.width, right.image.width);
  const height = Math.max(left.image.height, right.image.height);
  const canvas = createCanvas(width * 2, height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Flower atlas creation requires a 2D canvas context.');
  context.clearRect(0, 0, width * 2, height);
  context.drawImage(left.image, 0, 0, width, height);
  context.drawImage(right.image, width, 0, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  return configureTexture(texture, colorSpace);
}

export class StylizedFlowerView {
  constructor({
    terrainView,
    config,
    baseUrl = '/',
    loader = new THREE.TextureLoader(),
    forestFieldProvider = null,
  }) {
    this.terrainView = terrainView;
    this.config = config;
    this.forestFieldProvider = forestFieldProvider;
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.loader = loader;
    this.textures = [];
    this.slots = [];
    this.disposed = false;
    this.ready = this.load();
  }

  resolveUrl(path) {
    return resolveAssetUrl(this.baseUrl, path);
  }

  async loadTexture(path) {
    return configureTexture(await this.loader.loadAsync(this.resolveUrl(path)));
  }

  async loadSet(definition) {
    const [mask, zones, gradient] = await Promise.all([
      this.loadTexture(definition.mask),
      this.loadTexture(definition.zones),
      this.loadTexture(definition.gradient),
    ]);
    return { mask, zones, gradient };
  }

  async load() {
    if (!this.config.flowers.enabled) return;
    const [variantA, variantB] = await Promise.all([
      this.loadSet(this.config.assets.flowerA),
      this.loadSet(this.config.assets.flowerB),
    ]);
    if (this.disposed) return;
    const atlas = {
      mask: combineTextures(variantA.mask, variantB.mask, THREE.NoColorSpace),
      zones: combineTextures(variantA.zones, variantB.zones, THREE.NoColorSpace),
      gradient: combineTextures(variantA.gradient, variantB.gradient, THREE.NoColorSpace),
    };
    for (const texture of Object.values(variantA)) texture.dispose();
    for (const texture of Object.values(variantB)) texture.dispose();
    this.textures.push(atlas.mask, atlas.zones, atlas.gradient);
    this.slots = this.terrainView.slots.map((terrainSlot) => new StylizedFlowerSlot({
      terrainSlot,
      terrainView: this.terrainView,
      config: this.config,
      textures: atlas,
      forestFieldProvider: this.forestFieldProvider,
    }));
  }

  update(timestamp) {
    if (this.disposed || this.slots.length === 0 || !this.terrainView.focusChunkKey) return;
    const focusChunk = this.terrainView.focusChunk;
    for (const slot of this.slots) slot.update(timestamp, focusChunk);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const slot of this.slots) slot.dispose();
    this.slots.length = 0;
    for (const texture of this.textures) texture.dispose();
    this.textures.length = 0;
  }
}
