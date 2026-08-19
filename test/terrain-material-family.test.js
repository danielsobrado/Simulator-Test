import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import * as THREE from 'three/webgpu';
import yaml from 'js-yaml';
import { createTerrainMaterialBakeConfig } from '../src/editor/materials/TerrainMaterialBakeConfig.js';
import {
  acquireTerrainMaterialFamilyAtlas,
  getTerrainMaterialFamilyAtlasEntryCount,
} from '../src/editor/materials/TerrainMaterialFamilyAtlas.js';
import { TERRAIN_MATERIAL_FAMILIES } from '../src/editor/materials/TerrainMaterialFamilyConstants.js';
import { generateTerrainMaterialFamilyPixels } from '../src/editor/materials/TerrainMaterialFamilyPixels.js';

function sourceConfig() {
  return yaml.load(fs.readFileSync(
    new URL('../config/terrain-material-bake.yaml', import.meta.url),
    'utf8',
  ));
}

function validatedConfig() {
  return createTerrainMaterialBakeConfig(sourceConfig());
}

function layerBytes(result, layer) {
  const bytes = result.resolution * result.resolution * 4;
  return result.pixels.slice(layer * bytes, (layer + 1) * bytes);
}

test('terrain material families validate bounded shared-atlas settings', () => {
  const config = validatedConfig();
  assert.equal(config.families.enabled, true);
  assert.equal(config.families.resolution, 64);
  assert.equal(config.families.variantsPerFamily, 4);
  assert.equal(config.families.scaleJitter, 0.18);
  assert.equal(config.families.contrastPreservation, 0.62);
  assert.equal(config.families.secondaryBlendStrength, 0.85);
  assert.equal(config.families.genomes.enabled, true);
  assert.equal(config.families.features.enabled, true);
  assert.equal(config.families.weathering.enabled, true);
  assert.deepEqual(Object.keys(config.families.profiles), TERRAIN_MATERIAL_FAMILIES);
  assert.equal(config.families.projection.slopeStart < config.families.projection.slopeFull, true);
  assert.equal(config.families.microFadeStartDistance < config.families.microFadeEndDistance, true);
  assert.equal(config.families.normalFadeStartDistance < config.families.normalFadeEndDistance, true);
  assert.equal(config.families.features.fadeStartDistance < config.families.features.fadeEndDistance, true);
  assert.equal(config.families.weathering.fadeStartDistance < config.families.weathering.fadeEndDistance, true);
  assert.equal(Object.isFrozen(config.families), true);
  assert.equal(Object.isFrozen(config.families.profiles.rock), true);
  assert.equal(Object.isFrozen(config.families.genomes), true);
  assert.equal(Object.isFrozen(config.families.features), true);
  assert.equal(Object.isFrozen(config.families.weathering), true);
});

