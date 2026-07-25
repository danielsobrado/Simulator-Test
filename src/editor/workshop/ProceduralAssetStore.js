import {
  normalizeComponentTransforms,
  serializeComponentTransforms,
} from './ProceduralWorkshopComponentTransforms.js';
import {
  normalizeSurfaceTextures,
  serializeSurfaceTextures,
} from './ProceduralWorkshopTextureConfig.js';

const ASSET_VERSION = 3;
const MAX_ASSETS = 32;
const SUPPORTED_ASSET_VERSIONS = new Set([1, 2, ASSET_VERSION]);
const VALID_ARCHETYPES = new Set(['wall', 'gatehouse', 'tower', 'square-tower', 'manor']);
const VALID_STYLES = new Set(['granite', 'limestone', 'sandstone']);
const VALID_TOP_STYLES = new Set(['battlements', 'slate', 'terracotta']);
const VALID_FINISHES = new Set(['masonry', 'ochre', 'limewash', 'rose']);
const VALID_SHAPES = new Set(['classic', 'stepped', 'tapered']);
const VALID_TOWER_SIDES = new Set(['left', 'right', 'none']);

function requireObject(value, field, { allowMissing = false } = {}) {
  if (value == null && allowMissing) return {};
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value;
}

function requireFinite(value, field, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be a finite number between ${minimum} and ${maximum}.`);
  }
  return value;
}

function requireInteger(value, field, minimum, maximum) {
  const number = requireFinite(value, field, minimum, maximum);
  if (!Number.isInteger(number)) {
    throw new Error(`${field} must be an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

function optionalBoolean(value, field, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'boolean') {
    throw new Error(`${field} must be true or false.`);
  }
  return value;
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 28) || 'medieval-build';
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function normalizeProceduralRecipe(input = {}) {
  const source = requireObject(input, 'Workshop recipe', { allowMissing: true });
  const archetype = String(source.archetype ?? 'wall');
  const style = String(source.style ?? 'granite');
  const topStyle = String(source.topStyle ?? 'battlements');
  const finish = String(source.finish ?? 'masonry');
  const shape = String(source.shape ?? 'classic');
  const towerSide = String(source.towerSide ?? 'left');
  if (!VALID_ARCHETYPES.has(archetype)) {
    throw new Error(`Unknown workshop archetype: ${archetype}.`);
  }
  if (!VALID_STYLES.has(style)) {
    throw new Error(`Unknown workshop stone style: ${style}.`);
  }
  if (!VALID_TOP_STYLES.has(topStyle)) {
    throw new Error(`Unknown workshop top style: ${topStyle}.`);
  }
  if (!VALID_FINISHES.has(finish)) {
    throw new Error(`Unknown workshop wall finish: ${finish}.`);
  }
  if (!VALID_SHAPES.has(shape)) {
    throw new Error(`Unknown workshop silhouette: ${shape}.`);
  }
  if (!VALID_TOWER_SIDES.has(towerSide)) {
    throw new Error(`Unknown workshop tower position: ${towerSide}.`);
  }

  return Object.freeze({
    archetype,
    style,
    topStyle,
    finish,
    shape,
    towerSide,
    width: requireFinite(source.width ?? 8, 'Width', 2, 16),
    depth: requireFinite(source.depth ?? 2, 'Depth', 1, 12),
    height: requireFinite(source.height ?? 5, 'Height', 2, 14),
    roofScale: requireFinite(source.roofScale ?? 1, 'Roof height', 0.55, 2),
    roofOverhang: requireFinite(source.roofOverhang ?? 0.35, 'Roof overhang', 0.1, 0.9),
    seed: requireInteger(source.seed ?? 1, 'Seed', 0, 0x7fffffff),
    detail: requireInteger(source.detail ?? 2, 'Detail', 1, 3),
    weathering: requireFinite(source.weathering ?? 0.35, 'Weathering', 0, 1),
    windows: optionalBoolean(source.windows, 'Doors and windows', true),
    ivy: optionalBoolean(source.ivy, 'Procedural ivy', false),
    remesh: optionalBoolean(source.remesh, 'Remeshing', true),
    albedo: optionalBoolean(source.albedo, 'Procedural albedo', true),
    surfaceTextures: normalizeSurfaceTextures(source.surfaceTextures),
    componentTransforms: normalizeComponentTransforms(source.componentTransforms),
  });
}

export function createProceduralAssetRecord(input, existingKeys = new Set()) {
  const source = requireObject(input, 'Procedural game object');
  const normalizedLabel = String(source.label ?? '').trim().slice(0, 48);
  if (!normalizedLabel) {
    throw new Error('A game-object name is required.');
  }
  if (!(existingKeys instanceof Set)) {
    throw new Error('Existing procedural object keys must be a Set.');
  }
  const normalizedRecipe = normalizeProceduralRecipe(source.recipe);
  const signature = JSON.stringify([normalizedLabel, normalizedRecipe]);
  const baseKey = `workshop-${slugify(normalizedLabel)}-${hashString(signature)}`;
  let key = baseKey;
  let suffix = 2;
  while (existingKeys.has(key)) {
    key = `${baseKey}-${suffix}`;
    suffix += 1;
  }
  return Object.freeze({
    version: ASSET_VERSION,
    key,
    label: normalizedLabel,
    recipe: normalizedRecipe,
  });
}

function normalizeRecord(input) {
  const source = requireObject(input, 'Procedural game-object record');
  if (!SUPPORTED_ASSET_VERSIONS.has(source.version)) {
    throw new Error('Unsupported procedural game-object version.');
  }
  if (typeof source.key !== 'string' || !/^workshop-[a-z0-9-]+$/.test(source.key)) {
    throw new Error('Procedural game object has an invalid key.');
  }
  const label = String(source.label ?? '').trim().slice(0, 48);
  if (!label) {
    throw new Error('Procedural game object has no label.');
  }
  return Object.freeze({
    version: ASSET_VERSION,
    key: source.key,
    label,
    recipe: normalizeProceduralRecipe(source.recipe),
  });
}

export class ProceduralAssetStore {
  constructor() {
    this.records = new Map();
  }

  get size() {
    return this.records.size;
  }

  list() {
    return Array.from(this.records.values());
  }

  add(input) {
    if (this.records.size >= MAX_ASSETS) {
      throw new Error(`The workshop supports at most ${MAX_ASSETS} baked game objects.`);
    }
    const record = createProceduralAssetRecord(input, new Set(this.records.keys()));
    this.records.set(record.key, record);
    return record;
  }

  replaceAll(records) {
    if (!Array.isArray(records)) {
      throw new Error('Procedural game-object payload must be an array.');
    }
    if (records.length > MAX_ASSETS) {
      throw new Error(`The workshop supports at most ${MAX_ASSETS} baked game objects.`);
    }
    const next = new Map();
    for (const input of records) {
      const record = normalizeRecord(input);
      if (next.has(record.key)) {
        throw new Error(`Duplicate procedural game-object key: ${record.key}.`);
      }
      next.set(record.key, record);
    }
    this.records = next;
  }

  toDocument() {
    return this.list().map((record) => ({
      version: record.version,
      key: record.key,
      label: record.label,
      recipe: {
        ...record.recipe,
        surfaceTextures: serializeSurfaceTextures(record.recipe.surfaceTextures),
        componentTransforms: serializeComponentTransforms(record.recipe.componentTransforms),
      },
    }));
  }
}
