import * as THREE from 'three/webgpu';
import {
  getWorkshopMaterialPreset,
} from '../../workshop/ProceduralWorkshopMaterialConfig.js';
import {
  proceduralNormalTexture,
  surfaceBumpTexture,
  surfaceRoughnessTexture,
} from '../../workshop/ProceduralWorkshopMaterials.js';
import { stoneSurfaceProfile } from '../../workshop/ProceduralWorkshopStoneSurfaceConfig.js';
import { constructionStyle } from '../masonry/ConstructionStyleCatalog.js';
import { CONSTRUCTION_MATERIAL_SLOT } from './ConstructionMaterialSlots.js';
import { mortarProfile } from './ConstructionMortarConfig.js';

/**
 * Stone materials for live constructions.
 *
 * Mirrors the stone slot of `createWorkshopMaterials`
 * (`ProceduralWorkshopMaterials.js:510-527`) so a wall and a workshop building
 * made of nominally the same stone actually match. Tone mapping is deliberately
 * untouched — the world renderer and the workshop preview are both already
 * ACESFilmic at exposure 1.12 and must stay in agreement.
 *
 * When `record.style.materials.stone` names a workshop preset, that preset's
 * colour / roughness / optional albedo are applied on top of the procedural
 * base so the radial palette paint is visible, not only persisted.
 *
 * Materials are cached and shared across modules. A 200 m wall is ~17 modules,
 * and giving each its own material would mean 17 identical pipelines.
 */

const cache = new Map();
/** @type {Map<string, { texture: THREE.Texture, users: number }>} */
const PRESET_TEXTURE_CACHE = new Map();
const MAX_PRESET_TEXTURE_CACHE = 64;
const PRESET_TEXTURE_SLOTS = Object.freeze([
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'bumpMap',
]);
let sourceSignatureCache = new WeakMap();
let activeLeaseCollector = null;

