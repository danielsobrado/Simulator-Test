import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AUTOMATIC_BIOME_ASSET,
  BiomeAssetPalette,
  registerPrototypeIndices,
} from '../src/editor/stylized/BiomeAssetPalette.js';

function stylizedConfig() {
  return {
    assets: {
      scene: '/assets/trees/pines.glb',
      rockVariants: [
        { scene: '/assets/rocks/rock-01.glb' },
        { scene: '/assets/rocks/rock-02.glb' },
      ],
      bushVariants: [{ scene: '/assets/bushes/bush-01.glb' }],
      treeVariants: [{ scene: '/assets/trees/oak.glb' }],
      groundDetailVariants: [{ scene: '/assets/ground/clump.glb' }],
      aquaticVariants: [{ scene: '/assets/water/lotus.glb' }],
    },
    rocks: { tileIds: [3, 4] },
    bushes: { tileIds: [3] },
    trees: { tileIds: [3, 4] },
    groundDetails: { tileIds: [3, 4] },
    aquaticPlants: { tileIds: [0, 12] },
  };
}

test('biome asset palettes default to the deterministic automatic mix', () => {
  const palette = new BiomeAssetPalette({ stylizedConfig: stylizedConfig() });
  assert.equal(palette.getSelection(3, 'rocks'), AUTOMATIC_BIOME_ASSET);
  assert.deepEqual(palette.toDocument().biomes, {});
  assert.deepEqual(
    palette.getLayer('rocks').options.map(({ label }) => label),
    ['Rock 1 — Rock 01', 'Rock 2 — Rock 02'],
  );
  assert.equal(palette.getLayer('trees').options[0].label, 'Tree 1 — Pine collection');
});

test('explicit biome choices serialize, restore, and resolve registered prototypes', () => {
  const palette = new BiomeAssetPalette({ stylizedConfig: stylizedConfig() });
  let notifications = 0;
  palette.subscribe(() => { notifications += 1; });
  assert.equal(
    palette.setSelection(3, 'rocks', '/assets/rocks/rock-02.glb'),
    true,
  );
  assert.equal(palette.revision, 1);
  assert.equal(notifications, 2);

  const indices = new Map();
  registerPrototypeIndices(indices, '/assets/rocks/rock-01.glb', 0, 1);
  registerPrototypeIndices(indices, '/assets/rocks/rock-02.glb', 1, 2);
  assert.equal(palette.resolvePrototypeIndex({
    tileId: 3,
    layerId: 'rocks',
    automaticIndex: 0,
    prototypeIndicesByAsset: indices,
    roll: 0.75,
  }), 2);

  const restored = new BiomeAssetPalette({
    stylizedConfig: stylizedConfig(),
    document: palette.toDocument(),
  });
  assert.equal(
    restored.getSelection(3, 'rocks'),
    '/assets/rocks/rock-02.glb',
  );
});

test('biome asset imports reject unknown assets and biome-ineligible layers', () => {
  const palette = new BiomeAssetPalette({ stylizedConfig: stylizedConfig() });
  assert.throws(() => palette.replaceDocument({
    kind: 'simcity-dnd-biome-assets',
    version: 1,
    biomes: { 3: { rocks: '/assets/rocks/missing.glb' } },
  }), /Unknown rocks asset/);
  assert.throws(() => palette.setSelection(
    0,
    'rocks',
    '/assets/rocks/rock-01.glb',
  ), /not enabled/);
  assert.throws(() => palette.replaceDocument({
    kind: 'simcity-dnd-biome-assets',
    version: 1,
    biomes: { 3: { aquaticPlants: '/assets/water/lotus.glb' } },
  }), /not enabled for biome/);
});

test('reset removes only explicit choices and advances the render revision', () => {
  const palette = new BiomeAssetPalette({ stylizedConfig: stylizedConfig() });
  palette.setSelection(3, 'bushes', '/assets/bushes/bush-01.glb');
  assert.equal(palette.reset(), true);
  assert.deepEqual(palette.toDocument().biomes, {});
  assert.equal(palette.revision, 2);
  assert.equal(palette.reset(), false);
});
