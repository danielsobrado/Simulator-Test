import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneSettingsDocument } from '../src/editor/settings/SceneSettings.js';
import {
  activateSceneSettings,
  loadBootSceneSettings,
  SCENE_SETTINGS_RELOAD_WORLD_KEY,
  SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY,
  SceneSettingsRuntime,
} from '../src/editor/settings/SceneSettingsRuntime.js';

function createSession() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

function createPalette() {
  const empty = { kind: 'simcity-dnd-biome-assets', version: 1, biomes: {} };
  return {
    toDocument: () => structuredClone(empty),
    replaceDocument() {},
  };
}

function createConfig() {
  return { stylizedSurface: { regionalPlacement: {} } };
}

function customSettings() {
  return createSceneSettingsDocument({
    name: 'Custom world',
    assets: [{
      id: 'custom-oak',
      layer: 'trees',
      url: 'https://assets.test/oak.glb',
      label: 'Custom oak',
    }],
  });
}

test('scene settings activation stages the complete world before reloading', async () => {
  const session = createSession();
  const assigned = [];
  const stored = new Map();
  const locationValue = {
    href: 'https://example.test/editor?quality=high',
    search: '?quality=high',
    assign: (value) => assigned.push(value),
  };
  const originalWorld = {
    world: { seed: 42 },
    visualConfig: { sceneSettings: createSceneSettingsDocument({ name: 'Old' }) },
  };
  const settings = customSettings();

  await activateSceneSettings(settings, {
    locationValue,
    session,
    worldDocument: originalWorld,
    saveBrowserDocument: async (key, document) => stored.set(key, document),
  });

  const staged = stored.get(SCENE_SETTINGS_RELOAD_WORLD_KEY);
  assert.equal(staged.world.seed, 42);
  assert.equal(staged.visualConfig.sceneSettings.assets[0].id, 'custom-oak');
  assert.equal(originalWorld.visualConfig.sceneSettings.assets.length, 0);
  assert.equal(
    session.getItem(SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY),
    SCENE_SETTINGS_RELOAD_WORLD_KEY,
  );
  assert.match(assigned[0], /settings=session/);
});

test('boot settings expose the pending world handoff key', async () => {
  const session = createSession();
  const settings = customSettings();
  session.setItem('simcity-dnd:pending-scene-settings', JSON.stringify(settings));
  session.setItem(SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY, SCENE_SETTINGS_RELOAD_WORLD_KEY);

  const boot = await loadBootSceneSettings({
    locationValue: {
      href: 'https://example.test/editor?settings=session',
      search: '?settings=session',
    },
    session,
  });

  assert.equal(boot.pendingWorldKey, SCENE_SETTINGS_RELOAD_WORLD_KEY);
  assert.equal(boot.document.assets[0].id, 'custom-oak');
});

test('initial runtime restores a staged world without replaying a label-only map', async () => {
  const settings = createSceneSettingsDocument({
    ...customSettings(),
    map: { kind: 'embedded', label: 'eldara.json' },
  });
  const stagedWorld = { world: { seed: 84 }, visualConfig: { sceneSettings: settings } };
  const loaded = [];
  const session = createSession();
  session.setItem(SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY, SCENE_SETTINGS_RELOAD_WORLD_KEY);
  const runtime = new SceneSettingsRuntime({
    controller: { loadDocument: (document) => loaded.push(document) },
    biomeAssetPalette: createPalette(),
    godRays: null,
    config: createConfig(),
    boot: {
      document: settings,
      sourceUrl: 'https://example.test/editor?settings=session',
      pendingWorldKey: SCENE_SETTINGS_RELOAD_WORLD_KEY,
    },
    loadBrowserDocument: async () => stagedWorld,
    session,
  });

  await runtime.applyInitialRuntime();

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].world.seed, 84);
  assert.equal(session.getItem(SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY), null);
});

test('world saves with custom assets reload before the controller consumes them', async () => {
  let controllerLoads = 0;
  let activation = null;
  const runtime = new SceneSettingsRuntime({
    controller: { loadDocument: () => { controllerLoads += 1; } },
    biomeAssetPalette: createPalette(),
    godRays: null,
    config: createConfig(),
  });
  runtime.activate = async (settings, options) => {
    activation = { settings, options };
  };
  const worldDocument = {
    world: { seed: 126 },
    visualConfig: { sceneSettings: customSettings() },
  };

  await runtime.loadEmbeddedMap(worldDocument, 'save.json');

  assert.equal(controllerLoads, 0);
  assert.equal(activation.settings.assets[0].id, 'custom-oak');
  assert.equal(activation.options.worldDocument.world.seed, 126);
});
