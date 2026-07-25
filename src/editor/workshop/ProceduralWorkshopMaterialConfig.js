import { parseWorkshopImageDimensions } from './ProceduralWorkshopImageMetadata.js';

const MAX_PRESETS = 48;
const MAX_SOURCES = 16;
const MAX_TOTAL_SOURCE_LENGTH = 2_400_000;
export const MAX_WORKSHOP_MATERIAL_DRAW_PARTS = 16;
const VALID_ID = /^[a-z][a-z0-9-]{0,63}$/;
const VALID_REGION_ID = /^[a-z0-9][a-z0-9:-]{0,159}$/;
const VALID_COLOR = /^#[0-9a-f]{6}$/i;
const VALID_MAPPING = new Set(['projected', 'local']);
const VALID_ROTATION = new Set([0, 90, 180, 270]);
const VALID_FAMILY = new Set([
  'walls', 'stone', 'mortar', 'roof', 'wood', 'metal', 'foliage', 'recess',
]);
const VALID_SOURCE_KIND = new Set(['albedo', 'normal', 'orm', 'height']);

export const BUILTIN_WORKSHOP_MATERIAL_PRESETS = Object.freeze({
  'granite-masonry': Object.freeze({
    id: 'granite-masonry', label: 'Granite', family: 'walls', baseColor: '#827e79',
    tint: '#ffffff', roughness: 0.9, metalness: 0, normalStrength: 0.8,
    heightStrength: 0.35, weathering: 0.35, mapping: 'projected',
    repeat: 1.5, rotation: 0, alignment: 'world', sources: Object.freeze({}),
  }),
  'limestone-masonry': Object.freeze({
    id: 'limestone-masonry', label: 'Limestone', family: 'walls', baseColor: '#c8bea4',
    tint: '#fffaf0', roughness: 0.88, metalness: 0, normalStrength: 0.65,
    heightStrength: 0.25, weathering: 0.25, mapping: 'projected',
    repeat: 1.5, rotation: 0, alignment: 'world', sources: Object.freeze({}),
  }),
  'sandstone-masonry': Object.freeze({
    id: 'sandstone-masonry', label: 'Sandstone', family: 'walls', baseColor: '#b98d5f',
    tint: '#fff2da', roughness: 0.92, metalness: 0, normalStrength: 0.7,
    heightStrength: 0.3, weathering: 0.4, mapping: 'projected',
    repeat: 1.5, rotation: 0, alignment: 'world', sources: Object.freeze({}),
  }),
  'ochre-plaster': Object.freeze({
    id: 'ochre-plaster', label: 'Ochre', family: 'walls', baseColor: '#b7793f',
    tint: '#ffe0ad', roughness: 0.96, metalness: 0, normalStrength: 0.25,
    heightStrength: 0.08, weathering: 0.45, mapping: 'projected',
    repeat: 2, rotation: 0, alignment: 'world', sources: Object.freeze({}),
  }),
  'lime-plaster': Object.freeze({
    id: 'lime-plaster', label: 'Limewash', family: 'walls', baseColor: '#d5d1bd',
    tint: '#ffffff', roughness: 0.97, metalness: 0, normalStrength: 0.2,
    heightStrength: 0.05, weathering: 0.3, mapping: 'projected',
    repeat: 2, rotation: 0, alignment: 'world', sources: Object.freeze({}),
  }),
  'terracotta-tile': Object.freeze({
    id: 'terracotta-tile', label: 'Terracotta', family: 'roof', baseColor: '#a75535',
    tint: '#ffc0a0', roughness: 0.84, metalness: 0, normalStrength: 0.85,
    heightStrength: 0.28, weathering: 0.35, mapping: 'local',
    repeat: 4, rotation: 0, alignment: 'local', sources: Object.freeze({}),
  }),
  'slate-roof': Object.freeze({
    id: 'slate-roof', label: 'Slate', family: 'roof', baseColor: '#48535a',
    tint: '#dce8ed', roughness: 0.8, metalness: 0, normalStrength: 0.7,
    heightStrength: 0.18, weathering: 0.4, mapping: 'local',
    repeat: 4, rotation: 0, alignment: 'local', sources: Object.freeze({}),
  }),
  'aged-timber': Object.freeze({
    id: 'aged-timber', label: 'Timber', family: 'wood', baseColor: '#6d462c',
    tint: '#ffd9b0', roughness: 0.9, metalness: 0, normalStrength: 0.6,
    heightStrength: 0.2, weathering: 0.5, mapping: 'local',
    repeat: 2, rotation: 0, alignment: 'local', sources: Object.freeze({}),
  }),
});

