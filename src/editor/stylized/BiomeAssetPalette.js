export const BIOME_ASSET_CONFIG_KIND = 'simcity-dnd-biome-assets';
export const BIOME_ASSET_CONFIG_VERSION = 1;
export const AUTOMATIC_BIOME_ASSET = '';

export const BIOME_ASSET_LAYERS = Object.freeze([
  Object.freeze({
    id: 'rocks',
    label: 'Rocks',
    singular: 'Rock',
    variantsKey: 'rockVariants',
    surfaceKey: 'rocks',
  }),
  Object.freeze({
    id: 'bushes',
    label: 'Bushes',
    singular: 'Bush',
    variantsKey: 'bushVariants',
    surfaceKey: 'bushes',
  }),
  Object.freeze({
    id: 'trees',
    label: 'Trees',
    singular: 'Tree',
    variantsKey: 'treeVariants',
    surfaceKey: 'trees',
    includePrimaryScene: true,
  }),
  Object.freeze({
    id: 'groundDetails',
    label: 'Ground details',
    singular: 'Ground detail',
    variantsKey: 'groundDetailVariants',
    surfaceKey: 'groundDetails',
  }),
  Object.freeze({
    id: 'aquaticPlants',
    label: 'Aquatic plants',
    singular: 'Aquatic plant',
    variantsKey: 'aquaticVariants',
    surfaceKey: 'aquaticPlants',
  }),
]);

const LAYER_BY_ID = new Map(BIOME_ASSET_LAYERS.map((layer) => [layer.id, layer]));

function assertTileId(tileId) {
  if (!Number.isInteger(tileId) || tileId < 0 || tileId > 254) {
    throw new Error('Biome asset tile IDs must be integers from 0 to 254.');
  }
}

