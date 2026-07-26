import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySceneAssetSettings,
  createSceneSettingsDocument,
  isLoadableMap,
  LOCAL_ASSET_SCHEME,
  normalizeSceneSettings,
  resolveSettingsReference,
  toMapReference,
} from '../src/editor/settings/SceneSettings.js';
import { SceneSettingsRuntime } from '../src/editor/settings/SceneSettingsRuntime.js';

function config() {
  return {
    stylizedSurface: {
      assets: {
        rockVariants: [{ scene: '/assets/rocks/base.glb', scale: 1 }],
        bushVariants: [],
        treeVariants: [],
        groundDetailVariants: [],
        aquaticVariants: [],
      },
      regionalPlacement: { enabled: true, regionSize: 420 },
    },
  };
}

test('scene settings capture map, environment, biome, asset, and placement state', () => {
  const document = createSceneSettingsDocument({
    name: 'Eldara look',
    map: { kind: 'url', url: '../maps/eldara.json', label: 'Eldara' },
    godRays: { enabled: true, screenIntensity: 1.4 },
    biomeAssets: {
      kind: 'simcity-dnd-biome-assets',
      version: 1,
      biomes: { 3: { rocks: 'granite' } },
    },
    assets: [{
      id: 'granite',
      layer: 'rocks',
      url: '../glb/granite.glb',
      label: 'Granite',
      scale: 0.25,
      tileIds: [3, 4],
    }],
    placement: { regionSize: 512, contrast: 2.8 },
  });
  assert.equal(document.name, 'Eldara look');
  assert.equal(document.map.url, '../maps/eldara.json');
  assert.equal(document.environment.godRays.screenIntensity, 1.4);
  assert.equal(document.assets[0].id, 'granite');
  assert.deepEqual(document.assets[0].tileIds, [3, 4]);
  assert.equal(document.placement.regionSize, 512);
});

test('scene settings reject unsupported asset layers and map kinds', () => {
  const base = createSceneSettingsDocument({ name: 'Safe' });
  assert.throws(
    () => normalizeSceneSettings({
      ...base,
      assets: [{ id: 'bad', layer: 'sky', url: '/bad.glb' }],
    }),
    /unsupported layer/,
  );
  assert.throws(
    () => normalizeSceneSettings({ ...base, map: { kind: 'disk', url: '/map.json' } }),
    /map kind/,
  );
});

test('asset settings resolve URL and browser-local GLBs into runtime variants', async () => {
  const target = config();
  const settings = createSceneSettingsDocument({
    name: 'Custom rocks',
    assets: [
      {
        id: 'remote-rock',
        layer: 'rocks',
        url: '../assets/remote.glb',
        label: 'Remote',
        scale: 2,
      },
      {
        id: 'local-rock',
        layer: 'rocks',
        url: `${LOCAL_ASSET_SCHEME}rock-cache-key`,
        label: 'Local',
        scale: 0.5,
      },
    ],
  });
  await applySceneAssetSettings(target, settings, {
    baseUrl: 'https://example.test/settings/look.json',
    resolveLocalAsset: async (id) => `blob:${id}`,
  });
  assert.equal(
    target.stylizedSurface.assets.rockVariants[1].scene,
    'https://example.test/assets/remote.glb',
  );
  assert.equal(target.stylizedSurface.assets.rockVariants[2].scene, 'blob:rock-cache-key');
  assert.equal(target.stylizedSurface.assets.rockVariants[2].id, 'local-rock');
});

test('embedded maps may record only a label, and references drop the source', () => {
  const inlined = createSceneSettingsDocument({
    name: 'Imported',
    map: { kind: 'embedded', document: { info: { version: '1.99' } }, label: 'eldara.json' },
  });
  assert.equal(inlined.map.document.info.version, '1.99');
  assert.ok(isLoadableMap(inlined.map));

  const reference = toMapReference(inlined.map);
  assert.equal(reference.document, undefined);
  assert.equal(reference.label, 'eldara.json');
  assert.equal(isLoadableMap(reference), false);

  const roundTripped = normalizeSceneSettings({ ...inlined, map: reference });
  assert.equal(roundTripped.map.kind, 'embedded');
  assert.equal(roundTripped.map.document, undefined);
  assert.equal(roundTripped.map.label, 'eldara.json');
});

test('runtime captures keep inlined map exports out of routine saves', () => {
  const mapDocument = { info: { version: '1.99' }, cells: { i: [0, 1, 2] } };
  const runtime = new SceneSettingsRuntime({
    controller: { loadDocument() {} },
    biomeAssetPalette: {
      toDocument: () => ({ kind: 'simcity-dnd-biome-assets', version: 1, biomes: {} }),
      replaceDocument() {},
    },
    godRays: null,
    config: { stylizedSurface: { regionalPlacement: {} } },
  });
  runtime.mapSource = { kind: 'embedded', document: mapDocument, label: 'eldara.json' };

  const saved = runtime.capture('World save');
  assert.equal(saved.map.document, undefined, 'world saves must not duplicate the map export');
  assert.equal(saved.map.label, 'eldara.json');

  const exported = runtime.capture('Portable', { includeMapDocument: true });
  assert.deepEqual(exported.map.document, mapDocument);
});