export const DEFAULT_WORKSHOP_MATERIAL_FAVORITES = Object.freeze([
  'granite-masonry',
  'limestone-masonry',
  'sandstone-masonry',
  'ochre-plaster',
  'lime-plaster',
  'terracotta-tile',
  'slate-roof',
  'aged-timber',
]);

function requireObject(value, field) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value;
}

function string(value, field, fallback = '') {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'string') throw new Error(`${field} must be a string.`);
  return result;
}

function number(value, field, fallback, minimum, maximum) {
  const result = value === undefined ? fallback : value;
  if (typeof result !== 'number' || !Number.isFinite(result)
    || result < minimum || result > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return result;
}

function id(value, field) {
  const result = string(value, field);
  if (!VALID_ID.test(result)) throw new Error(`${field} has an invalid id.`);
  return result;
}

function color(value, field, fallback) {
  const result = string(value, field, fallback).toLowerCase();
  if (!VALID_COLOR.test(result)) throw new Error(`${field} must be a six-digit hex color.`);
  return result;
}

function normalizePreset(presetId, input) {
  id(presetId, 'Material preset id');
  const source = requireObject(input, `Material preset ${presetId}`);
  const family = string(source.family, `Material preset ${presetId} family`, 'walls');
  if (!VALID_FAMILY.has(family)) throw new Error(`Unknown material family: ${family}.`);
  const mapping = string(source.mapping, `Material preset ${presetId} mapping`, 'projected');
  if (!VALID_MAPPING.has(mapping)) throw new Error(`Unknown material mapping: ${mapping}.`);
  const rotation = source.rotation ?? 0;
  if (!VALID_ROTATION.has(rotation)) throw new Error('Material rotation must be a right angle.');
  const sources = {};
  for (const [kind, sourceId] of Object.entries(
    requireObject(source.sources, `Material preset ${presetId} sources`),
  ).sort(([a], [b]) => a.localeCompare(b))) {
    if (!VALID_SOURCE_KIND.has(kind)) throw new Error(`Unknown PBR source kind: ${kind}.`);
    sources[kind] = id(sourceId, `Material preset ${presetId} ${kind} source`);
  }
  return Object.freeze({
    id: presetId,
    label: string(source.label, `Material preset ${presetId} label`, presetId).trim().slice(0, 64)
      || presetId,
    family,
    baseColor: color(source.baseColor, `Material preset ${presetId} base color`, '#ffffff'),
    tint: color(source.tint, `Material preset ${presetId} tint`, '#ffffff'),
    roughness: number(source.roughness, 'Material roughness', 0.9, 0, 1),
    metalness: number(source.metalness, 'Material metalness', 0, 0, 1),
    normalStrength: number(source.normalStrength, 'Material normal strength', 1, 0, 4),
    heightStrength: number(source.heightStrength, 'Material height strength', 0, 0, 2),
    weathering: number(source.weathering, 'Material weathering', 0, 0, 1),
    mapping,
    repeat: number(source.repeat, 'Material repeat', 1, 0.1, 16),
    rotation,
    alignment: string(source.alignment, 'Material alignment', mapping === 'local' ? 'local' : 'world'),
    sources: Object.freeze(sources),
  });
}

function normalizeSource(sourceId, input) {
  id(sourceId, 'Material source id');
  const source = requireObject(input, `Material source ${sourceId}`);
  const kind = string(source.kind, `Material source ${sourceId} kind`);
  if (!VALID_SOURCE_KIND.has(kind)) throw new Error(`Unknown PBR source kind: ${kind}.`);
  const dataUrl = string(source.dataUrl, `Material source ${sourceId} data URL`);
  if (!/^data:image\/(png|jpeg|webp);base64,/i.test(dataUrl) || dataUrl.length > 800_000) {
    throw new Error(`Material source ${sourceId} must be a bounded local PNG, JPEG, or WebP.`);
  }
  const [, mimeType, payload] = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/]+={0,2})$/i
    .exec(dataUrl) ?? [];
  if (!mimeType || !payload) throw new Error(`Material source ${sourceId} contains invalid image data.`);
  try {
    parseWorkshopImageDimensions(
      Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)),
      `image/${mimeType.toLowerCase()}`,
    );
  } catch {
    throw new Error(`Material source ${sourceId} does not match its declared image format.`);
  }
  return Object.freeze({
    kind,
    name: string(source.name, `Material source ${sourceId} name`, 'Imported map')
      .trim().slice(0, 80) || 'Imported map',
    dataUrl,
    colorSpace: kind === 'albedo' ? 'srgb' : 'linear',
  });
}

