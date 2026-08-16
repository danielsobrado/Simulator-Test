export * from './SceneSettingsRuntimeBase.js';
import {
  SceneSettingsRuntime as SceneSettingsRuntimeBase,
  SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY,
} from './SceneSettingsRuntimeBase.js';

async function cleanupConsumedHandoff(runtime, pendingWorldKey) {
  try {
    await runtime.deleteBrowserDocument(pendingWorldKey);
  } catch (error) {
    console.warn(`Unable to clean staged scene-settings world "${pendingWorldKey}".`, error);
  }
  try {
    runtime.session?.removeItem(SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY);
  } catch (error) {
    console.warn(
      `Unable to clean staged scene-settings session key "${SCENE_SETTINGS_RELOAD_WORLD_SESSION_KEY}".`,
      error,
    );
  }
  runtime.pendingWorldKey = null;
}

async function invokeAfterMapLoad(callback, worldDocument) {
  if (typeof callback !== 'function') return;
  try {
    await callback(worldDocument);
  } catch (error) {
    console.error('Scene settings after-map-load callback failed.', error);
  }
}

export class SceneSettingsRuntime extends SceneSettingsRuntimeBase {
  async applyInitialRuntime() {
    if (!this.pendingWorldKey) {
      return super.applyInitialRuntime();
    }

    this.applyVisualSettings(this.document);
    const pendingWorldKey = this.pendingWorldKey;
    const worldDocument = await this.loadBrowserDocument(pendingWorldKey);

    try {
      if (!worldDocument) {
        throw new Error('The pending world reload document has expired.');
      }
      this.controller.loadDocument(worldDocument, { loadReason: 'SAVE_RESTORED' });
      this.mapSource = this.document.map;
      await invokeAfterMapLoad(this.afterMapLoad, worldDocument);
    } finally {
      await cleanupConsumedHandoff(this, pendingWorldKey);
    }
  }

  async addLocalAsset(options) {
    if (!(options?.file instanceof Blob)) {
      throw new Error('Choose a local GLB first.');
    }
    return super.addLocalAsset(options);
  }
}
