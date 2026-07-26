import {
  BIOME_ASSET_CONFIG_KIND,
  BIOME_ASSET_CONFIG_VERSION,
} from '../stylized/BiomeAssetPalette.js';

export const SCENE_SETTINGS_KIND = 'simcity-dnd-scene-settings';
export const SCENE_SETTINGS_VERSION = 1;
export const SCENE_SETTINGS_SESSION_KEY = 'simcity-dnd:pending-scene-settings';
export const LOCAL_ASSET_SCHEME = 'local-asset:';

export const SCENE_ASSET_LAYERS = Object.freeze({
  rocks: 'rockVariants',
  bushes: 'bushVariants',
  trees: 'treeVariants',
  groundDetails: 'groundDetailVariants',
  aquaticPlants: 'aquaticVariants',
});

const VALID_ASSET_LAYERS = new Set(Object.keys(SCENE_ASSET_LAYERS));
const VALID_MAP_KINDS = new Set(['url', 'embedded']);
const FETCHABLE_SCHEMES = new Set(['http:', 'https:', 'blob:', 'data:']);
const MAX_NAME_LENGTH = 96;
const MAX_ASSETS = 256;
// Mirrors the bounds `RegionalCharacterField` clamps to, so a preset says what
// it means instead of being silently rounded into range.
const PLACEMENT_RANGES = Object.freeze({
  regionSize: [64, 100000],
  sampleSpacing: [4, 10000],
  contrast: [0.25, 16],
  minimumInfluence: [0, 1],
  cacheSamples: [256, 1000000],
});

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value;
}

function optionalString(value, label, maximum = 2048) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length > maximum) {
    throw new Error(`${label} must be a string no longer than ${maximum} characters.`);
  }
  return value;
}

function finite(value, label, minimum, maximum, fallback = undefined) {
  // `null` is what a hand-written or round-tripped document uses for "not set",
  // and `Number(null)` is 0 — which silently lands inside some of these ranges.
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return number;
}

function normalizeMap(map) {
  if (map === undefined || map === null) return null;
  const source = object(map, 'Scene settings map');
  if (!VALID_MAP_KINDS.has(source.kind)) {
    throw new Error(`Unsupported scene settings map kind "${source.kind}".`);
  }
  const label = optionalString(source.label, 'Scene settings map label', MAX_NAME_LENGTH);
  if (source.kind === 'url') {
    const url = optionalString(source.url, 'Scene settings map URL');
    if (!url) throw new Error('URL map settings require a URL.');
    return { kind: 'url', url, ...(label ? { label } : {}) };
  }
  // An embedded map may record only its label. A full Azgaar export is several
  // megabytes, so routine captures (world saves, browser presets, the session
  // handoff) keep the reference and let the world document carry the terrain —
  // only an explicit portable export inlines the source again.
  if (source.document === undefined || source.document === null) {
    return { kind: 'embedded', ...(label ? { label } : {}) };
  }
  object(source.document, 'Embedded scene settings map document');
  return {
    kind: 'embedded',
    document: structuredClone(source.document),
    ...(label ? { label } : {}),
  };
}

/**
 * Strips the inlined source document from an embedded map, leaving the label
 * that says which file the look was authored against.
 */
export function toMapReference(map) {
  if (!map || map.kind !== 'embedded') return map ?? null;
  const { document: _document, ...reference } = map;
  return reference;
}

export function isLoadableMap(map) {
  return Boolean(map && (map.kind === 'url' ? map.url : map.document));
}

function normalizeTileIds(value, label) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  const tileIds = [...new Set(value.map(Number))].sort((left, right) => left - right);
  if (tileIds.some((tileId) => !Number.isInteger(tileId) || tileId < 0 || tileId > 254)) {
    throw new Error(`${label} must contain terrain IDs from 0 to 254.`);
  }
  return tileIds;
}

function normalizePrototypeGroups(value, label) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) {
    throw new Error(`${label} must be a non-empty array with at most 128 groups.`);
  }
  return value.map((group, index) => {
    if (!Array.isArray(group) || group.length === 0 || group.length > 128) {
      throw new Error(`${label} group ${index + 1} is invalid.`);
    }
    return group.map((name) => {
      const normalized = optionalString(name, `${label} node name`, 256);
      if (!normalized) throw new Error(`${label} node names cannot be empty.`);
      return normalized;
    });
  });
}