function legacyFamilyDefaults(surfaceTextures) {
  const result = {};
  if (!surfaceTextures?.slots) return result;
  if (surfaceTextures.slots.walls) result.walls = 'granite-masonry';
  if (surfaceTextures.slots.stone) result.stone = 'granite-masonry';
  if (surfaceTextures.slots.roof) result.roof = 'slate-roof';
  if (surfaceTextures.slots.wood) result.wood = 'aged-timber';
  return result;
}

export function normalizeWorkshopMaterialDocument(input = {}, { surfaceTextures } = {}) {
  const source = requireObject(input, 'Workshop material document');
  const library = requireObject(source.materialLibrary, 'Workshop material library');
  const presetInputs = requireObject(library.presets, 'Workshop material presets');
  const sourceInputs = requireObject(library.sources, 'Workshop material sources');
  if (Object.keys(presetInputs).length > MAX_PRESETS) throw new Error('Too many material presets.');
  if (Object.keys(sourceInputs).length > MAX_SOURCES) throw new Error('Too many material sources.');

  const presets = {};
  for (const [presetId, presetInput] of Object.entries(presetInputs).sort(([a], [b]) => (
    a.localeCompare(b)
  ))) presets[presetId] = normalizePreset(presetId, presetInput);
  const allSources = {};
  for (const [sourceId, sourceInput] of Object.entries(sourceInputs).sort(([a], [b]) => (
    a.localeCompare(b)
  ))) allSources[sourceId] = normalizeSource(sourceId, sourceInput);

  const availablePreset = (presetId) => presets[presetId] ?? BUILTIN_WORKSHOP_MATERIAL_PRESETS[presetId];
  const defaultsInput = {
    ...legacyFamilyDefaults(surfaceTextures),
    ...requireObject(source.materialDefaults, 'Workshop material defaults'),
  };
  const materialDefaults = {};
  for (const [family, presetId] of Object.entries(defaultsInput).sort(([a], [b]) => (
    a.localeCompare(b)
  ))) {
    if (!VALID_FAMILY.has(family)) throw new Error(`Unknown material family: ${family}.`);
    if (!availablePreset(presetId)) throw new Error(`Missing material preset: ${presetId}.`);
    materialDefaults[family] = presetId;
  }

  const materialAreaOverrides = {};
  for (const [regionId, presetId] of Object.entries(
    requireObject(source.materialAreaOverrides, 'Workshop material area overrides'),
  ).sort(([a], [b]) => a.localeCompare(b))) {
    if (!VALID_REGION_ID.test(regionId)) throw new Error(`Invalid material region id: ${regionId}.`);
    if (!availablePreset(presetId)) throw new Error(`Missing material preset: ${presetId}.`);
    materialAreaOverrides[regionId] = presetId;
  }

  const favoritesInput = source.materialFavorites ?? DEFAULT_WORKSHOP_MATERIAL_FAVORITES;
  if (!Array.isArray(favoritesInput)) throw new Error('Material favorites must be an array.');
  const materialFavorites = [...new Set(favoritesInput)].slice(0, 8);
  for (const presetId of materialFavorites) {
    if (!availablePreset(presetId)) throw new Error(`Missing favorite material preset: ${presetId}.`);
  }

  const usedPresetIds = new Set([
    ...Object.values(materialDefaults),
    ...Object.values(materialAreaOverrides),
    ...materialFavorites,
  ]);
  const keptPresets = Object.fromEntries(
    Object.entries(presets).filter(([presetId]) => usedPresetIds.has(presetId)),
  );
  const usedSourceIds = new Set();
  Object.values(keptPresets).forEach((preset) => {
    Object.values(preset.sources).forEach((sourceId) => usedSourceIds.add(sourceId));
  });
  const sources = {};
  let totalSourceLength = 0;
  for (const sourceId of [...usedSourceIds].sort()) {
    if (!allSources[sourceId]) throw new Error(`Missing material source: ${sourceId}.`);
    sources[sourceId] = allSources[sourceId];
    totalSourceLength += allSources[sourceId].dataUrl.length;
  }
  for (const preset of Object.values(keptPresets)) {
    for (const [kind, sourceId] of Object.entries(preset.sources)) {
      if (sources[sourceId].kind !== kind) {
        throw new Error(`Material preset ${preset.id} uses a ${sources[sourceId].kind} source as ${kind}.`);
      }
    }
  }
  if (totalSourceLength > MAX_TOTAL_SOURCE_LENGTH) {
    throw new Error('The full-PBR source maps are too large for one workshop object.');
  }

  return Object.freeze({
    materialLibrary: Object.freeze({
      sources: Object.freeze(sources),
      presets: Object.freeze(keptPresets),
    }),
    materialDefaults: Object.freeze(materialDefaults),
    materialAreaOverrides: Object.freeze(materialAreaOverrides),
    materialFavorites: Object.freeze(materialFavorites),
  });
}