function hashText(value) {
  let hash = 0x811c9dc5;
  const text = String(value ?? '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function sourceSignature(source) {
  if (!source || typeof source !== 'object') return '-';
  const cached = sourceSignatureCache.get(source);
  if (cached) return cached;
  const signature = hashText([
    source.kind ?? '-',
    source.colorSpace ?? '-',
    source.dataUrl ?? '-',
  ].join('|'));
  sourceSignatureCache.set(source, signature);
  return signature;
}

function presetSignature(document, presetId) {
  if (!presetId) return '-';
  const preset = getWorkshopMaterialPreset(document, presetId);
  if (!preset) return `${presetId}:missing`;

  const parts = [
    preset.id,
    preset.family,
    preset.baseColor,
    preset.tint,
    preset.roughness,
    preset.metalness,
    preset.normalStrength,
    preset.heightStrength,
    preset.weathering,
    preset.mapping,
    preset.repeat,
    preset.rotation,
    preset.alignment,
  ];
  for (const [kind, sourceId] of Object.entries(preset.sources ?? {}).sort(([a], [b]) => (
    a.localeCompare(b)
  ))) {
    const source = document?.materialLibrary?.sources?.[sourceId] ?? null;
    parts.push(kind, sourceId, sourceSignature(source));
  }
  return `${presetId}:${hashText(parts.join('|'))}`;
}

function materialKey(record, materialDocument) {
  const { key, version, materials } = record.style;
  return [
    key,
    version,
    presetSignature(materialDocument, materials.stone),
    presetSignature(materialDocument, materials.mortar),
    presetSignature(materialDocument, materials.roof),
    record.seed,
  ].join('|');
}

function createStoneMaterial(record, style) {
  const seed = record.seed >>> 0;
  const surface = stoneSurfaceProfile(style.stonePalette);
  const config = surface.material;
  const normalKind = config.normalKind
    ?? (style.irregularity > 0.5 ? 'granite' : 'stoneBlock');

  const material = new THREE.MeshStandardNodeMaterial({
    color: '#ffffff',
    roughness: 1,
    metalness: 0,
    // Every stone carries baked crevice occlusion and a per-unit palette colour
    // in its vertex colours. Dropping this throws away every joint line, so any
    // geometry merged into this material must carry the attribute — see
    // `harmonizeVertexColors(..., { required: true })` in the masonry builder.
    vertexColors: true,
  });
  material.bumpMap = surfaceBumpTexture(seed, config.bumpTextureScale);
  material.bumpScale = config.bumpScale;
  material.roughnessMap = surfaceRoughnessTexture(seed + 101, {
    base: config.roughnessBase,
    variation: config.roughnessVariation,
    broadScale: config.roughnessBroadScale,
  });
  if (style.detail >= 2) {
    material.normalMap = proceduralNormalTexture(normalKind, seed + 503);
  }
  if (
    Number.isFinite(config.constructionNormalScale)
    && material.normalScale?.setScalar
  ) {
    material.normalScale.setScalar(config.constructionNormalScale);
  }
  if (Number.isFinite(config.constructionEnvMapIntensity)) {
    material.envMapIntensity = config.constructionEnvMapIntensity;
  }
  material.userData.constructionSlot = CONSTRUCTION_MATERIAL_SLOT.STONE;
  material.userData.stoneSurfaceProfile = style.stonePalette;
  material.userData.stoneSurface = Object.freeze({
    palette: style.stonePalette,
    bumpScale: config.bumpScale,
    bumpTextureScale: config.bumpTextureScale,
    normalKind,
    normalScale: config.constructionNormalScale,
    roughnessBase: config.roughnessBase,
    roughnessVariation: config.roughnessVariation,
    roughnessBroadScale: config.roughnessBroadScale,
    envMapIntensity: config.constructionEnvMapIntensity,
  });
  return material;
}

/**
 * Recessed joint / core material. Kept deliberately flat: mortar is seen through
 * narrow gaps, so maps and vertex colours add cost with little readable value.
 */
function createMortarMaterial(record, style) {
  const profile = mortarProfile(style.key);
  const material = new THREE.MeshStandardNodeMaterial({
    color: profile.color,
    roughness: profile.roughness,
    metalness: profile.metalness,
  });
  material.userData.constructionSlot = CONSTRUCTION_MATERIAL_SLOT.MORTAR;
  return material;
}

function configurePresetTexture(texture, preset, kind) {
  texture.colorSpace = kind === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.center.set(0.5, 0.5);
  texture.repeat.set(preset.repeat, preset.repeat);
  texture.rotation = THREE.MathUtils.degToRad(preset.rotation);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function presetTextureKey(document, preset, kind) {
  const sourceId = preset.sources?.[kind];
  const source = document?.materialLibrary?.sources?.[sourceId];
  if (!source) return null;
  return [
    kind,
    sourceId,
    sourceSignature(source),
    preset.mapping,
    preset.repeat,
    preset.rotation,
  ].join('|');
}

/**
 * Drop unused preset textures (users === 0) in LRU order until there is room.
 * In-use textures stay — disposing them would blank live painted walls.
 */
function evictUnusedPresetTextures() {
  while (PRESET_TEXTURE_CACHE.size >= MAX_PRESET_TEXTURE_CACHE) {
    let removed = false;
    for (const [key, entry] of PRESET_TEXTURE_CACHE) {
      if (entry.users > 0) continue;
      entry.texture.dispose?.();
      PRESET_TEXTURE_CACHE.delete(key);
      removed = true;
      break;
    }
    if (!removed) break;
  }
}

function touchPresetTextureEntry(key, entry) {
  // Refresh LRU order: Map iterates in insertion order.
  PRESET_TEXTURE_CACHE.delete(key);
  PRESET_TEXTURE_CACHE.set(key, entry);
}

/**
 * Look up or create a shared preset texture without retaining it.
 * Live material bundles must call `acquirePresetTexture` so LRU cannot dispose
 * maps still referenced by painted walls.
 */
function getPresetTexture(document, preset, kind) {
  if (typeof Image === 'undefined') return null;
  const key = presetTextureKey(document, preset, kind);
  if (!key) return null;

  let entry = PRESET_TEXTURE_CACHE.get(key);
  if (entry) {
    touchPresetTextureEntry(key, entry);
    return entry.texture;
  }

  evictUnusedPresetTextures();
  const sourceId = preset.sources?.[kind];
  const source = document?.materialLibrary?.sources?.[sourceId];
  const image = new Image();
  const texture = new THREE.Texture(image);
  image.addEventListener('load', () => {
    texture.needsUpdate = true;
  }, { once: true });
  image.src = source.dataUrl;
  texture.name = `construction-pbr-${sourceId}`;
  texture.userData.sharedSurface = true;
  entry = {
    texture: configurePresetTexture(texture, preset, kind),
    users: 0,
  };
  PRESET_TEXTURE_CACHE.set(key, entry);
  return entry.texture;
}

/**
 * Retain a shared preset texture for a material bundle's lifetime.
 * Each unique key is retained once per acquire list.
 */
function acquirePresetTexture(document, preset, kind, acquiredKeys) {
  const key = presetTextureKey(document, preset, kind);
  if (!key) return null;
  const texture = getPresetTexture(document, preset, kind);
  if (!texture) return null;
  if (!acquiredKeys.includes(key)) {
    const entry = PRESET_TEXTURE_CACHE.get(key);
    if (entry) entry.users += 1;
    acquiredKeys.push(key);
  }
  return texture;
}

function releasePresetTextureKeys(keys) {
  if (!keys?.length) return;
  for (const key of keys) {
    const entry = PRESET_TEXTURE_CACHE.get(key);
    if (!entry) continue;
    entry.users -= 1;
    if (entry.users > 0) continue;
    entry.texture.dispose?.();
    PRESET_TEXTURE_CACHE.delete(key);
  }
}

/** Detach shared preset maps so `material.dispose()` cannot free live refs. */
function detachPresetTextures(material, presetTextures) {
  if (!presetTextures?.size) return;
  for (const slot of PRESET_TEXTURE_SLOTS) {
    const texture = material[slot];
    if (texture && presetTextures.has(texture)) material[slot] = null;
  }
}

function collectMaterialLease(materials) {
  activeLeaseCollector?.push(materials);
}

/**
 * Capture every construction-material acquisition made synchronously by an
 * operation and return an idempotent release function for that temporary scope.
 */
export function captureConstructionMaterialLease(operation) {
  if (typeof operation !== 'function') {
    throw new Error('Construction material lease requires an operation.');
  }
  const acquired = [];
  const previousCollector = activeLeaseCollector;
  activeLeaseCollector = acquired;
  try {
    operation();
  } catch (error) {
    for (let index = acquired.length - 1; index >= 0; index -= 1) {
      releaseConstructionMaterials(acquired[index]);
    }
    throw error;
  } finally {
    activeLeaseCollector = previousCollector;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (let index = acquired.length - 1; index >= 0; index -= 1) {
      releaseConstructionMaterials(acquired[index]);
    }
  };
}

/**
 * Apply a workshop material preset onto a construction stone material.
 *
 * Same colour / map rules as the workshop component painter so a granite petal
 * on a live wall matches granite in the workshop.
 */
export function applyConstructionMaterialPreset(
  material,
  preset,
  materialDocument = null,
  acquiredKeys = null,
) {
  if (!preset) return material;
  const take = acquiredKeys
    ? (kind) => acquirePresetTexture(materialDocument, preset, kind, acquiredKeys)
    : (kind) => getPresetTexture(materialDocument, preset, kind);
  const result = material.clone();
  result.color.set(preset.baseColor).multiply(new THREE.Color(preset.tint));
  result.roughness = preset.roughness;
  result.metalness = preset.metalness;
  if (result.normalScale?.setScalar) result.normalScale.setScalar(preset.normalStrength);
  if ('bumpScale' in result) result.bumpScale = preset.heightStrength;
  const albedo = take('albedo');
  const normal = take('normal');
  const orm = take('orm');
  const height = take('height');
  if (albedo) result.map = albedo;
  if (normal) result.normalMap = normal;
  if (height) result.bumpMap = height;
  if (orm) {
    result.roughnessMap = orm;
    result.metalnessMap = orm;
  }
  result.userData = {
    ...material.userData,
    workshopPresetId: preset.id,
    workshopMaterialFamily: preset.family,
  };
  return result;
}

export function createConstructionMaterials(record, materialDocument = null) {
  const key = materialKey(record, materialDocument);
  const found = cache.get(key);
  if (found) {
    found.users += 1;
    collectMaterialLease(found.materials);
    return found.materials;
  }
  const acquiredKeys = [];
  const style = constructionStyle(record.style.key);
  let stone = createStoneMaterial(record, style);
  const stonePresetId = record.style?.materials?.stone ?? null;
  const stonePreset = stonePresetId
    ? getWorkshopMaterialPreset(materialDocument, stonePresetId)
    : null;
  if (stonePreset) {
    stone = applyConstructionMaterialPreset(
      stone,
      stonePreset,
      materialDocument,
      acquiredKeys,
    );
  }
  // Selection tints rather than replaces. Swapping to a flat gold material
  // would drop `vertexColors` and take every baked joint line with it, so a
  // selected wall would read as a smooth blob.
  const stoneSelected = stone.clone();
  stoneSelected.emissive = new THREE.Color('#6a4f12');
  stoneSelected.emissiveIntensity = 0.55;
  stoneSelected.userData.constructionSlot = CONSTRUCTION_MATERIAL_SLOT.STONE;

  // Mortar stays dark when selected — gold would erase joint contrast.
  let mortar = createMortarMaterial(record, style);
  const mortarPresetId = record.style?.materials?.mortar ?? null;
  const mortarPreset = mortarPresetId
    ? getWorkshopMaterialPreset(materialDocument, mortarPresetId)
    : null;
  if (mortarPreset) {
    mortar = applyConstructionMaterialPreset(
      mortar,
      mortarPreset,
      materialDocument,
      acquiredKeys,
    );
    mortar.userData.constructionSlot = CONSTRUCTION_MATERIAL_SLOT.MORTAR;
  }

  const materials = Object.freeze({ stone, stoneSelected, mortar });
  const presetTextures = new Set();
  for (const textureKey of acquiredKeys) {
    const entry = PRESET_TEXTURE_CACHE.get(textureKey);
    if (entry) presetTextures.add(entry.texture);
  }
  cache.set(key, {
    materials,
    users: 1,
    presetKeys: Object.freeze([...acquiredKeys]),
    presetTextures,
  });
  collectMaterialLease(materials);
  return materials;
}

/**
 * Drop one user of a materials bundle. When the last user goes, dispose the
 * GPU objects so style/preset/seed edits cannot retain pipelines forever.
 */
export function releaseConstructionMaterials(materials) {
  if (!materials) return;
  for (const [key, entry] of cache.entries()) {
    if (entry.materials !== materials) continue;
    entry.users -= 1;
    if (entry.users > 0) return;
    for (const material of Object.values(entry.materials)) {
      detachPresetTextures(material, entry.presetTextures);
      material.dispose();
    }
    releasePresetTextureKeys(entry.presetKeys);
    cache.delete(key);
    return;
  }
}

/** Test seam and teardown hook; materials are otherwise shared for the session. */
export function disposeConstructionMaterials() {
  for (const entry of cache.values()) {
    for (const material of Object.values(entry.materials)) {
      detachPresetTextures(material, entry.presetTextures);
      material.dispose();
    }
  }
  cache.clear();
  for (const entry of PRESET_TEXTURE_CACHE.values()) entry.texture.dispose?.();
  PRESET_TEXTURE_CACHE.clear();
  sourceSignatureCache = new WeakMap();
  activeLeaseCollector = null;
}

/** Test seam: how many construction material bundles are currently cached. */
export function constructionMaterialCacheSize() {
  return cache.size;
}

/** Test seam: how many preset textures are currently cached. */
export function presetTextureCacheSize() {
  return PRESET_TEXTURE_CACHE.size;
}