test('settings references preserve absolute URLs and resolve relative paths', () => {
  assert.equal(
    resolveSettingsReference('/maps/world.json', 'https://example.test/settings/a.json'),
    'https://example.test/maps/world.json',
  );
  assert.equal(
    resolveSettingsReference('https://cdn.test/rock.glb', 'https://example.test/'),
    'https://cdn.test/rock.glb',
  );
  assert.equal(
    resolveSettingsReference(`${LOCAL_ASSET_SCHEME}rock-1`, 'https://example.test/'),
    `${LOCAL_ASSET_SCHEME}rock-1`,
  );
});

test('settings references refuse schemes nothing can be fetched over', () => {
  assert.throws(
    () => resolveSettingsReference('javascript:alert(1)', 'https://example.test/'),
    /"javascript:" scheme/,
  );
  assert.throws(
    () => resolveSettingsReference('file:///etc/passwd', 'https://example.test/'),
    /"file:" scheme/,
  );
});

test('absent optional numbers stay absent whether written as null or omitted', () => {
  const base = createSceneSettingsDocument({ name: 'Nulls' });
  const document = normalizeSceneSettings({
    ...base,
    assets: [{
      id: 'rock',
      layer: 'rocks',
      url: '/rock.glb',
      scale: null,
      barkSeed: null,
      heightOffset: null,
    }],
  });
  assert.equal(document.assets[0].scale, 1, 'null must fall back, not coerce to 0');
  assert.equal('barkSeed' in document.assets[0], false);
  assert.equal('heightOffset' in document.assets[0], false);
});

test('placement values outside the regional field range are refused, not clamped', () => {
  const base = createSceneSettingsDocument({ name: 'Placement' });
  assert.throws(
    () => normalizeSceneSettings({ ...base, placement: { regionSize: 4 } }),
    /placement regionSize/,
  );
  assert.throws(
    () => normalizeSceneSettings({ ...base, placement: { minimumInfluence: 1.5 } }),
    /placement minimumInfluence/,
  );
  assert.throws(
    () => normalizeSceneSettings({ ...base, placement: { enabled: 'yes' } }),
    /placement enabled/,
  );
});

test('biome asset envelopes are rejected where they enter, not deep in the palette', () => {
  const base = createSceneSettingsDocument({ name: 'Biomes' });
  assert.throws(
    () => normalizeSceneSettings({ ...base, biomeAssets: { biomes: {} } }),
    /version/,
  );
  assert.throws(
    () => normalizeSceneSettings({
      ...base,
      biomeAssets: { kind: 'something-else', version: 1, biomes: {} },
    }),
    /biome asset configuration/,
  );
});

function runtimeWithLook(initialGodRays, loadedDocument) {
  const state = { godRays: { ...initialGodRays }, runtime: null };
  state.runtime = new SceneSettingsRuntime({
    controller: {
      loadDocument(document) {
        // Mirrors TerrainAwareEditorController: a document that carries its own
        // look hands it to the scene settings consumer during the load.
        if (document.visualConfig?.sceneSettings) {
          state.runtime.applyVisualSettings(document.visualConfig.sceneSettings);
        }
      },
    },
    biomeAssetPalette: {
      toDocument: () => ({ kind: 'simcity-dnd-biome-assets', version: 1, biomes: {} }),
      replaceDocument() {},
    },
    godRays: {
      getSettings: () => ({ ...state.godRays }),
      setSettings: (patch) => { state.godRays = { ...patch }; },
    },
    config: { stylizedSurface: { regionalPlacement: {} } },
  });
  return { state, load: () => state.runtime.loadEmbeddedMap(loadedDocument, 'save.json') };
}

test('importing a world save keeps the look stored in the document', async () => {
  const { state, load } = runtimeWithLook({ screenIntensity: 1 }, {
    world: {},
    visualConfig: {
      biomeAssets: { kind: 'simcity-dnd-biome-assets', version: 1, biomes: {} },
      sceneSettings: createSceneSettingsDocument({
        name: 'Saved look',
        godRays: { screenIntensity: 2.5 },
      }),
    },
  });
  await load();
  assert.equal(state.godRays.screenIntensity, 2.5);
  assert.equal(state.runtime.capture().environment.godRays.screenIntensity, 2.5);
});

test('importing a bare map keeps the look that was live before the import', async () => {
  const { state, load } = runtimeWithLook({ screenIntensity: 1.4 }, { world: {} });
  await load();
  assert.equal(state.godRays.screenIntensity, 1.4);
  assert.equal(state.runtime.mapSource.label, 'save.json');
});
