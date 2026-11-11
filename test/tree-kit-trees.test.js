import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import yaml from 'js-yaml';
import * as THREE from 'three/webgpu';
import { validateEditorConfig } from '../src/config/validateEditorConfig.js';
import { ForestSpeciesRegistry } from '../src/editor/stylized/forest/ForestSpeciesRegistry.js';
import {
  BARK_PROFILES,
  createProceduralBarkTextures,
  createScannedBarkTextures,
} from '../src/editor/stylized/forest/ProceduralBarkTextures.js';
import { barkTexturesForVariant, loadScannedBarkTextures } from '../src/editor/stylized/forest/ScannedBarkLibrary.js';
import { CALM_BEND, STORM_BEND, treeBendLimit } from '../src/editor/stylized/forest/treeSway.js';
import { createShippedTreeRegistry } from './helpers/shippedTreeRegistry.js';

const config = yaml.load(readFileSync(new URL('../editor.config.yaml', import.meta.url), 'utf8'));
const surface = config.stylizedSurface;

const PALETTE_BY_TILE = Object.freeze({
  3: 'savanna', 4: 'grassland', 5: 'tropical_seasonal_forest', 6: 'temperate_deciduous_forest',
  7: 'tropical_rainforest', 8: 'temperate_rainforest', 9: 'taiga', 10: 'tundra', 12: 'wetland',
});

test('every species of every forested biome still resolves to a shipped prototype', () => {
  const { registry, sceneOf } = createShippedTreeRegistry(surface);
  for (const [tile, profileKey] of Object.entries(PALETTE_BY_TILE)) {
    for (const speciesId of new Set(registry.palettes[profileKey])) {
      for (const ageClass of ['mature', 'dead']) {
        const prototypes = registry.prototypesFor(speciesId, Number(tile), ageClass);
        assert.ok(prototypes.length > 0, `${speciesId} has no prototype in ${profileKey}`);
        if (ageClass === 'mature') {
          assert.ok(!prototypes.some((index) => sceneOf(index)?.includes('snag-')
            && surface.assets.treeVariants.find((v) => v.scene === sceneOf(index)).ageClasses),
          `${speciesId} in ${profileKey} would draw a snag for a live tree`);
        }
      }
    }
  }
});

test('the biomes the trees plan touches draw their own trees', () => {
  const { registry, sceneOf } = createShippedTreeRegistry(surface);
  const scenes = (species, tile) => [...new Set(registry.prototypesFor(species, tile, 'mature').map(sceneOf))];
  assert.deepEqual(scenes('conifer_narrow', 9), ['/assets/trees/boreal/boreal-spruce.glb', '/assets/trees/boreal/boreal-pine.glb']);
  assert.deepEqual(scenes('conifer_wide', 8), ['/assets/trees/boreal/boreal-spruce.glb']);
  assert.deepEqual(scenes('tropical_tall', 7), ['/assets/trees/rainforest/rainforest.glb']);
  assert.deepEqual(scenes('tropical_tall', 5), ['/assets/trees/rainforest/palms.glb']);
  assert.ok(scenes('broadleaf_round', 5).every((scene) => scene.includes('/meadow/')));
});

test('a prototype tagged for an age class is drawn for it and for nothing else', () => {
  const species = { map: new Map([['conifer_narrow', [0, 1]]]), fallback: [0, 1] };
  const tagged = new ForestSpeciesRegistry({
    prototypeCount: 2, prototypeIndexBySpecies: species, prototypeAgeClasses: new Map([[1, new Set(['dead'])]]),
  });
  assert.deepEqual(tagged.prototypesFor('conifer_narrow', 9, 'dead'), [1]);
  assert.deepEqual(tagged.prototypesFor('conifer_narrow', 9, 'mature'), [0]);
  assert.deepEqual(tagged.prototypesFor('conifer_narrow'), [0]);
  const plain = new ForestSpeciesRegistry({ prototypeCount: 2, prototypeIndexBySpecies: species });
  assert.deepEqual(plain.prototypesFor('conifer_narrow', 9, 'dead'), [0, 1]);
  assert.notEqual(tagged.signature, plain.signature);
});

test('scanned bark takes the sampling state of the procedural pair', () => {
  const procedural = createProceduralBarkTextures({ profile: 'pine', seed: 3, resolution: 8 });
  const scanned = createScannedBarkTextures({
    profile: 'pine', albedoHeight: new THREE.Texture(), normalRoughness: new THREE.Texture(),
  });
  for (const slot of ['albedoHeight', 'normalRoughness']) {
    for (const key of ['wrapS', 'wrapT', 'minFilter', 'magFilter', 'colorSpace', 'generateMipmaps', 'anisotropy', 'name']) {
      assert.equal(scanned[slot][key], procedural[slot][key], `${slot}.${key}`);
    }
  }
  assert.throws(() => createScannedBarkTextures({ profile: 'oak', albedoHeight: new THREE.Texture(), normalRoughness: new THREE.Texture() }));
  assert.ok(BARK_PROFILES.palm.plates[1] > BARK_PROFILES.palm.plates[0], 'the palm fallback is ringed');
});

test('a variant wears its profile scan when one loaded and procedural bark otherwise', async () => {
  const warn = console.warn;
  console.warn = () => {};
  let scans;
  try {
    scans = await loadScannedBarkTextures({
      scans: { pine: '/assets/pine', swamp: '/assets/swamp' },
      loadTexture: async (url) => {
        if (url.includes('swamp')) throw new Error('missing');
        return new THREE.Texture();
      },
    });
  } finally {
    console.warn = warn;
  }
  assert.deepEqual([...scans.keys()], ['pine'], 'a failed pair is left out, not thrown');
  const procedural = () => 'procedural';
  assert.deepEqual(barkTexturesForVariant({ barkProfile: 'pine' }, scans, procedural), { textures: scans.get('pine'), owned: false });
  assert.deepEqual(barkTexturesForVariant({ barkProfile: 'swamp' }, scans, procedural), { textures: 'procedural', owned: true });
  assert.deepEqual(barkTexturesForVariant({}, scans, procedural), { textures: null, owned: false });
});

test('config validation knows bark scans, the palm profile and age classes', () => {
  const withAssets = (patch) => {
    const copy = structuredClone(config);
    Object.assign(copy.stylizedSurface.assets, patch);
    return copy;
  };
  assert.doesNotThrow(() => validateEditorConfig(structuredClone(config)));
  assert.throws(() => validateEditorConfig(withAssets({ barkScans: { oak: '/assets/textures/bark/scans/oak' } })), /barkScans\.oak/);
  assert.throws(() => validateEditorConfig(withAssets({ barkScans: { pine: 'textures/pine' } })), /barkScans\.pine/);
  const snag = surface.assets.treeVariants.find((variant) => variant.ageClasses);
  assert.throws(() => validateEditorConfig(withAssets({
    treeVariants: [{ ...snag, ageClasses: ['rotten'] }],
  })), /ageClasses/);
});

test('a storm opens the tree bend limit and calm air keeps the old one', () => {
  assert.equal(CALM_BEND, 0.1);
  assert.equal(treeBendLimit(0), 0.1);
  assert.ok(Math.abs(treeBendLimit(1) - 0.17) < 1e-12);
  assert.ok(STORM_BEND > 0);
});