function assetName(scene) {
  const fileName = String(scene).split('/').filter(Boolean).at(-1) ?? String(scene);
  return fileName
    .replace(/\.glb$/i, '')
    .replaceAll(/[-_]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function createLayerCatalog(stylizedConfig, layer) {
  const assets = stylizedConfig.assets ?? {};
  const definitions = [];
  if (layer.includePrimaryScene && typeof assets.scene === 'string') {
    definitions.push({ scene: assets.scene, primary: true });
  }
  definitions.push(...(assets[layer.variantsKey] ?? []));

  const seen = new Set();
  const options = [];
  for (const definition of definitions) {
    const key = definition?.id ?? definition?.scene;
    if (typeof key !== 'string' || key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    const configuredTileIds = Array.isArray(definition.tileIds)
      ? new Set(definition.tileIds)
      : null;
    options.push(Object.freeze({
      key,
      scene: definition.scene,
      label: `${layer.singular} ${options.length + 1} — ${
        definition.label
          ?? (definition.primary ? 'Pine collection' : assetName(definition.scene))
      }`,
      tileIds: configuredTileIds,
    }));
  }
  const eligibleTileIds = new Set(stylizedConfig[layer.surfaceKey]?.tileIds ?? []);
  return Object.freeze({
    ...layer,
    options: Object.freeze(options),
    optionKeys: new Set(options.map((option) => option.key)),
    eligibleTileIds,
  });
}

export function createBiomeAssetCatalog(stylizedConfig) {
  if (!stylizedConfig || typeof stylizedConfig !== 'object') {
    throw new Error('Biome asset palettes require stylized surface configuration.');
  }
  return new Map(BIOME_ASSET_LAYERS.map((layer) => [
    layer.id,
    createLayerCatalog(stylizedConfig, layer),
  ]));
}

function serializeSelections(selections) {
  const biomes = {};
  for (const tileId of [...selections.keys()].sort((left, right) => left - right)) {
    const entries = selections.get(tileId);
    const serialized = {};
    for (const layer of BIOME_ASSET_LAYERS) {
      const value = entries.get(layer.id);
      if (value) serialized[layer.id] = value;
    }
    if (Object.keys(serialized).length > 0) biomes[String(tileId)] = serialized;
  }
  return biomes;
}

function normalizeDocument(document, catalog) {
  if (document === null || document === undefined) return new Map();
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Biome asset configuration must be an object.');
  }
  if (document.kind !== undefined && document.kind !== BIOME_ASSET_CONFIG_KIND) {
    throw new Error('The selected file is not a biome asset configuration.');
  }
  if (document.version !== BIOME_ASSET_CONFIG_VERSION) {
    throw new Error(`Unsupported biome asset configuration version: ${document.version}.`);
  }
  if (!document.biomes || typeof document.biomes !== 'object'
      || Array.isArray(document.biomes)) {
    throw new Error('Biome asset configuration must contain a biomes object.');
  }

  const selections = new Map();
  for (const [rawTileId, rawEntries] of Object.entries(document.biomes)) {
    const tileId = Number(rawTileId);
    assertTileId(tileId);
    if (!rawEntries || typeof rawEntries !== 'object' || Array.isArray(rawEntries)) {
      throw new Error(`Biome asset configuration for tile ${tileId} must be an object.`);
    }
    const entries = new Map();
    for (const [layerId, assetKey] of Object.entries(rawEntries)) {
      const layer = catalog.get(layerId);
      if (!layer || !LAYER_BY_ID.has(layerId)) {
        throw new Error(`Unknown biome asset layer "${layerId}".`);
      }
      if (typeof assetKey !== 'string' || !layer.optionKeys.has(assetKey)) {
        throw new Error(`Unknown ${layer.label.toLowerCase()} asset "${assetKey}".`);
      }
      if (!layer.eligibleTileIds.has(tileId)) {
        throw new Error(`${layer.label} are not enabled for biome tile ${tileId}.`);
      }
      const option = layer.options.find((candidate) => candidate.key === assetKey);
      // Dropped rather than rejected: a variant's `tileIds` is authoring metadata
      // that can narrow between releases, and a saved preset that pinned an asset
      // to a biome it no longer claims should lose that one pin, not fail to
      // load. Structurally invalid documents above still throw.
      if (option?.tileIds && !option.tileIds.has(tileId)) continue;
      entries.set(layerId, assetKey);
    }
    if (entries.size > 0) selections.set(tileId, entries);
  }
  return selections;
}

export class BiomeAssetPalette {
  constructor({ stylizedConfig, document = null }) {
    this.catalog = createBiomeAssetCatalog(stylizedConfig);
    this.listeners = new Set();
    this.revision = 0;
    this.selections = document
      ? normalizeDocument(document, this.catalog)
      : new Map();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.toDocument());
    return () => this.listeners.delete(listener);
  }

  emit() {
    const document = this.toDocument();
    for (const listener of this.listeners) listener(document);
  }

  getLayer(layerId) {
    return this.catalog.get(layerId) ?? null;
  }

  listLayers() {
    return BIOME_ASSET_LAYERS.map(({ id }) => this.catalog.get(id));
  }

  getSelection(tileId, layerId) {
    return this.selections.get(tileId)?.get(layerId) ?? AUTOMATIC_BIOME_ASSET;
  }

  setSelection(tileId, layerId, assetKey = AUTOMATIC_BIOME_ASSET) {
    assertTileId(tileId);
    const layer = this.catalog.get(layerId);
    if (!layer) throw new Error(`Unknown biome asset layer "${layerId}".`);
    if (!layer.eligibleTileIds.has(tileId)) {
      throw new Error(`${layer.label} are not enabled for this biome.`);
    }
    if (assetKey && !layer.optionKeys.has(assetKey)) {
      throw new Error(`Unknown ${layer.label.toLowerCase()} asset "${assetKey}".`);
    }
    const option = layer.options.find((candidate) => candidate.key === assetKey);
    if (option?.tileIds && !option.tileIds.has(tileId)) {
      throw new Error(`${option.label} is not enabled for this biome.`);
    }
    const previous = this.getSelection(tileId, layerId);
    if (previous === assetKey) return false;

    const entries = new Map(this.selections.get(tileId) ?? []);
    if (assetKey) entries.set(layerId, assetKey);
    else entries.delete(layerId);
    if (entries.size > 0) this.selections.set(tileId, entries);
    else this.selections.delete(tileId);
    this.revision += 1;
    this.emit();
    return true;
  }

  replaceDocument(document) {
    const next = normalizeDocument(document, this.catalog);
    if (JSON.stringify(serializeSelections(next))
        === JSON.stringify(serializeSelections(this.selections))) {
      return false;
    }
    this.selections = next;
    this.revision += 1;
    this.emit();
    return true;
  }

  reset() {
    return this.replaceDocument({
      kind: BIOME_ASSET_CONFIG_KIND,
      version: BIOME_ASSET_CONFIG_VERSION,
      biomes: {},
    });
  }

  toDocument() {
    return {
      kind: BIOME_ASSET_CONFIG_KIND,
      version: BIOME_ASSET_CONFIG_VERSION,
      biomes: serializeSelections(this.selections),
    };
  }

  resolvePrototypeIndex({
    tileId,
    layerId,
    automaticIndex,
    prototypeIndicesByAsset,
    roll = 0,
  }) {
    const assetKey = this.getSelection(tileId, layerId);
    if (!assetKey) return automaticIndex;
    const indices = prototypeIndicesByAsset.get(assetKey);
    if (!indices || indices.length === 0) return automaticIndex;
    const normalizedRoll = Number.isFinite(roll)
      ? Math.min(1 - Number.EPSILON, Math.max(0, roll))
      : 0;
    return indices[Math.floor(normalizedRoll * indices.length)];
  }
}

export function registerPrototypeIndices(target, assetKey, firstIndex, count) {
  if (!(target instanceof Map) || typeof assetKey !== 'string'
      || !Number.isInteger(firstIndex) || firstIndex < 0
      || !Number.isInteger(count) || count < 0) {
    throw new Error('Invalid biome asset prototype registration.');
  }
  const indices = Array.from({ length: count }, (_value, offset) => firstIndex + offset);
  target.set(assetKey, Object.freeze(indices));
  return indices;
}
