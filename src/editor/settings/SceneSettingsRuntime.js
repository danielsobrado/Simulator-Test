export * from './SceneSettingsRuntimeBase.js';
import { SceneSettingsRuntime as SceneSettingsRuntimeBase } from './SceneSettingsRuntimeBase.js';

export class SceneSettingsRuntime extends SceneSettingsRuntimeBase {
  async addLocalAsset(options) {
    if (!(options?.file instanceof Blob)) {
      throw new Error('Choose a local GLB first.');
    }
    return super.addLocalAsset(options);
  }
}
