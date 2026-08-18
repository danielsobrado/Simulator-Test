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

test('terrain material bake config defines every required channel and quality tier', () => {
  const config = createTerrainMaterialBakeConfig(loadSourceConfig());

  assert.equal(config.schemaVersion, 1);
  assert.equal(config.quality, 'balanced');
  assert.deepEqual(Object.keys(config.channels), TERRAIN_MATERIAL_BAKE_CHANNELS);
  assert.deepEqual(
    Object.values(config.qualityTiers).map((tier) => tier.resolution),
    [32, 64, 128],
  );
  assert.equal(estimateTerrainMaterialBakeBytes(config), 64 * 64 * 22);
  assert.equal(estimateTerrainMaterialBakeBytes(config, 'high'), 128 * 128 * 22);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.channels), true);
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

test('editor config loader installs the validated terrain material bake config', () => {
  const source = fs.readFileSync(
    new URL('../src/config/loadEditorConfig.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /terrain-material-bake\.yaml\?raw/);
  assert.match(source, /config\.stylizedSurface\.materialBake = createTerrainMaterialBakeConfig/);
});
