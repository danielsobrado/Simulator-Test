import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySceneAssetSettings,
  createSceneSettingsDocument,
  LOCAL_ASSET_SCHEME,
} from '../src/editor/settings/SceneSettings.js';

function config() {
  return {
    stylizedSurface: {
      assets: {
        rockVariants: [],
        bushVariants: [],
        treeVariants: [],
        groundDetailVariants: [],
        aquaticVariants: [],
      },
      regionalPlacement: {},
    },
  };
}

test('missing browser-local GLBs do not block world restoration', async () => {
  const target = config();
  const warnings = [];
  const settings = createSceneSettingsDocument({
    name: 'Portable world',
    assets: [{
      id: 'missing-oak',
      layer: 'trees',
      url: `${LOCAL_ASSET_SCHEME}missing-oak`,
      label: 'Missing oak',
    }],
  });

  await applySceneAssetSettings(target, settings, {
    baseUrl: 'https://example.test/world.json',
    resolveLocalAsset: async () => {
      throw new Error('IndexedDB entry missing');
    },
    warn: (...args) => warnings.push(args),
  });

  assert.equal(target.stylizedSurface.assets.treeVariants.length, 1);
  assert.match(target.stylizedSurface.assets.treeVariants[0].scene, /^data:model\/gltf-binary/);
  assert.equal(target.stylizedSurface.assets.treeVariants[0].id, 'missing-oak');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0][0], /world will load without it/);
});
