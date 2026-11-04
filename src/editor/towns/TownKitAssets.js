import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import { resolveAssetUrl } from '../assets/assetUrl.js';
import { TownKitAtlas, readImagePixels } from './TownKitAtlas.js';
import { mergeKitModule } from './TownKitGeometry.js';

export const TOWN_KIT_GLB = 'assets/environment/medieval-kit/medieval_kit.glb';
export const TOWN_KIT_LOD_GLB = 'assets/environment/medieval-kit/medieval_kit_lod1.glb';
export const TOWN_KIT_PREFABS = 'assets/environment/medieval-kit/medieval_kit_prefabs.json';
export const GLASS_MATERIAL = 'M_glass';

/**
 * The medieval kit, loaded on first use, repacked for the shared town material.
 *
 * Each module becomes one opaque geometry (all its kit materials merged, each
 * vertex naming its material — TownKitGeometry) plus its window glass. The near
 * kit's textures go into the atlas's array textures (TownKitAtlas); the far kit
 * (medieval_kit_lod1.glb: same module names, no close-up detail, no textures)
 * indexes the same atlas by material name. The far kit is optional: if it fails
 * to load, far towns keep drawing the near kit. Modules the kit flags as
 * interior (floors, stairs, furniture) are listed so towns can draw them only
 * near the viewer.
 *
 * Nothing here blocks startup — the first town to come within reach triggers
 * the load (docs/asset-startup-and-variant-residency.md).
 */
export class TownKitAssets {
  constructor({
    baseUrl = '/',
    loader = new GLTFLoader(),
    fetchJson = defaultFetchJson,
    readPixels = readImagePixels,
  } = {}) {
    this.baseUrl = baseUrl;
    this.loader = loader;
    this.fetchJson = fetchJson;
    this.readPixels = readPixels;
    this.promise = null;
    this.ready = false;
    this.failed = null;
    /** module name -> { opaque: BufferGeometry|null, glass: BufferGeometry[] } */
    this.modules = new Map();
    this.farModules = new Map();
    this.interior = new Set();
    this.atlas = null;
    this.glassSource = null;
    this.kit = null;
  }

  ensure() {
    if (!this.promise) {
      this.promise = this.load().then(() => {
        this.ready = true;
      }, (error) => {
        this.failed = error;
        console.warn('Town kit unavailable; settlements will not be drawn.', error);
      });
    }
    return this.promise;
  }

  async load() {
    const [gltf, kit, far] = await Promise.all([
      this.loader.loadAsync(resolveAssetUrl(this.baseUrl, TOWN_KIT_GLB)),
      this.fetchJson(resolveAssetUrl(this.baseUrl, TOWN_KIT_PREFABS)),
      this.loader.loadAsync(resolveAssetUrl(this.baseUrl, TOWN_KIT_LOD_GLB)).catch((error) => {
        console.warn('Town far kit unavailable; far towns keep the near kit.', error);
        return null;
      }),
    ]);
    this.kit = kit;
    const near = primitivesByModule(gltf);
    const materials = new Map();
    for (const { primitives } of near.values()) {
      for (const { material } of primitives) materials.set(material.name, material);
    }
    this.glassSource = materials.get(GLASS_MATERIAL) ?? null;
    materials.delete(GLASS_MATERIAL);
    this.atlas = new TownKitAtlas(materials.values(), this.readPixels);
    this.repack(near, this.modules);
    if (far) {
      const farByModule = primitivesByModule(far);
      this.repack(farByModule, this.farModules);
      const farMaterials = new Set();
      for (const { primitives } of farByModule.values()) for (const { material } of primitives) farMaterials.add(material);
      disposeSourceMaterials([...farMaterials]);
    }
    for (const [name, { interior }] of near) if (interior) this.interior.add(name);
    disposeSourceMaterials([...materials.values()]);
  }

  repack(byModule, into) {
    const index = (name) => this.atlas.index(name);
    const isGlass = (name) => name === GLASS_MATERIAL;
    for (const [module, { primitives }] of byModule) {
      const merged = mergeKitModule(module, primitives.map(({ geometry, material }) => (
        { geometry, materialName: material.name })), index, isGlass);
      into.set(module, Object.freeze({
        opaque: merged.opaque,
        glass: merged.glass.map(({ geometry }) => geometry),
      }));
      for (const { geometry } of primitives) {
        if (!merged.glass.some((g) => g.geometry === geometry)) geometry.dispose();
      }
    }
  }

  isInterior(module) {
    return this.interior.has(module);
  }

  dispose() {
    for (const map of [this.modules, this.farModules]) {
      for (const { opaque, glass } of map.values()) {
        opaque?.dispose();
        for (const geometry of glass) geometry.dispose();
      }
      map.clear();
    }
    this.atlas?.dispose();
    this.glassSource?.map?.dispose();
    this.glassSource?.dispose();
  }
}

/** module name -> { interior, primitives: [{ geometry, material }] } from a kit glTF. */
function primitivesByModule(gltf) {
  const out = new Map();
  for (const node of gltf.scene.children) {
    const primitives = [];
    node.traverse((child) => {
      if (child.isMesh) primitives.push({ geometry: child.geometry, material: child.material });
    });
    if (primitives.length) {
      out.set(node.name, { interior: node.userData?.kit_interior === true, primitives });
    }
  }
  return out;
}

/** The atlas copied their pixels; release the source textures (but keep the glass map). */
function disposeSourceMaterials(materials) {
  const textures = new Set();
  const images = new Set();
  for (const material of materials) {
    for (const map of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap]) if (map) textures.add(map);
    material.dispose();
  }
  for (const map of textures) { if (map.image) images.add(map.image); map.dispose(); }
  for (const image of images) image.close?.();
}

async function defaultFetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.json();
}
