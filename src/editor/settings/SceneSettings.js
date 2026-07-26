export * from './SceneSettingsBase.js';
import {
  applySceneAssetSettings as applySceneAssetSettingsBase,
  LOCAL_ASSET_SCHEME,
} from './SceneSettingsBase.js';

const UNAVAILABLE_LOCAL_ASSET_URL = 'data:model/gltf-binary;base64,AA==';

export async function applySceneAssetSettings(config, settings, {
  resolveLocalAsset = null,
  warn = console.warn,
  ...options
} = {}) {
  const resilientLocalResolver = async (assetId) => {
    try {
      if (!resolveLocalAsset) {
        throw new Error(`Local GLB "${LOCAL_ASSET_SCHEME}${assetId}" is not available in this browser.`);
      }
      return await resolveLocalAsset(assetId);
    } catch (error) {
      warn(`Local GLB "${assetId}" is unavailable; the world will load without it.`, error);
      return `${UNAVAILABLE_LOCAL_ASSET_URL}#${encodeURIComponent(assetId)}`;
    }
  };
  return applySceneAssetSettingsBase(config, settings, {
    ...options,
    resolveLocalAsset: resilientLocalResolver,
  });
}
