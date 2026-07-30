import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REFLECTION_CLASSES,
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
