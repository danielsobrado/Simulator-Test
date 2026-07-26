import {
  importMapDocument,
  importMapUrl,
  listBrowserDocuments,
  loadFromBrowser,
  loadJsonFromUrl,
  saveToBrowser,
} from '../storage.js';
import {
  createSceneSettingsDocument,
  isLoadableMap,
  LOCAL_ASSET_SCHEME,
  normalizeSceneSettings,
  resolveSettingsReference,
  SCENE_SETTINGS_SESSION_KEY,
  toMapReference,
} from './SceneSettings.js';

export const SCENE_SETTINGS_BROWSER_PREFIX = 'simcity-dnd:scene-setting:';
export const LOCAL_ASSET_BROWSER_PREFIX = 'simcity-dnd:local-glb:';

function slug(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 64) || 'settings';
}

function resolveDocumentBase(reference, locationValue) {
  return new URL(reference, locationValue.href).href;
}

export async function loadBootSceneSettings({
  locationValue = globalThis.location,
  session = globalThis.sessionStorage,
} = {}) {
  if (!locationValue) return null;
  const reference = new URLSearchParams(locationValue.search).get('settings');
  if (!reference) return null;
  if (reference === 'session') {
    const serialized = session?.getItem(SCENE_SETTINGS_SESSION_KEY);
    if (!serialized) throw new Error('The pending local settings document has expired.');
    return {
      document: normalizeSceneSettings(JSON.parse(serialized)),
      sourceUrl: locationValue.href,
      reference,
    };
  }
  const sourceUrl = resolveDocumentBase(reference, locationValue);
  return {
    document: normalizeSceneSettings(await loadJsonFromUrl(sourceUrl)),
    sourceUrl,
    reference,
  };
}

export function activateSceneSettings(document, {
  locationValue = globalThis.location,
  session = globalThis.sessionStorage,
} = {}) {
  const normalized = normalizeSceneSettings(document);
  try {
    session.setItem(SCENE_SETTINGS_SESSION_KEY, JSON.stringify(normalized));
  } catch (error) {
    // sessionStorage tops out around 5 MB, so an inlined Azgaar export never
    // fits. Say so instead of surfacing a bare QuotaExceededError.
    throw new Error(
      normalized.map?.document
        ? 'These settings inline a full map export, which is too large for the session handoff.'
          + ' Publish the map to a URL (or the maps/ folder) and reference it instead.'
        : `Unable to stage these settings for reload: ${error.message}`,
    );
  }
  const next = new URL(locationValue.href);
  next.searchParams.set('settings', 'session');
  locationValue.assign(next.href);
}

export async function resolveLocalGlb(assetId) {
  const stored = await loadFromBrowser(`${LOCAL_ASSET_BROWSER_PREFIX}${assetId}`);
  if (!stored?.blob || !(stored.blob instanceof Blob)) {
    throw new Error(`Local GLB "${assetId}" is missing from browser storage.`);
  }
  return URL.createObjectURL(stored.blob);
}

export class SceneSettingsRuntime {
  constructor({
    controller,
    biomeAssetPalette,
    godRays,
    config,
    boot = null,
    resolveAzgaarOptions = null,
    afterMapLoad = null,
  }) {
    this.controller = controller;
    this.biomeAssetPalette = biomeAssetPalette;
    this.godRays = godRays;
    this.config = config;
    this.resolveAzgaarOptions = resolveAzgaarOptions;
    this.afterMapLoad = afterMapLoad;
    this.document = boot?.document
      ? normalizeSceneSettings(boot.document)
      : createSceneSettingsDocument({
        name: 'Current world look',
        biomeAssets: biomeAssetPalette.toDocument(),
        godRays: godRays?.getSettings?.() ?? {},
        placement: config.stylizedSurface.regionalPlacement ?? {},
      });
    this.sourceUrl = boot?.sourceUrl ?? globalThis.location?.href ?? 'http://localhost/';
    this.mapSource = this.document.map;
  }

  /**
   * `includeMapDocument` inlines a locally imported map export so the result is
   * portable on its own. Every other caller — world saves, browser presets, the
   * reload handoff — wants the cheap reference: cloning and re-serialising a
   * multi-megabyte Azgaar document costs ~100 ms a call and duplicates terrain
   * the world document already stores.
   */
  capture(name = this.document.name, { includeMapDocument = false } = {}) {
    return createSceneSettingsDocument({
      name,
      map: includeMapDocument ? this.mapSource : toMapReference(this.mapSource),
      godRays: this.godRays?.getSettings?.() ?? {},
      biomeAssets: this.biomeAssetPalette.toDocument(),
      assets: this.document.assets,
      placement: this.config.stylizedSurface.regionalPlacement ?? this.document.placement,
    });
  }

