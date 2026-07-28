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
const PRESET_TEXTURE_CACHE = new Map();
const MAX_PRESET_TEXTURE_CACHE = 64;

function materialKey(record) {
  const { key, version, materials } = record.style;
  return [
    key,
    version,
    materials.stone ?? '-',
    materials.mortar ?? '-',
    materials.roof ?? '-',
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

function presetTexture(document, preset, kind) {
  if (typeof Image === 'undefined') return null;
  const sourceId = preset.sources?.[kind];
  const source = document?.materialLibrary?.sources?.[sourceId];
  if (!source) return null;
  const key = `${kind}|${sourceId}|${preset.mapping}|${preset.repeat}|${preset.rotation}`;
  if (!PRESET_TEXTURE_CACHE.has(key)) {
    if (PRESET_TEXTURE_CACHE.size >= MAX_PRESET_TEXTURE_CACHE) return null;
    const image = new Image();
    const texture = new THREE.Texture(image);
    image.addEventListener('load', () => {
      texture.needsUpdate = true;
    }, { once: true });
    image.src = source.dataUrl;
    texture.name = `construction-pbr-${sourceId}`;
    texture.userData.sharedSurface = true;
    PRESET_TEXTURE_CACHE.set(key, configurePresetTexture(texture, preset, kind));
  }
  return PRESET_TEXTURE_CACHE.get(key);
}

/**
 * Apply a workshop material preset onto a construction stone material.
 *
 * Same colour / map rules as the workshop component painter so a granite petal
 * on a live wall matches granite in the workshop.
 */
export function applyConstructionMaterialPreset(material, preset, materialDocument = null) {
  if (!preset) return material;
  const result = material.clone();
  result.color.set(preset.baseColor).multiply(new THREE.Color(preset.tint));
  result.roughness = preset.roughness;
  result.metalness = preset.metalness;
  if (result.normalScale?.setScalar) result.normalScale.setScalar(preset.normalStrength);
  if ('bumpScale' in result) result.bumpScale = preset.heightStrength;
  const albedo = presetTexture(materialDocument, preset, 'albedo');
  const normal = presetTexture(materialDocument, preset, 'normal');
  const orm = presetTexture(materialDocument, preset, 'orm');
  const height = presetTexture(materialDocument, preset, 'height');
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
  const key = materialKey(record);
  const found = cache.get(key);
  if (found) {
    found.users += 1;
    return found.materials;
  }
  const style = constructionStyle(record.style.key);
  let stone = createStoneMaterial(record, style);
  const stonePresetId = record.style?.materials?.stone ?? null;
  const stonePreset = stonePresetId
    ? getWorkshopMaterialPreset(materialDocument, stonePresetId)
    : null;
  if (stonePreset) {
    stone = applyConstructionMaterialPreset(stone, stonePreset, materialDocument);
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
    mortar = applyConstructionMaterialPreset(mortar, mortarPreset, materialDocument);
    mortar.userData.constructionSlot = CONSTRUCTION_MATERIAL_SLOT.MORTAR;
  }

  const materials = Object.freeze({ stone, stoneSelected, mortar });
  cache.set(key, { materials, users: 1 });
  return materials;
}

/** Test seam and teardown hook; materials are otherwise shared for the session. */
export function disposeConstructionMaterials() {
  for (const { materials } of cache.values()) {
    for (const material of Object.values(materials)) material.dispose();
  }
  cache.clear();
  for (const texture of PRESET_TEXTURE_CACHE.values()) texture.dispose?.();
  PRESET_TEXTURE_CACHE.clear();
}
