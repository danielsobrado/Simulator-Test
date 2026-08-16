import assert from 'node:assert/strict';
import test from 'node:test';

import { createSceneSettingsDocument } from '../src/editor/settings/SceneSettings.js';
import {
  SceneSettingsRuntime,
  SCENE_SETTINGS_RELOAD_WORLD_KEY,
  SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY,
} from '../src/editor/settings/SceneSettingsRuntime.js';

function createRuntime({ loadDocument, loadBrowserDocument, deleted, removed }) {
  const document = createSceneSettingsDocument({ name: 'Failure test' });
  return new SceneSettingsRuntime({
    controller: { loadDocument },
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
    loadBrowserDocument,
    deleteBrowserDocument: async (key) => deleted.push(key),
    session: { removeItem: (key) => removed.push(key) },
  });
}

test('failed staged world load consumes the one-shot handoff', async () => {
  const deleted = [];
  const removed = [];
  const runtime = createRuntime({
    loadDocument() { throw new Error('invalid world'); },
    loadBrowserDocument: async () => ({ version: 6, visualConfig: {} }),
    deleted,
    removed,
  });

  await assert.rejects(runtime.applyInitialRuntime(), /invalid world/);

  assert.deepEqual(deleted, [SCENE_SETTINGS_RELOAD_WORLD_KEY]);
  assert.deepEqual(removed, [SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY]);
  assert.equal(runtime.pendingWorldKey, null);
});

test('expired staged world clears the stale handoff marker', async () => {
  const deleted = [];
  const removed = [];
  const runtime = createRuntime({
    loadDocument() {},
    loadBrowserDocument: async () => null,
    deleted,
    removed,
  });

  await assert.rejects(runtime.applyInitialRuntime(), /pending world reload document has expired/);

  assert.deepEqual(deleted, [SCENE_SETTINGS_RELOAD_WORLD_KEY]);
  assert.deepEqual(removed, [SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY]);
  assert.equal(runtime.pendingWorldKey, null);
});

test('transient staged world storage failure remains retryable', async () => {
  const deleted = [];
  const removed = [];
  const runtime = createRuntime({
    loadDocument() {},
    loadBrowserDocument: async () => { throw new Error('storage unavailable'); },
    deleted,
    removed,
  });

  await assert.rejects(runtime.applyInitialRuntime(), /storage unavailable/);

  assert.deepEqual(deleted, []);
  assert.deepEqual(removed, []);
  assert.equal(runtime.pendingWorldKey, SCENE_SETTINGS_RELOAD_WORLD_KEY);
});
