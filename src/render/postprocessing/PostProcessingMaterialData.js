import { vec4 } from 'three/tsl';

export const REFLECTION_CLASSES = Object.freeze({
  NONE: 0,
  WATER: 1,
  ICE: 2,
  WET_STONE: 3,
  POLISHED_STONE: 4,
  MAGICAL_MIRROR: 5,
});

const REFLECTION_CLASS_SCALE = 255;

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

export function encodeReflectionClass(reflectionClass) {
  return Math.min(REFLECTION_CLASS_SCALE, Math.max(0, Math.round(reflectionClass)))
    / REFLECTION_CLASS_SCALE;
}

export function decodeReflectionClass(encodedClass) {
  return Math.min(
    REFLECTION_CLASS_SCALE,
    Math.max(0, Math.round(Number(encodedClass) * REFLECTION_CLASS_SCALE)),
  );
}

export function packMaterialData(data = defaultMaterialData) {
  return Object.freeze([
    data.roughness ?? defaultMaterialData.roughness,
    data.reactive ?? defaultMaterialData.reactive,
    encodeReflectionClass(data.reflectionClass ?? defaultMaterialData.reflectionClass),
    data.bloomBoost ?? defaultMaterialData.bloomBoost,
  ]);
}

export function packMaterialDataNode(data = defaultMaterialData) {
  return vec4(
    data.roughness ?? defaultMaterialData.roughness,
    data.reactive ?? defaultMaterialData.reactive,
    encodeReflectionClass(data.reflectionClass ?? defaultMaterialData.reflectionClass),
    data.bloomBoost ?? defaultMaterialData.bloomBoost,
  );
}

/**
 * Registers post-processing material metadata without assigning `mrtNode`.
 * Per-material `mrtNode` overrides compile empty OutputType structs during
 * non-MRT paths (god rays / compileAsync prewarm). The scene pass already
 * writes default material data; category metadata is kept on userData for
 * later attribute-driven overrides.
 */
export function assignMaterialData(material, data = {}) {
  if (!material?.isNodeMaterial) {
    throw new TypeError('Post-processing material data requires a NodeMaterial.');
  }
  const packed = {
    roughness: data.roughness ?? material.roughnessNode ?? material.roughness ?? 1,
    reactive: data.reactive ?? defaultMaterialData.reactive,
    reflectionClass: data.reflectionClass ?? defaultMaterialData.reflectionClass,
    bloomBoost: data.bloomBoost ?? defaultMaterialData.bloomBoost,
  };
  material.userData.postProcessingMaterialData = Object.freeze({ ...packed });
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