test('terrain material family config rejects unsafe atlas, fade, scale and feature settings', () => {
  const tooManyVariants = sourceConfig();
  tooManyVariants.families.variantsPerFamily = 9;
  assert.throws(
    () => createTerrainMaterialBakeConfig(tooManyVariants),
    /families\.variantsPerFamily must be an integer within \[1, 8\]/,
  );

  const invalidScaleJitter = sourceConfig();
  invalidScaleJitter.families.scaleJitter = 0.51;
  assert.throws(
    () => createTerrainMaterialBakeConfig(invalidScaleJitter),
    /families\.scaleJitter must not exceed 0\.5/,
  );

  const invalidSlope = sourceConfig();
  invalidSlope.families.projection.slopeFull = invalidSlope.families.projection.slopeStart;
  assert.throws(
    () => createTerrainMaterialBakeConfig(invalidSlope),
    /families\.projection\.slopeFull must exceed non-negative slopeStart/,
  );

  const invalidMicroFade = sourceConfig();
  invalidMicroFade.families.microFadeEndDistance = invalidMicroFade.families.microFadeStartDistance;
  assert.throws(
    () => createTerrainMaterialBakeConfig(invalidMicroFade),
    /families\.microFadeEndDistance must exceed microFadeStartDistance/,
  );

  const invalidFeatureFade = sourceConfig();
  invalidFeatureFade.families.features.fadeEndDistance = invalidFeatureFade.families.features.fadeStartDistance;
  assert.throws(
    () => createTerrainMaterialBakeConfig(invalidFeatureFade),
    /families\.features\.fadeEndDistance must exceed fadeStartDistance/,
  );

  const invalidWeatheringFade = sourceConfig();
  invalidWeatheringFade.families.weathering.fadeEndDistance = invalidWeatheringFade.families.weathering.fadeStartDistance;
  assert.throws(
    () => createTerrainMaterialBakeConfig(invalidWeatheringFade),
    /families\.weathering\.fadeEndDistance must exceed fadeStartDistance/,
  );

  const invalidFeatureColor = sourceConfig();
  invalidFeatureColor.families.features.lichenColor = 'green';
  assert.throws(
    () => createTerrainMaterialBakeConfig(invalidFeatureColor),
    /families\.features\.lichenColor must be a six-digit hex color/,
  );

  const invalidFallbackRoughness = sourceConfig();
  invalidFallbackRoughness.render.fallbackRoughness = 1.1;
  assert.throws(
    () => createTerrainMaterialBakeConfig(invalidFallbackRoughness),
    /render\.fallbackRoughness must be within \[0, 1\]/,
  );

  const zeroDirection = sourceConfig();
  zeroDirection.families.profiles.rock.direction = [0, 0];
  assert.throws(
    () => createTerrainMaterialBakeConfig(zeroDirection),
    /families\.profiles\.rock\.direction must not be a zero vector/,
  );
});

test('terrain material family pixels are deterministic, diverse and compact', () => {
  const config = validatedConfig();
  const first = generateTerrainMaterialFamilyPixels(config);
  const second = generateTerrainMaterialFamilyPixels(config);
  const expectedDepth = TERRAIN_MATERIAL_FAMILIES.length * config.families.variantsPerFamily;
  assert.equal(first.depth, expectedDepth);
  assert.equal(first.pixels.byteLength, 64 * 64 * expectedDepth * 4);
  assert.deepEqual(first.pixels, second.pixels);
  assert.notDeepEqual(layerBytes(first, 0), layerBytes(first, 1));
  assert.notDeepEqual(layerBytes(first, 0), layerBytes(first, 8));

  const changedSource = sourceConfig();
  changedSource.families.seed += 1;
  const changed = generateTerrainMaterialFamilyPixels(
    createTerrainMaterialBakeConfig(changedSource),
  );
  assert.notDeepEqual(first.pixels, changed.pixels);
});

test('terrain material family atlas is shared, mip-filtered and reference counted', () => {
  const config = validatedConfig();
  const baseline = getTerrainMaterialFamilyAtlasEntryCount();
  const first = acquireTerrainMaterialFamilyAtlas(config);
  const second = acquireTerrainMaterialFamilyAtlas(config);
  assert.equal(getTerrainMaterialFamilyAtlasEntryCount(), baseline + 1);
  assert.strictEqual(first.texture, second.texture);
  assert.equal(first.texture.isDataArrayTexture, true);
  assert.equal(first.texture.image.depth, 16);
  assert.equal(first.texture.minFilter, THREE.LinearMipmapLinearFilter);
  assert.equal(first.texture.generateMipmaps, true);

  let disposals = 0;
  first.texture.addEventListener('dispose', () => {
    disposals += 1;
  });
  first.release();
  first.release();
  assert.equal(getTerrainMaterialFamilyAtlasEntryCount(), baseline + 1);
  assert.equal(disposals, 0);
  second.release();
  assert.equal(getTerrainMaterialFamilyAtlasEntryCount(), baseline);
  assert.equal(disposals, 1);
});