function normalizeAsset(asset, index) {
  const source = object(asset, `Scene asset ${index + 1}`);
  const layer = optionalString(source.layer, `Scene asset ${index + 1} layer`, 32);
  if (!VALID_ASSET_LAYERS.has(layer)) {
    throw new Error(
      `Scene asset ${index + 1} has unsupported layer "${layer ?? ''}".`
      + ` Use one of: ${[...VALID_ASSET_LAYERS].join(', ')}.`,
    );
  }
  const id = optionalString(source.id, `Scene asset ${index + 1} id`, 128);
  const url = optionalString(source.url, `Scene asset ${index + 1} URL`);
  if (!id || !url) throw new Error(`Scene asset ${index + 1} requires id and URL.`);

  const normalized = {
    id,
    layer,
    url,
    label: optionalString(source.label, `Scene asset ${index + 1} label`, MAX_NAME_LENGTH)
      ?? id,
    scale: finite(source.scale, `Scene asset ${index + 1} scale`, 0.000001, 10000, 1),
  };
  const tileIds = normalizeTileIds(source.tileIds, `Scene asset ${index + 1} tile IDs`);
  if (tileIds) normalized.tileIds = tileIds;
  const prototypeGroups = normalizePrototypeGroups(
    source.prototypeGroups,
    `Scene asset ${index + 1} prototype groups`,
  );
  if (prototypeGroups) normalized.prototypeGroups = prototypeGroups;

  for (const key of [
    'trunkMaterial',
    'leafMaterial',
    'species',
    'barkProfile',
  ]) {
    const value = optionalString(source[key], `Scene asset ${index + 1} ${key}`, 256);
    if (value) normalized[key] = value;
  }
  for (const [key, minimum, maximum] of [
    ['barkScale', 0.01, 100],
    ['barkSeed', 0, 0xffffffff],
    ['weight', 0.000001, 10000],
    ['heightOffset', -1000, 1000],
  ]) {
    const value = finite(source[key], `Scene asset ${index + 1} ${key}`, minimum, maximum);
    if (value !== undefined) normalized[key] = key === 'barkSeed' ? Math.trunc(value) : value;
  }
  return normalized;
}

function normalizeAssets(assets) {
  if (assets === undefined || assets === null) return [];
  if (!Array.isArray(assets) || assets.length > MAX_ASSETS) {
    throw new Error(`Scene settings assets must be an array with at most ${MAX_ASSETS} entries.`);
  }
  const ids = new Set();
  return assets.map((asset, index) => {
    const normalized = normalizeAsset(asset, index);
    if (ids.has(normalized.id)) throw new Error(`Duplicate scene asset id "${normalized.id}".`);
    ids.add(normalized.id);
    return normalized;
  });
}

function normalizeBiomeAssets(document) {
  if (document === undefined || document === null) {
    return {
      kind: BIOME_ASSET_CONFIG_KIND,
      version: BIOME_ASSET_CONFIG_VERSION,
      biomes: {},
    };
  }
  // The palette re-validates every key against the live asset catalog. Checking
  // the envelope here keeps a malformed file from being reported much later as
  // "Unsupported biome asset configuration version: undefined".
  const source = object(document, 'Scene settings biome assets');
  if (source.kind !== undefined && source.kind !== BIOME_ASSET_CONFIG_KIND) {
    throw new Error('Scene settings biome assets are not a biome asset configuration.');
  }
  if (source.version !== BIOME_ASSET_CONFIG_VERSION) {
    throw new Error(`Unsupported biome asset configuration version: ${source.version}.`);
  }
  object(source.biomes, 'Scene settings biome asset biomes');
  return structuredClone(source);
}

function normalizeEnvironment(environment) {
  if (environment === undefined || environment === null) return { godRays: {} };
  const source = object(environment, 'Scene settings environment');
  const godRays = source.godRays === undefined
    ? {}
    : structuredClone(object(source.godRays, 'Scene settings god rays'));
  return { godRays };
}

/**
 * Placement is merged into the editor config after `loadEditorConfig` has
 * already validated it, so this is the only place its values get checked.
 * `RegionalCharacterField` clamps silently, and a preset that quietly reverts to
 * the built-in defaults is far harder to diagnose than a refused document.
 */