  async applyInitialRuntime() {
    this.applyVisualSettings(this.document);
    // A reference-only embedded map has no source to replay; the world document
    // that shipped with it already carries the terrain.
    if (isLoadableMap(this.document.map)) {
      await this.loadMap(this.document.map, this.sourceUrl);
    }
  }

  applyVisualSettings(document) {
    const normalized = normalizeSceneSettings(document);
    this.godRays?.setSettings?.(normalized.environment.godRays);
    this.biomeAssetPalette.replaceDocument(normalized.biomeAssets);
    this.document = normalized;
    this.mapSource = normalized.map;
    return normalized;
  }

  async loadMap(map, baseUrl = globalThis.location?.href) {
    if (!isLoadableMap(map)) {
      throw new Error('These settings only record a map label, so there is no map to load.');
    }
    let worldDocument;
    let resolvedMap;
    const visualSettings = this.capture();
    if (map.kind === 'url') {
      const url = resolveSettingsReference(map.url, baseUrl);
      worldDocument = await importMapUrl(url, {
        config: this.config,
        resolveAzgaarOptions: this.resolveAzgaarOptions,
      });
      resolvedMap = { ...map, url };
    } else {
      // The import gets the copy — a non-Azgaar document is returned aliased and
      // then owned by the controller. `map` itself becomes ours, so it needs no
      // second clone of what can be several megabytes.
      worldDocument = await importMapDocument(structuredClone(map.document), {
        config: this.config,
        resolveAzgaarOptions: this.resolveAzgaarOptions,
      });
      resolvedMap = map;
    }
    this.controller.loadDocument(worldDocument);
    // A world save carries its own look and `loadDocument` has already applied
    // it — putting the pre-import capture back on top would discard it. Only a
    // bare map (an Azgaar export, a terrain-only document) needs the look that
    // was live before the import restored over the controller's reset.
    if (!worldDocument?.visualConfig) this.applyVisualSettings(visualSettings);
    this.mapSource = resolvedMap;
    await this.afterMapLoad?.(worldDocument);
    return worldDocument;
  }

  async loadMapUrl(url, label = undefined) {
    return this.loadMap({ kind: 'url', url, ...(label ? { label } : {}) });
  }

  async loadEmbeddedMap(document, label = undefined) {
    return this.loadMap({
      kind: 'embedded',
      document,
      ...(label ? { label } : {}),
    });
  }

  async saveNamed(name) {
    const document = this.capture(name);
    const key = `${SCENE_SETTINGS_BROWSER_PREFIX}${slug(name)}`;
    await saveToBrowser(key, document);
    this.document = document;
    return { key, document };
  }

  async listBrowserSettings() {
    const stored = await listBrowserDocuments(SCENE_SETTINGS_BROWSER_PREFIX);
    return stored
      .map(({ key, document }) => {
        try {
          const normalized = normalizeSceneSettings(document);
          return { key, name: normalized.name, document: normalized };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  activate(document) {
    activateSceneSettings(document);
  }

  activateUrl(url) {
    const next = new URL(globalThis.location.href);
    next.searchParams.set('settings', url);
    globalThis.location.assign(next.href);
  }

  async addUrlAsset({ layer, url, label, scale = 1, tileIds = undefined }) {
    const id = `url-${slug(label || url)}-${Date.now().toString(36)}`;
    const document = this.capture();
    document.assets.push({
      id,
      layer,
      url,
      label: label || id,
      scale,
      ...(tileIds?.length ? { tileIds } : {}),
    });
    this.activate(document);
  }

  async addLocalAsset({ layer, file, label, scale = 1, tileIds = undefined }) {
    if (!(file instanceof Blob)) throw new Error('Choose a local GLB first.');
    const id = `local-${slug(label || file.name)}-${Date.now().toString(36)}`;
    await saveToBrowser(`${LOCAL_ASSET_BROWSER_PREFIX}${id}`, {
      kind: 'simcity-dnd-local-glb',
      version: 1,
      name: file.name,
      blob: file,
    });
    const document = this.capture();
    document.assets.push({
      id,
      layer,
      url: `${LOCAL_ASSET_SCHEME}${id}`,
      label: label || file.name,
      scale,
      ...(tileIds?.length ? { tileIds } : {}),
    });
    this.activate(document);
  }
}
