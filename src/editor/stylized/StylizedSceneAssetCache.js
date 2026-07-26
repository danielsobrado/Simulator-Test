import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { disposeScene, normalizeBaseUrl, resolveAssetUrl } from '../assets/assetUrl.js';
import { assetStartupTelemetry } from '../performance/AssetStartupTelemetry.js';

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

function instrumentKtx2Loader(ktx2Loader, telemetry) {
  const load = ktx2Loader.load.bind(ktx2Loader);
  ktx2Loader.load = (url, onLoad, onProgress, onError) => {
    const startedAt = telemetry.clock();
    let finished = false;
    const finish = (texture, error = null) => {
      if (finished) return;
      finished = true;
      telemetry.recordKtx2({
        durationMs: telemetry.clock() - startedAt,
        texture,
        error,
      });
    };
    return load(
      url,
      (texture) => {
        finish(texture);
        onLoad?.(texture);
      },
      onProgress,
      (error) => {
        finish(null, error);
        onError?.(error);
      },
    );
  };
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

export function createStylizedSceneLoader({ renderer, telemetry = assetStartupTelemetry }) {
  if (!renderer) {
    throw new Error('A renderer is required to initialize KTX2 texture support.');
  }
  const ktx2Loader = new KTX2Loader().detectSupport(renderer);
  telemetry.setKtx2Support(ktx2Loader.workerConfig);
  instrumentKtx2Loader(ktx2Loader, telemetry);
  const loader = new GLTFLoader()
    .setMeshoptDecoder(instrumentMeshoptDecoder(telemetry))
    .setKTX2Loader(ktx2Loader);
  instrumentAssetLoads(loader, telemetry);
  return { loader, ktx2Loader };
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
      this.ktx2Loader = null;
    } else {
      const configured = createStylizedSceneLoader({ renderer, baseUrl: this.baseUrl });
      this.loader = configured.loader;
      this.ktx2Loader = configured.ktx2Loader;
    }
    this.entries = new Map();
  }

  resolveUrl(path) {
    return resolveAssetUrl(this.baseUrl, path);
  }

  async acquire(path) {
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
        entry.scene = gltf.scene;
        return gltf.scene;
      }).catch((error) => {
        this.entries.delete(path);
        throw error;
      });
      this.entries.set(path, entry);
    }

    entry.refs += 1;
    try {
      return await entry.promise;
    } catch (error) {
      entry.refs -= 1;
      if (entry.refs <= 0) this.entries.delete(path);
      throw error;
    }
  }

  release(path) {
    const entry = this.entries.get(path);
    if (!entry) return;
    entry.refs -= 1;
    if (entry.refs > 0) return;
    this.entries.delete(path);
    if (entry.scene) disposeScene(entry.scene);
    entry.scene = null;
  }

  dispose() {
    for (const entry of this.entries.values()) {
      if (entry.scene) disposeScene(entry.scene);
    }
    this.entries.clear();
    this.ktx2Loader?.dispose();
    this.ktx2Loader = null;
  }
}
