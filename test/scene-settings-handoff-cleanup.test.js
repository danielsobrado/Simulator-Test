import assert from 'node:assert/strict';
import test from 'node:test';

import { createSceneSettingsDocument } from '../src/editor/settings/SceneSettings.js';
import {
  activateSceneSettings,
  SceneSettingsRuntime,
  SCENE_SETTINGS_RELOAD_WORLD_KEY,
  SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY,
} from '../src/editor/settings/SceneSettingsRuntimeBase.js';

function settingsDocument() {
  return createSceneSettingsDocument({ name: 'Test look' });
}

test('failed session staging removes the temporary world document', async () => {
  const saved = [];
  const deleted = [];
  const session = {
    setItem() { throw new Error('quota exceeded'); },
    removeItem() {},
  };
  const locationValue = {
    href: 'https://example.test/editor',
    assign() {},
  };

  await assert.rejects(
    activateSceneSettings(settingsDocument(), {
      locationValue,
      session,
      worldDocument: { version: 6, visualConfig: {} },
      saveBrowserDocument: async (key) => saved.push(key),
      deleteBrowserDocument: async (key) => deleted.push(key),
    }),
    /Unable to stage these settings for reload/,
  );

  assert.deepEqual(saved, [SCENE_SETTINGS_RELOAD_WORLD_KEY]);
  assert.deepEqual(deleted, [SCENE_SETTINGS_RELOAD_WORLD_KEY]);
});

test('restored scene-settings world is deleted after successful handoff', async () => {
  const deleted = [];
  const removedSessionKeys = [];
  const loaded = [];
  const document = settingsDocument();
  const worldDocument = { version: 6, visualConfig: {} };
  const runtime = new SceneSettingsRuntime({
    controller: {
      loadDocument: (world, options) => loaded.push({ world, options }),
    },
    biomeAssetPalette: {
      toDocument: () => document.biomeAssets,
      replaceDocument() {},
    },
    godRays: { setSettings() {}, getSettings: () => ({}) },
    config: {
      stylizedSurface: {
        postProcessing: {},
        regionalPlacement: {},
      },
    },
    boot: {
      document,
      sourceUrl: 'https://example.test/look.json',
      pendingWorldKey: SCENE_SETTINGS_RELOAD_WORLD_KEY,
    },
    loadBrowserDocument: async () => worldDocument,
    deleteBrowserDocument: async (key) => deleted.push(key),
    session: { removeItem: (key) => removedSessionKeys.push(key) },
    afterMapLoad: () => { throw new Error('optional UI refresh failed'); },
  });

  const originalError = console.error;
  console.error = () => {};
  try {
    await runtime.applyInitialRuntime();
  } finally {
    console.error = originalError;
  }

  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].world, worldDocument);
  assert.equal(loaded[0].options.loadReason, 'SAVE_RESTORED');
  assert.deepEqual(deleted, [SCENE_SETTINGS_RELOAD_WORLD_KEY]);
  assert.deepEqual(removedSessionKeys, [SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY]);
  assert.equal(runtime.pendingWorldKey, null);
});
