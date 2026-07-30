import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import {
  MATERIAL_DATA_CATEGORIES,
  MATERIAL_DATA_REFERENCE_PROPERTIES,
  REFLECTION_CLASSES,
  assignWaterMaterialData,
  decodeReflectionClass,
  defaultMaterialData,
  encodeReflectionClass,
  packMaterialData,
} from '../../src/render/postprocessing/PostProcessingMaterialData.js';

test('reflection classes survive normalized byte encoding', () => {
  for (const reflectionClass of Object.values(REFLECTION_CLASSES)) {
    assert.equal(
      decodeReflectionClass(encodeReflectionClass(reflectionClass)),
      reflectionClass,
    );
  }
});

test('reflection class decode rounds to the nearest byte', () => {
  assert.equal(decodeReflectionClass((REFLECTION_CLASSES.WET_STONE + 0.49) / 255), REFLECTION_CLASSES.WET_STONE);
  assert.equal(decodeReflectionClass((REFLECTION_CLASSES.WET_STONE + 0.51) / 255), REFLECTION_CLASSES.POLISHED_STONE);
});

test('default material data packs opaque roughness and zero masks', () => {
  assert.deepEqual(packMaterialData(defaultMaterialData), [1, 0, 0, 0]);
});

test('registered material data is exposed through pass-level material references', () => {
  const material = assignWaterMaterialData(new THREE.MeshBasicNodeMaterial());
  assert.equal(
    material[MATERIAL_DATA_REFERENCE_PROPERTIES.roughness],
    MATERIAL_DATA_CATEGORIES.WATER.roughness,
  );
  assert.equal(
    material[MATERIAL_DATA_REFERENCE_PROPERTIES.reactive],
    MATERIAL_DATA_CATEGORIES.WATER.reactive,
  );
  assert.equal(
    decodeReflectionClass(material[MATERIAL_DATA_REFERENCE_PROPERTIES.reflectionClass]),
    REFLECTION_CLASSES.WATER,
  );
});

test('material clones preserve registered metadata through userData', () => {
  const clone = assignWaterMaterialData(new THREE.MeshBasicNodeMaterial()).clone();
  assert.equal(
    decodeReflectionClass(clone[MATERIAL_DATA_REFERENCE_PROPERTIES.reflectionClass]),
    REFLECTION_CLASSES.WATER,
  );
  assert.equal(
    clone[MATERIAL_DATA_REFERENCE_PROPERTIES.reactive],
    MATERIAL_DATA_CATEGORIES.WATER.reactive,
  );
});
