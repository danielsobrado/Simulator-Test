import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import { validateEditorConfig } from '../src/config/validateEditorConfig.js';

function createValidConfig() {
  return {
    map: {
      tileSize: 2,
      chunkSize: 32,
    },
    import: {
      azgaarAtlasLongEdge: 2000,
      azgaarOceanTransitionKilometers: 50,
    },
    world: {
      seed: 918273,
      generatorVersion: 1,
      chunkSize: 64,
      loadRadius: 2,
      unloadRadius: 3,
      prefetchSeconds: 1.5,
      maxResidentChunks: 49,
      maxCpuChunks: 81,
      floatingOriginThreshold: 4096,
      minimapCells: 192,
      heightScale: 12,
      seaLevel: -1.5,
      maxCommitsPerFrame: 1,
      commitBudgetMs: 2,
    },
    camera: {
      viewSize: 180,
    },
    player: {
      fovDegrees: 68,
      walkSpeed: 9,
      runMultiplier: 1.8,
      jumpSpeed: 8,
      gravity: 24,
      eyeHeight: 1.7,
      stepHeight: 1.1,
      groundSnapDistance: 0.6,
      mouseSensitivity: 0.0022,
      maxPitchDegrees: 85,
    },
    renderer: {
      antialias: false,
      forceWebGL: false,
      maxPixelRatio: 2,
    },
    terrain: {
      minHeight: -16,
      maxHeight: 48,
      sculptStrength: 1.25,
      smoothFactor: 0.45,
    },
    brush: {
      sizes: [1, 3, 5],
      defaultSize: 3,
    },
  };
}

test('accepts positive nested map, world, camera, player, renderer, and terrain values', () => {
  const config = createValidConfig();
  assert.equal(validateEditorConfig(config), config);
});

function loadShippedConfig() {
  return yaml.load(readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8'));
}

test('the shipped config passes validation', () => {
  const config = loadShippedConfig();
  assert.equal(validateEditorConfig(config), config);
});

test('rejects a clump radius that would break the field into tufts', () => {
  // The clump is a batching unit the player must never resolve. Below roughly half
  // the clump spacing they stop overlapping and the carpet becomes pom-poms on
  // bare ground — a look regression nothing else in the suite would catch, so the
  // guard lives where the value is edited.
  const config = loadShippedConfig();
  config.stylizedSurface.grass.clumpRadius = 0.3;

  assert.throws(
    () => validateEditorConfig(config),
    /grass\.clumpRadius is too small/,
  );
});

test('narrowing blades no longer drags the clump footprint down with it', () => {
  // The radius used to be denominated in blade-widths, so this edit alone would
  // have shrunk every clump by more than half. It is in metres now and the guard
  // above confirms the field still forms a carpet.
  const config = loadShippedConfig();
  config.stylizedSurface.grass.minWidth = 0.008;
  config.stylizedSurface.grass.maxWidth = 0.012;

  assert.equal(validateEditorConfig(config), config);
});

test('requires the tip-flutter fade to span a range', () => {
  const config = loadShippedConfig();
  config.stylizedSurface.wind.flutter.fadeEnd = config.stylizedSurface.wind.flutter.fadeStart;

  assert.throws(
    () => validateEditorConfig(config),
    /flutter\.fadeEnd must exceed fadeStart/,
  );
});

test('starts with streamed voxel chunks hidden', () => {
  const config = yaml.load(readFileSync(
    new URL('../editor.config.yaml', import.meta.url),
    'utf8',
  ));

  assert.equal(config.voxelPrototype.visible, false);
});

test('reads import.azgaarAtlasLongEdge through nested object paths', () => {
  const config = createValidConfig();
  config.import.azgaarAtlasLongEdge = 0;

  assert.throws(
    () => validateEditorConfig(config),
    /import\.azgaarAtlasLongEdge must be positive/,
  );
});

test('requires unload radius to cover the load radius', () => {
  const config = createValidConfig();
  config.world.unloadRadius = 1;

  assert.throws(
    () => validateEditorConfig(config),
    /world\.unloadRadius must cover world\.loadRadius/,
  );
});

test('requires enough terrain slots for the unload radius', () => {
  const config = createValidConfig();
  config.world.maxResidentChunks = 48;

  assert.throws(
    () => validateEditorConfig(config),
    /world\.maxResidentChunks must be at least 49 for the unload window/,
  );
});

test('requires the CPU cache to cover resident GPU chunks', () => {
  const config = createValidConfig();
  config.world.maxCpuChunks = 48;

  assert.throws(
    () => validateEditorConfig(config),
    /world\.maxCpuChunks must cover resident GPU chunks/,
  );
});

test('rejects invalid renderer configuration', () => {
  const config = createValidConfig();
  config.renderer.forceWebGL = 'false';

  assert.throws(
    () => validateEditorConfig(config),
    /renderer\.forceWebGL must be boolean/,
  );
});

test('rejects invalid player field of view', () => {
  const config = createValidConfig();
  config.player.fovDegrees = 180;

  assert.throws(
    () => validateEditorConfig(config),
    /player\.fovDegrees must be below 180/,
  );
});

test('rejects invalid player pitch limits', () => {
  const config = createValidConfig();
  config.player.maxPitchDegrees = 90;

  assert.throws(
    () => validateEditorConfig(config),
    /player\.maxPitchDegrees must be within/,
  );
});

test('rejects non-positive player step heights', () => {
  const config = createValidConfig();
  config.player.stepHeight = 0;

  assert.throws(
    () => validateEditorConfig(config),
    /player\.stepHeight must be positive/,
  );
});

test('rejects invalid terrain limits', () => {
  const config = createValidConfig();
  config.terrain.maxHeight = config.terrain.minHeight;

  assert.throws(
    () => validateEditorConfig(config),
    /terrain\.maxHeight must exceed terrain\.minHeight/,
  );
});

test('rejects invalid terrain smoothing', () => {
  const config = createValidConfig();
  config.terrain.smoothFactor = 1.5;

  assert.throws(
    () => validateEditorConfig(config),
    /terrain\.smoothFactor must be within/,
  );
});

test('rejects a default brush size outside the configured sizes', () => {
  const config = createValidConfig();
  config.brush.defaultSize = 9;

  assert.throws(
    () => validateEditorConfig(config),
    /brush\.defaultSize must be listed/,
  );
});
