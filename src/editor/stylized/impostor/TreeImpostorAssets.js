import * as THREE from 'three/webgpu';
import { normalizeBaseUrl, resolveAssetUrl } from '../../assets/assetUrl.js';
import {
  TREE_IMPOSTOR_MANIFEST_VERSION,
  TREE_IMPOSTOR_NORMAL_ENCODING,
  validateTreeImpostorManifest,
} from './TreeImpostorManifest.js';

function configureTexture(texture, colorSpace) {
  texture.colorSpace = colorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

function versionAssetUrl(url, version) {
  if (!version) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

function canvasToDataUrl(canvas) {
  if (typeof canvas.toDataURL === 'function') return canvas.toDataURL('image/png');
  return canvas.convertToBlob({ type: 'image/png' }).then((blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  }));
}

function triggerDownload(filename, content, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function loadAtlasTextures(loader, resolvePath, prototype) {
  const results = await Promise.allSettled([
    loader.loadAsync(resolvePath(prototype.albedo)),
    loader.loadAsync(resolvePath(prototype.normal)),
  ]);
  const failure = results.find((result) => result.status === 'rejected');
  if (failure) {
    for (const result of results) {
      if (result.status === 'fulfilled') result.value.dispose?.();
    }
    throw failure.reason;
  }

  return {
    albedo: configureTexture(results[0].value, THREE.SRGBColorSpace),
    normal: configureTexture(results[1].value, THREE.NoColorSpace),
  };
}

export class TreeImpostorAssetLoader {
  constructor({
    baseUrl = '/',
    loader = new THREE.TextureLoader(),
    fetchImpl = null,
    expectedPrototypeCount = null,
    expectedSourceSignature = null,
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.loader = loader;
    // `fetch` must run with the global object as its receiver. Storing the bare
    // reference and calling it as `this.fetchImpl(...)` makes the receiver this
    // loader, which browsers reject with "Illegal invocation" — that failure was
    // caught and downgraded to a warning, so every session silently discarded the
    // prebaked atlases and re-baked all of them on the main thread instead.
    this.fetchImpl = fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.expectedPrototypeCount = expectedPrototypeCount;
    this.expectedSourceSignature = expectedSourceSignature;
  }

  resolve(path) {
    return resolveAssetUrl(this.baseUrl, path);
  }

  async load(manifestPath) {
    if (!manifestPath) return null;
    const response = await this.fetchImpl(this.resolve(manifestPath), { cache: 'no-cache' });
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`Tree impostor manifest failed with HTTP ${response.status}.`);
    }
    const manifest = validateTreeImpostorManifest(await response.json(), {
      expectedPrototypeCount: this.expectedPrototypeCount,
      expectedSourceSignature: this.expectedSourceSignature,
    });
    if (manifest.requiresRuntimeBake) {
      console.info(
        `[tree-impostor] Manifest v${manifest.version} has no foliage mask; runtime v${TREE_IMPOSTOR_MANIFEST_VERSION} bake required.`,
      );
      return null;
    }
    const assetVersion = manifest.generatedAt ?? manifest.sourceSignature;
    const resolveVersionedPath = (path) => versionAssetUrl(this.resolve(path), assetVersion);
    const results = await Promise.allSettled(manifest.prototypes.map(async (prototype) => {
      const textures = await loadAtlasTextures(this.loader, resolveVersionedPath, prototype);
      return Object.freeze({
        ...prototype,
        ...textures,
        source: 'asset',
      });
    }));
    const atlases = results
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    const failure = results.find((result) => result.status === 'rejected');
    if (failure) {
      disposeTreeImpostorAtlases(atlases);
      throw failure.reason;
    }
    return Object.freeze(atlases);
  }
}

export async function createTreeImpostorBundle(atlases, sourceSignature) {
  if (typeof sourceSignature !== 'string' || sourceSignature.length < 8) {
    throw new Error('Tree impostor export requires a source signature.');
  }
  const prototypes = [];
  for (const atlas of atlases) {
    if (!atlas.albedoCanvas || !atlas.normalCanvas) {
      throw new Error('Only runtime-baked impostors can be exported as a bundle.');
    }
    if (atlas.normalEncoding !== TREE_IMPOSTOR_NORMAL_ENCODING) {
      throw new Error(`Tree impostor prototype ${atlas.prototypeIndex} has no foliage-mask normal atlas.`);
    }
    prototypes.push({
      prototypeIndex: atlas.prototypeIndex,
      columns: atlas.columns,
      rows: atlas.rows,
      tileSize: atlas.tileSize,
      gutter: atlas.gutter ?? 0,
      lowElevationDegrees: atlas.lowElevationDegrees,
      highElevationDegrees: atlas.highElevationDegrees,
      width: atlas.width,
      height: atlas.height,
      depth: atlas.depth,
      centerY: atlas.centerY,
      radius: atlas.radius,
      normalEncoding: atlas.normalEncoding,
      albedoDataUrl: await canvasToDataUrl(atlas.albedoCanvas),
      normalDataUrl: await canvasToDataUrl(atlas.normalCanvas),
    });
  }
  return Object.freeze({
    version: TREE_IMPOSTOR_MANIFEST_VERSION,
    generatedAt: new Date().toISOString(),
    sourceSignature,
    prototypes,
  });
}

export async function downloadTreeImpostorBundle(atlases, sourceSignature) {
  const bundle = await createTreeImpostorBundle(atlases, sourceSignature);
  triggerDownload('tree-impostors.bundle.json', JSON.stringify(bundle));
  return bundle;
}

export function disposeTreeImpostorAtlases(atlases) {
  for (const atlas of atlases ?? []) {
    atlas.albedo?.dispose?.();
    atlas.normal?.dispose?.();
  }
}
