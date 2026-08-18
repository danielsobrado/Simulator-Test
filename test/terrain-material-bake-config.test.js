import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import {
  createTerrainMaterialBakeConfig,
  estimateTerrainMaterialBakeBytes,
} from '../src/editor/materials/TerrainMaterialBakeConfig.js';
import { TERRAIN_MATERIAL_BAKE_CHANNELS } from '../src/editor/materials/TerrainMaterialBakeConstants.js';

function loadSourceConfig() {
  const source = fs.readFileSync(
    new URL('../config/terrain-material-bake.yaml', import.meta.url),
    'utf8',
  );
  return yaml.load(source);
}

test('terrain material bake config defines channels, quality and bounded build settings', () => {
  const config = createTerrainMaterialBakeConfig(loadSourceConfig());

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.quality, 'balanced');
  assert.deepEqual(Object.keys(config.channels), TERRAIN_MATERIAL_BAKE_CHANNELS);
  assert.deepEqual(
    Object.values(config.qualityTiers).map((tier) => tier.resolution),
    [32, 64, 128],
  );
  assert.equal(config.build.rowsPerYield, 16);
  assert.equal(config.build.maxConcurrent, 2);
  assert.equal(config.classification.wetnessRadiusCells <= config.classification.shorelineRadiusCells, true);
  assert.equal(estimateTerrainMaterialBakeBytes(config), 64 * 64 * 22);
  assert.equal(estimateTerrainMaterialBakeBytes(config, 'high'), 128 * 128 * 22);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.channels), true);
  assert.equal(Object.isFrozen(config.build), true);
});

test('terrain material bake config rejects unsafe fallback and non-power-of-two pages', () => {
  const unsafeFallback = loadSourceConfig();
  unsafeFallback.fallback.allowProcedural = false;
  unsafeFallback.fallback.allowStale = false;
  assert.throws(
    () => createTerrainMaterialBakeConfig(unsafeFallback),
    /fallback must allow stale or procedural rendering/,
  );

  const invalidResolution = loadSourceConfig();
  invalidResolution.qualityTiers.balanced.resolution = 96;
  assert.throws(
    () => createTerrainMaterialBakeConfig(invalidResolution),
    /qualityTiers\.balanced\.resolution must be a power of two/,
  );
});

test('terrain material bake config rejects runaway scheduling and invalid classification ranges', () => {
  const tooConcurrent = loadSourceConfig();
  tooConcurrent.build.maxConcurrent = 17;
  assert.throws(
    () => createTerrainMaterialBakeConfig(tooConcurrent),
    /build\.maxConcurrent must not exceed 16/,
  );

  const invalidWetness = loadSourceConfig();
  invalidWetness.classification.wetnessRadiusCells = 5;
  invalidWetness.classification.shorelineRadiusCells = 4;
  assert.throws(
    () => createTerrainMaterialBakeConfig(invalidWetness),
    /classification\.wetnessRadiusCells must not exceed shorelineRadiusCells/,
  );
});

test('editor config loader installs the validated terrain material bake config', () => {
  const source = fs.readFileSync(
    new URL('../src/config/loadEditorConfig.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /terrain-material-bake\.yaml\?raw/);
  assert.match(source, /config\.stylizedSurface\.materialBake = createTerrainMaterialBakeConfig/);
});
