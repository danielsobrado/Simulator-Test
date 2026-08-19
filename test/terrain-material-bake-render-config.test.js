import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import { createTerrainMaterialBakeConfig } from '../src/editor/materials/TerrainMaterialBakeConfig.js';

function sourceConfig() {
  return yaml.load(fs.readFileSync(
    new URL('../config/terrain-material-bake.yaml', import.meta.url),
    'utf8',
  ));
}

test('terrain material bake render config defines non-overlapping near, mid and far bands', () => {
  const config = createTerrainMaterialBakeConfig(sourceConfig());
  assert.ok(config.render.nearDistance > 0);
  assert.ok(config.render.transitionDistance > 0);
  assert.ok(
    config.render.farDistance > config.render.nearDistance + config.render.transitionDistance,
  );
  assert.ok(config.render.staleProceduralBlend > 0);
  assert.ok(config.render.staleProceduralBlend < 1);
  assert.match(config.render.rockColor, /^#[0-9a-f]{6}$/i);
  assert.match(config.render.snowColor, /^#[0-9a-f]{6}$/i);
  assert.equal(Object.isFrozen(config.render), true);
});

test('terrain material bake render config rejects overlapping LOD bands and malformed colors', () => {
  const overlapping = sourceConfig();
  overlapping.render.farDistance = overlapping.render.nearDistance + 1;
  assert.throws(
    () => createTerrainMaterialBakeConfig(overlapping),
    /render\.farDistance must start after the near transition band/,
  );

  const badColor = sourceConfig();
  badColor.render.rockColor = 'gray';
  assert.throws(
    () => createTerrainMaterialBakeConfig(badColor),
    /render\.rockColor must be a six-digit hexadecimal color/,
  );
});

test('terrain material bake render config rejects stale fallback blend outside unit interval', () => {
  const invalid = sourceConfig();
  invalid.render.staleProceduralBlend = 1.1;
  assert.throws(
    () => createTerrainMaterialBakeConfig(invalid),
    /render\.staleProceduralBlend must be within \[0, 1\]/,
  );
});
