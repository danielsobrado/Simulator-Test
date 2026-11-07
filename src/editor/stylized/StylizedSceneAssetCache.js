import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { disposeScene, normalizeBaseUrl, resolveAssetUrl } from '../assets/assetUrl.js';
import { assetStartupTelemetry } from '../performance/AssetStartupTelemetry.js';
import { acquireKtx2Loader } from '../assets/sharedKtx2Loader.js';

function instrumentMeshoptDecoder(telemetry) {
  const decoder = Object.create(MeshoptDecoder);
  decoder.decodeGltfBufferAsync = async (...args) => {
    const startedAt = telemetry.clock();
    const decoded = await MeshoptDecoder.decodeGltfBufferAsync(...args);
    telemetry.recordMeshopt({
      durationMs: telemetry.clock() - startedAt,
      compressedBytes: args[2]?.byteLength ?? 0,
      decodedBytes: decoded?.byteLength ?? 0,
    });
    return decoded;
  };
  return decoder;
}

function instrumentAssetLoads(loader, telemetry) {
  const loadAsync = loader.loadAsync.bind(loader);
  loader.loadAsync = async (url, ...args) => {
    const token = telemetry.beginAsset(url);
    try {
      const result = await loadAsync(url, ...args);
      telemetry.endAsset(token);
      return result;
    } catch (error) {
      telemetry.endAsset(token, error);
      throw error;
    }
  };
}

/**
 * A GLTF loader on the renderer's shared KTX2 loader. Call `release` (never
 * `ktx2Loader.dispose()`) when done: other owners share the transcoder workers.
 */
export function createStylizedSceneLoader({ renderer, baseUrl = '/', telemetry = assetStartupTelemetry }) {
  const { loader: ktx2Loader, release } = acquireKtx2Loader(renderer, baseUrl, telemetry);
  const loader = new GLTFLoader()
    .setMeshoptDecoder(instrumentMeshoptDecoder(telemetry))
    .setKTX2Loader(ktx2Loader);
  instrumentAssetLoads(loader, telemetry);
  return { loader, ktx2Loader, release };
}

/**
 * Reference-counted GLB scene cache so rocks and trees share one parse of
 * grass-scene.glb instead of loading it twice (Flyweight + acquire/release).
 */
export class StylizedSceneAssetCache {
  constructor({ loader = null, renderer = null, baseUrl = '/' } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    if (loader) {
      this.loader = loader;
      this.releaseKtx2 = null;
    } else {
      const configured = createStylizedSceneLoader({ renderer, baseUrl: this.baseUrl });
      this.loader = configured.loader;
      this.releaseKtx2 = configured.release;
    }
    this.entries = new Map();
    this.disposed = false;
  }

  resolveUrl(path) {
    return resolveAssetUrl(this.baseUrl, path);
  }

  async acquire(path) {
    if (this.disposed) {
      throw new Error('Cannot acquire a scene asset after cache disposal.');
    }

    let entry = this.entries.get(path);
    if (!entry) {
      entry = {
        promise: null,
        scene: null,
        refs: 0,
      };
      entry.promise = this.loader.loadAsync(this.resolveUrl(path)).then((gltf) => {
        if (!gltf?.scene) {
          throw new Error(`GLB ${path} contains no default scene.`);
        }
        if (this.disposed || entry.refs <= 0 || this.entries.get(path) !== entry) {
          disposeScene(gltf.scene);
          throw new Error(`Scene asset ${path} was released before loading completed.`);
        }
        entry.scene = gltf.scene;
        return gltf.scene;
      }).catch((error) => {
        if (this.entries.get(path) === entry) this.entries.delete(path);
        throw error;
      });
      this.entries.set(path, entry);
    }

    entry.refs += 1;
    try {
      const scene = await entry.promise;
      if (this.disposed || entry.refs <= 0 || this.entries.get(path) !== entry) {
        throw new Error(`Scene asset ${path} is no longer acquired.`);
      }
      return scene;
    } catch (error) {
      entry.refs = Math.max(0, entry.refs - 1);
      if (entry.refs <= 0 && this.entries.get(path) === entry) {
        this.entries.delete(path);
        if (entry.scene) disposeScene(entry.scene);
        entry.scene = null;
      }
      throw error;
    }
  }

  release(path) {
    const entry = this.entries.get(path);
    if (!entry) return;
    entry.refs = Math.max(0, entry.refs - 1);
    if (entry.refs > 0) return;
    if (!entry.scene) return;
    this.entries.delete(path);
    disposeScene(entry.scene);
    entry.scene = null;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) {
      entry.refs = 0;
      if (entry.scene) disposeScene(entry.scene);
      entry.scene = null;
    }
    this.entries.clear();
    this.releaseKtx2?.();
    this.releaseKtx2 = null;
  }
}