function normalizePlacement(placement) {
  if (placement === undefined || placement === null) return {};
  const source = object(placement, 'Scene settings placement');
  if (source.enabled !== undefined && typeof source.enabled !== 'boolean') {
    throw new Error('Scene settings placement enabled must be a boolean.');
  }
  const normalized = structuredClone(source);
  for (const [key, [minimum, maximum]] of Object.entries(PLACEMENT_RANGES)) {
    if (!(key in source)) continue;
    const value = finite(source[key], `Scene settings placement ${key}`, minimum, maximum);
    if (value === undefined) delete normalized[key];
    else normalized[key] = value;
  }
  return normalized;
}

export function normalizeSceneSettings(document) {
  const source = object(document, 'Scene settings');
  if (source.kind !== SCENE_SETTINGS_KIND) {
    throw new Error('The selected document is not a SimCity DnD scene settings file.');
  }
  if (source.version !== SCENE_SETTINGS_VERSION) {
    throw new Error(`Unsupported scene settings version: ${source.version}.`);
  }
  const name = optionalString(source.name, 'Scene settings name', MAX_NAME_LENGTH)
    ?? 'Untitled settings';
  return {
    kind: SCENE_SETTINGS_KIND,
    version: SCENE_SETTINGS_VERSION,
    name,
    map: normalizeMap(source.map),
    environment: normalizeEnvironment(source.environment),
    biomeAssets: normalizeBiomeAssets(source.biomeAssets),
    assets: normalizeAssets(source.assets),
    placement: normalizePlacement(source.placement),
  };
}

export function createSceneSettingsDocument({
  name,
  map = null,
  godRays = {},
  biomeAssets,
  assets = [],
  placement = {},
}) {
  return normalizeSceneSettings({
    kind: SCENE_SETTINGS_KIND,
    version: SCENE_SETTINGS_VERSION,
    name,
    map,
    environment: { godRays },
    biomeAssets,
    assets,
    placement,
  });
}

export function resolveSettingsReference(reference, baseUrl) {
  if (typeof reference !== 'string' || reference.length === 0) {
    throw new Error('Settings references require a URL.');
  }
  if (reference.startsWith(LOCAL_ASSET_SCHEME)) return reference;
  // A settings document can be fetched from any author-supplied URL, so its
  // references are untrusted. Resolve the way the browser would, then keep only
  // the schemes a map or GLB can actually be fetched over — `new URL` happily
  // hands back `javascript:` and friends unchanged.
  let resolved;
  try {
    resolved = new URL(reference, baseUrl);
  } catch {
    throw new Error(`"${reference}" is not a usable settings reference.`);
  }
  if (!FETCHABLE_SCHEMES.has(resolved.protocol)) {
    throw new Error(
      `Settings references cannot use the "${resolved.protocol}" scheme.`,
    );
  }
  return resolved.href;
}

export async function applySceneAssetSettings(config, settings, {
  baseUrl,
  resolveLocalAsset = null,
} = {}) {
  const normalized = normalizeSceneSettings(settings);
  const assets = config.stylizedSurface.assets;
  for (const asset of normalized.assets) {
    const variantsKey = SCENE_ASSET_LAYERS[asset.layer];
    let scene = resolveSettingsReference(asset.url, baseUrl);
    if (scene.startsWith(LOCAL_ASSET_SCHEME)) {
      if (!resolveLocalAsset) {
        throw new Error(`Local GLB "${scene}" is not available in this browser.`);
      }
      scene = await resolveLocalAsset(scene.slice(LOCAL_ASSET_SCHEME.length));
    }
    const definition = {
      ...asset,
      scene,
      sourceUrl: asset.url,
    };
    delete definition.layer;
    delete definition.url;
    const variants = assets[variantsKey] ?? [];
    const existing = variants.findIndex((candidate) => (candidate.id ?? candidate.scene) === asset.id);
    if (existing >= 0) variants[existing] = definition;
    else variants.push(definition);
    assets[variantsKey] = variants;
  }
  if (Object.keys(normalized.placement).length > 0) {
    config.stylizedSurface.regionalPlacement = {
      ...(config.stylizedSurface.regionalPlacement ?? {}),
      ...normalized.placement,
    };
  }
  return normalized;
}
