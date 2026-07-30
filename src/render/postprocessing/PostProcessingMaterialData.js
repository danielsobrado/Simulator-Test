import * as THREE from 'three/webgpu';
import { materialReference, vec4 } from 'three/tsl';

export const REFLECTION_CLASSES = Object.freeze({
  NONE: 0,
  WATER: 1,
  ICE: 2,
  WET_STONE: 3,
  POLISHED_STONE: 4,
  MAGICAL_MIRROR: 5,
});

const REFLECTION_CLASS_SCALE = 255;
const MATERIAL_DATA_ACCESSOR_FLAG = Symbol.for('drusniel.postProcessingMaterialDataAccessors');

export const MATERIAL_DATA_REFERENCE_PROPERTIES = Object.freeze({
  roughness: 'postProcessingRoughness',
  reactive: 'postProcessingReactive',
  reflectionClass: 'postProcessingReflectionClass',
  bloomBoost: 'postProcessingBloomBoost',
});

export const MATERIAL_DATA_CATEGORIES = Object.freeze({
  TERRAIN: Object.freeze({ roughness: 1, reactive: 0, reflectionClass: REFLECTION_CLASSES.NONE, bloomBoost: 0 }),
  WATER: Object.freeze({ roughness: 0.08, reactive: 0.85, reflectionClass: REFLECTION_CLASSES.WATER, bloomBoost: 0 }),
  GRASS: Object.freeze({ roughness: 1, reactive: 0.65, reflectionClass: REFLECTION_CLASSES.NONE, bloomBoost: 0 }),
  TREE_FOLIAGE: Object.freeze({ roughness: 1, reactive: 0.55, reflectionClass: REFLECTION_CLASSES.NONE, bloomBoost: 0 }),
  BUSH_FOLIAGE: Object.freeze({ roughness: 1, reactive: 0.55, reflectionClass: REFLECTION_CLASSES.NONE, bloomBoost: 0 }),
  PARTICLE: Object.freeze({ roughness: 1, reactive: 1, reflectionClass: REFLECTION_CLASSES.NONE, bloomBoost: 0 }),
});

export const defaultMaterialData = Object.freeze({
  roughness: 1,
  reactive: 0,
  reflectionClass: REFLECTION_CLASSES.NONE,
  bloomBoost: 0,
});

function clamp01(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
}

function normalizeReflectionClass(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.min(REFLECTION_CLASS_SCALE, Math.max(0, Math.round(number)))
    : defaultMaterialData.reflectionClass;
}

export function encodeReflectionClass(reflectionClass) {
  return normalizeReflectionClass(reflectionClass) / REFLECTION_CLASS_SCALE;
}

export function decodeReflectionClass(encodedClass) {
  return Math.min(
    REFLECTION_CLASS_SCALE,
    Math.max(0, Math.round(Number(encodedClass) * REFLECTION_CLASS_SCALE)),
  );
}

function readMaterialData(material, key) {
  const data = material?.userData?.postProcessingMaterialData ?? defaultMaterialData;
  if (key === 'reflectionClass') return encodeReflectionClass(data.reflectionClass);
  return clamp01(data[key], defaultMaterialData[key]);
}

/**
 * Pass-level MRT nodes can safely read these per-object material references.
 * Keeping metadata in userData preserves it across Material.clone()/copy().
 */
export function installMaterialDataAccessors() {
  const prototype = THREE.Material.prototype;
  if (prototype[MATERIAL_DATA_ACCESSOR_FLAG]) return false;

  for (const [key, property] of Object.entries(MATERIAL_DATA_REFERENCE_PROPERTIES)) {
    if (Object.getOwnPropertyDescriptor(prototype, property)) continue;
    Object.defineProperty(prototype, property, {
      configurable: true,
      enumerable: false,
      get() {
        return readMaterialData(this, key);
      },
    });
  }

  Object.defineProperty(prototype, MATERIAL_DATA_ACCESSOR_FLAG, {
    configurable: true,
    value: true,
  });
  return true;
}

installMaterialDataAccessors();

export function packMaterialData(data = defaultMaterialData) {
  return Object.freeze([
    clamp01(data.roughness, defaultMaterialData.roughness),
    clamp01(data.reactive, defaultMaterialData.reactive),
    encodeReflectionClass(data.reflectionClass),
    clamp01(data.bloomBoost, defaultMaterialData.bloomBoost),
  ]);
}

export function packMaterialDataNode(data = null) {
  if (data) {
    return vec4(...packMaterialData(data));
  }
  return vec4(
    materialReference(MATERIAL_DATA_REFERENCE_PROPERTIES.roughness, 'float'),
    materialReference(MATERIAL_DATA_REFERENCE_PROPERTIES.reactive, 'float'),
    materialReference(MATERIAL_DATA_REFERENCE_PROPERTIES.reflectionClass, 'float'),
    materialReference(MATERIAL_DATA_REFERENCE_PROPERTIES.bloomBoost, 'float'),
  );
}

export function assignMaterialData(material, data = {}) {
  if (!material?.isNodeMaterial) {
    throw new TypeError('Post-processing material data requires a NodeMaterial.');
  }
  const roughnessFallback = Number.isFinite(Number(material.roughness))
    ? Number(material.roughness)
    : defaultMaterialData.roughness;
  const packed = Object.freeze({
    roughness: clamp01(data.roughness, roughnessFallback),
    reactive: clamp01(data.reactive, defaultMaterialData.reactive),
    reflectionClass: normalizeReflectionClass(data.reflectionClass),
    bloomBoost: clamp01(data.bloomBoost, defaultMaterialData.bloomBoost),
  });
  material.userData.postProcessingMaterialData = packed;
  return material;
}

export function assignMaterialCategory(material, category) {
  if (!category) throw new TypeError('A post-processing material category is required.');
  return assignMaterialData(material, category);
}

export const assignTerrainMaterialData = (material) => (
  assignMaterialCategory(material, MATERIAL_DATA_CATEGORIES.TERRAIN)
);
export const assignWaterMaterialData = (material) => (
  assignMaterialCategory(material, MATERIAL_DATA_CATEGORIES.WATER)
);
export const assignGrassMaterialData = (material) => (
  assignMaterialCategory(material, MATERIAL_DATA_CATEGORIES.GRASS)
);
export const assignTreeFoliageMaterialData = (material) => (
  assignMaterialCategory(material, MATERIAL_DATA_CATEGORIES.TREE_FOLIAGE)
);
export const assignBushFoliageMaterialData = (material) => (
  assignMaterialCategory(material, MATERIAL_DATA_CATEGORIES.BUSH_FOLIAGE)
);
export const assignParticleMaterialData = (material) => (
  assignMaterialCategory(material, MATERIAL_DATA_CATEGORIES.PARTICLE)
);
