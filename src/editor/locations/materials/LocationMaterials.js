import * as THREE from 'three/webgpu';
import { createGlowMaterial } from '../LocationEffects.js';
import { createGlacierIceMaterial } from './GlacierIceMaterial.js';
import { createStoneMaterial } from './StoneSurface.js';

/**
 * Builds a site's material set from its resolved config and owns what it
 * loaded: textures are fetched when a location is entered and disposed when it
 * is left, never at startup.
 */
export class LocationMaterials {
  constructor({ baseUrl, anisotropy = 8 }) {
    this.baseUrl = baseUrl;
    this.anisotropy = anisotropy;
    this.loader = new THREE.TextureLoader();
    this.textures = new Map();
    this.materials = [];
  }

  async #texture(path, colorSpace) {
    if (!this.textures.has(path)) {
      this.textures.set(path, this.loader.loadAsync(`${this.baseUrl}${path}`).then((texture) => {
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.colorSpace = colorSpace;
        texture.anisotropy = this.anisotropy;
        return texture;
      }));
    }
    return this.textures.get(path);
  }

  async #maps(files) {
    const [color, normal, rough] = await Promise.all([
      this.#texture(files.color, THREE.SRGBColorSpace),
      this.#texture(files.normal, THREE.NoColorSpace),
      this.#texture(files.rough, THREE.NoColorSpace),
    ]);
    return { color, normal, rough };
  }

  /**
   * @param {Record<string, object>} entries a resolved site's `materials`
   * @param {{ iceLayers: number }} quality
   * @returns {Promise<Record<string, { material: Material, ice: number }>>} keyed for `LocationBuilder.build`
   */
  async create(entries, quality) {
    const set = {};
    for (const [key, entry] of Object.entries(entries)) {
      let material;
      if (entry.kind === 'glow') {
        material = createGlowMaterial();
      } else if (entry.kind === 'ice') {
        const maps = {
          ice: await this.#maps(entry.surfaces.ice), cracks: await this.#maps(entry.surfaces.cracks),
          snow: await this.#maps(entry.surfaces.snow),
        };
        if (entry.surfaces.rock) maps.rock = await this.#maps(entry.surfaces.rock);
        material = createGlacierIceMaterial(`location-${key}`, {
          profile: entry.profile, maps, stoneProfile: entry.bedrock, layers: quality.iceLayers, masked: entry.masked,
        });
      } else {
        const profile = entry.masked ? entry.profile : { ...entry.profile, vertexTint: true };
        const maps = await this.#maps(entry.surfaces.stone);
        if (entry.surfaces.floor) maps.floor = await this.#maps(entry.surfaces.floor);
        if (entry.surfaces.alt) maps.alt = await this.#maps(entry.surfaces.alt);
        material = createStoneMaterial(`location-${key}`, profile, maps, { masked: entry.masked });
      }
      this.materials.push(material);
      set[key] = {
        material,
        ice: entry.kind === 'ice' ? 1 : 0,
        woodGrain: Boolean(entry.profile?.woodGrain),
      };
    }
    return set;
  }

  dispose() {
    for (const material of this.materials.splice(0)) material.dispose();
    for (const pending of this.textures.values()) pending.then((texture) => texture.dispose(), () => {});
    this.textures.clear();
  }
}
