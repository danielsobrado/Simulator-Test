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
export const SCENE_SETTINGS_RELOAD_WORLD_KEY = 'simcity-dnd:pending-scene-settings-world';
export const SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY = 'simcity-dnd:pending-scene-settings-world-key';
export const SCENE_SETTINGS_SOURCE_URL_SESSION_KEY = 'simcity-dnd:pending-scene-settings-source-url';

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

function stageWorldSettings(worldDocument, settings) {
  if (!worldDocument || typeof worldDocument !== 'object' || Array.isArray(worldDocument)) {
    throw new Error('A world document is required for the settings reload handoff.');
  }
  const staged = structuredClone(worldDocument);
  staged.visualConfig = {
    ...(staged.visualConfig ?? {}),
    biomeAssets: settings.biomeAssets,
    sceneSettings: settings,
  };
  return staged;
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
      sourceUrl: session?.getItem(SCENE_SETTINGS_SOURCE_URL_SESSION_KEY) ?? locationValue.href,
      reference,
      pendingWorldKey: session?.getItem(SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY) ?? null,
    };
  }
  const sourceUrl = resolveDocumentBase(reference, locationValue);
  return {
    document: normalizeSceneSettings(await loadJsonFromUrl(sourceUrl)),
    sourceUrl,
    reference,
    pendingWorldKey: null,
  };
}

export async function activateSceneSettings(document, {
  locationValue = globalThis.location,
  session = globalThis.sessionStorage,
  worldDocument = null,
  saveBrowserDocument = saveToBrowser,
  sourceUrl = locationValue?.href,
} = {}) {
  const normalized = normalizeSceneSettings(document);
  if (!locationValue || !session) {
    throw new Error('Scene settings activation requires browser location and session storage.');
  }
  if (worldDocument) {
    await saveBrowserDocument(
      SCENE_SETTINGS_RELOAD_WORLD_KEY,
      stageWorldSettings(worldDocument, normalized),
    );
  }
  try {
    session.setItem(SCENE_SETTINGS_SESSION_KEY, JSON.stringify(normalized));
    session.setItem(SCENE_SETTINGS_SOURCE_URL_SESSION_KEY, sourceUrl ?? locationValue.href);
    if (worldDocument) {
      session.setItem(
        SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY,
        SCENE_SETTINGS_RELOAD_WORLD_KEY,
      );
    } else {
      session.removeItem(SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY);
    }
  } catch (error) {
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
    loadBrowserDocument = loadFromBrowser,
    session = globalThis.sessionStorage,
  }) {
    this.controller = controller;
    this.biomeAssetPalette = biomeAssetPalette;
    this.godRays = godRays;
    this.config = config;
    this.resolveAzgaarOptions = resolveAzgaarOptions;
    this.afterMapLoad = afterMapLoad;
    this.loadBrowserDocument = loadBrowserDocument;
    this.session = session;
    this.pendingWorldKey = boot?.pendingWorldKey ?? null;
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
    if (this.pendingWorldKey) {
      const worldDocument = await this.loadBrowserDocument(this.pendingWorldKey);
      if (!worldDocument) {
        throw new Error('The pending world reload document has expired.');
      }
      this.controller.loadDocument(worldDocument);
      this.mapSource = this.document.map;
      await this.afterMapLoad?.(worldDocument);
      this.session?.removeItem(SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY);
      this.pendingWorldKey = null;
      return;
    }
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
    const savedSettings = worldDocument?.visualConfig?.sceneSettings
      ? normalizeSceneSettings(worldDocument.visualConfig.sceneSettings)
      : null;
    if (savedSettings?.assets.length > 0) {
      await this.activate(savedSettings, {
        worldDocument,
        sourceUrl: map.kind === 'url' ? resolvedMap.url : baseUrl,
      });
      return worldDocument;
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

  /**
   * Stages the settings and navigates. This is a full page reload, not an in-place
   * apply — asset variants are resolved into the editor config at boot, so a look
   * that adds assets can only take effect from a fresh start.
   *
   * `onSceneReload` exists because that navigation is otherwise invisible. Loading
   * a map whose world document carries its own look lands here from inside
   * `loadMap`, which the caller experiences as an ordinary map load: boot would run
   * on to completion, the browser would then swap the page, and the whole startup
   * sequence would replay with no explanation. Announcing it is the difference
   * between "the loader went backwards" and "it is reloading, and here is why".
   */
  async activate(document, {
    worldDocument = null,
    sourceUrl = globalThis.location?.href,
  } = {}) {
    this.onSceneReload?.(document);
    return activateSceneSettings(document, { worldDocument, sourceUrl });
  }

  activateUrl(url) {
    this.onSceneReload?.(null, url);
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
    await this.activate(document, { worldDocument: this.controller.toDocument() });
  }

  async addLocalAsset({ layer, file, label, scale = 1, tileIds = undefined }) {
    if (!(file instanceof Blob)) throw new Eror('Choose a local GLB first.');
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
    await this.activate(document, { worldDocument: this.controller.toDocument() });
  }
}
