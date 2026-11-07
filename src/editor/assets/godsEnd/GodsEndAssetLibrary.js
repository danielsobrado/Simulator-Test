import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { acquireKtx2Loader } from '../sharedKtx2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { StylizedSceneAssetCache } from '../../stylized/StylizedSceneAssetCache.js';
import { resolveAssetUrl } from '../assetUrl.js';
import { createGodsEndAssetParts } from './assetParts.js';
import { disposeModelParts } from '../modelParts.js';

/** Acquires only selected or saved objects; unused catalog entries allocate no GPU resources. */
export class GodsEndAssetLibrary {
  constructor({ renderer, objectMap, objectView, controller, baseUrl = '/', cache = null, houseFactory = null }) {
    Object.assign(this, { objectMap, objectView, controller, baseUrl });
    this.definitions = new Map([...objectMap.definitionByKey].filter(([, definition]) => definition.asset));
    this.pending = new Map();
    this.installed = new Map();
    this.failed = new Set();
    this.disposed = false;
    this.houseFactory = houseFactory ?? (async (asset) => {
      const { createGodsEndHouseParts } = await import('./village/houseParts.js');
      return createGodsEndHouseParts(asset);
    });
    this.proceduralFactories = new Map([
      ['house', this.houseFactory],
      ['aquatic', async (asset) => {
        const { createGodsEndAquaticParts } = await import('./aquatic/aquaticParts.js');
        return createGodsEndAquaticParts(asset);
      }],
      ['seabedRock', async (asset) => {
        const { createGodsEndSeabedRockParts } = await import('./seabed/seabedParts.js');
        return createGodsEndSeabedRockParts(asset);
      }],
    ]);
    // Loader creation is deferred until an actual GLB is needed.
    this.renderer = renderer;
    this.cache = cache;
    this.unsubscribe = controller.subscribe((state) => {
      this.selectedKey = state.tool === 'object' ? state.selectedObjectKey : null;
      if (this.selectedKey) this.request(this.selectedKey);
      this.prune();
    });
    this.unsubscribeMap = controller.subscribeMap(() => this.restorePlaced());
    this.restorePlaced();
  }

  getCache() {
    if (this.cache) return this.cache;
    this.draco = new DRACOLoader().setDecoderPath(resolveAssetUrl(this.baseUrl, 'assets/gods-end/decoders/draco/'));
    this.ktx2 = acquireKtx2Loader(this.renderer, this.baseUrl);
    const loader = new GLTFLoader().setDRACOLoader(this.draco).setKTX2Loader(this.ktx2.loader).setMeshoptDecoder(MeshoptDecoder);
    this.cache = new StylizedSceneAssetCache({ loader, baseUrl: this.baseUrl });
    return this.cache;
  }

  restorePlaced() {
    for (const object of this.objectMap.list()) this.request(object.definitionKey);
    this.prune();
  }

  request(key) {
    if (!this.definitions.has(key) || this.disposed || this.failed.has(key)) return;
    void this.ensure(key).catch((error) => {
      if (this.disposed) return;
      this.failed.add(key);
      this.controller.emitNotice(`Could not load ${this.definitions.get(key).label}: ${error.message}`, true);
    });
  }

  ensure(key) {
    if (this.installed.has(key)) return Promise.resolve();
    if (this.pending.has(key)) return this.pending.get(key);
    const definition = this.definitions.get(key);
    if (!definition || this.disposed) return Promise.resolve();
    const task = this.load(definition).finally(() => this.pending.delete(key));
    this.pending.set(key, task);
    return task;
  }

  async load(definition) {
    const asset = definition.asset;
    let acquired = false;
    let transferred = false;
    let parts;
    try {
      const factory = this.proceduralFactories.get(asset.kind);
      if (factory) parts = await factory(asset);
      else {
        const scene = await this.getCache().acquire(asset.path);
        acquired = true;
        parts = createGodsEndAssetParts(scene, asset);
      }
      if (this.disposed) {
        return;
      }
      this.objectView.registerDefinition(definition, parts);
      transferred = true;
      this.installed.set(definition.key, acquired ? asset.path : null);
      acquired = false; // Reference ownership transfers to installed.
      this.controller.updatePreviews();
      this.prune();
    } finally {
      if (parts && !transferred) disposeModelParts(parts);
      if (acquired) this.cache.release(asset.path);
    }
  }

  prune() {
    const wanted = new Set(this.objectMap.list().map((object) => object.definitionKey));
    if (this.selectedKey) wanted.add(this.selectedKey);
    for (const [key, assetPath] of this.installed) {
      if (wanted.has(key)) continue;
      this.objectView.clearAssetParts(key);
      if (assetPath) this.cache.release(assetPath);
      this.installed.delete(key);
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    this.unsubscribeMap?.();
    for (const [key, assetPath] of this.installed) {
      this.objectView.clearAssetParts(key);
      if (assetPath) this.cache.release(assetPath);
    }
    this.installed.clear();
    this.cache?.dispose();
    this.draco?.dispose();
    this.ktx2?.release();
  }
}