export function serializeWorkshopMaterialDocument(input = {}, options) {
  const document = normalizeWorkshopMaterialDocument(input, options);
  return {
    materialLibrary: {
      sources: Object.fromEntries(Object.entries(document.materialLibrary.sources).map(
        ([sourceId, source]) => [sourceId, { ...source }],
      )),
      presets: Object.fromEntries(Object.entries(document.materialLibrary.presets).map(
        ([presetId, preset]) => [presetId, { ...preset, sources: { ...preset.sources } }],
      )),
    },
    materialDefaults: { ...document.materialDefaults },
    materialAreaOverrides: { ...document.materialAreaOverrides },
    materialFavorites: [...document.materialFavorites],
  };
}

export function getWorkshopMaterialPreset(document, presetId) {
  return document?.materialLibrary?.presets?.[presetId]
    ?? BUILTIN_WORKSHOP_MATERIAL_PRESETS[presetId]
    ?? null;
}

export function resolveWorkshopMaterialRegion(document, region) {
  const presetId = document.materialAreaOverrides[region.id]
    ?? document.materialDefaults[region.family]
    ?? null;
  return Object.freeze({
    ...region,
    presetId,
    inherited: !Object.hasOwn(document.materialAreaOverrides, region.id),
    preset: presetId ? getWorkshopMaterialPreset(document, presetId) : null,
  });
}

export function workshopMaterialRegionId(componentId, family) {
  return `${componentId}:${family}`;
}

export function createWorkshopMaterialSourceId(kind, dataUrl) {
  if (!VALID_SOURCE_KIND.has(kind)) throw new Error(`Unknown PBR source kind: ${kind}.`);
  if (typeof dataUrl !== 'string') throw new Error('Material source data must be a string.');
  let hash = 2166136261;
  for (let index = 0; index < dataUrl.length; index += 1) {
    hash ^= dataUrl.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${kind}-${(hash >>> 0).toString(36)}-${dataUrl.length.toString(36)}`;
}
