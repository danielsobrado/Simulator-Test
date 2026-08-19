import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import yaml from 'js-yaml';

import {
  ProceduralAssetStore,
  normalizeProceduralRecipe,
} from '../src/editor/workshop/ProceduralAssetStore.js';
import { planWorkshopComposition } from '../src/editor/workshop/ProceduralWorkshopComposition.js';
import { stableJson } from '../scripts/lib/workshopCompatibility.mjs';

const config = yaml.load(await readFile(
  new URL('../config/workshop-compatibility.yaml', import.meta.url),
  'utf8',
));
const legacyAssets = JSON.parse(await readFile(
  new URL('./fixtures/workshop-compatibility/legacy-assets.json', import.meta.url),
  'utf8',
));

function fixture(id) {
  const value = config.fixtures.find((entry) => entry.id === id);
  assert.ok(value, `Missing workshop compatibility fixture ${id}.`);
  return value;
}

test('workshop compatibility catalogue covers Phase 0 behavior families', () => {
  const ids = new Set(config.fixtures.map(({ id }) => id));
  for (const required of [
    'wall-classic',
    'wall-stepped',
    'wall-tapered',
    'gatehouse',
    'round-tower',
    'square-tower',
    'manor-materials',
    'transformed-components',
    'opening-assembly',
    'surface-texture',
    'composition-l-roof',
  ]) {
    assert.ok(ids.has(required), `Missing Phase 0 fixture ${required}.`);
  }

  assert.equal(config.contracts.assetVersion, 7);
  assert.deepEqual(config.contracts.supportedAssetVersions, [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(config.contracts.compositionVersion, 1);
  assert.ok(config.straightSkeletons.some(({ id }) => id === 'l-footprint'));
  assert.ok(config.visualQa.representativeCheckpoints.length >= 3);
});

test('workshop fixture normalization and serialization are deterministic', () => {
  for (const entry of config.fixtures) {
    const first = normalizeProceduralRecipe(entry.recipe);
    const second = normalizeProceduralRecipe(JSON.parse(JSON.stringify(entry.recipe)));
    assert.equal(
      stableJson(first, config.precision),
      stableJson(second, config.precision),
      `${entry.id} normalization changed across equivalent inputs.`,
    );

    const store = new ProceduralAssetStore();
    store.add({ label: entry.label, recipe: entry.recipe });
    const document = store.toDocument();

    const restored = new ProceduralAssetStore();
    restored.replaceAll(document);
    assert.equal(
      stableJson(document, config.precision),
      stableJson(restored.toDocument(), config.precision),
      `${entry.id} serialization did not round-trip.`,
    );
  }
});

test('legacy workshop assets migrate to the current document without losing stable keys', () => {
  const store = new ProceduralAssetStore();
  store.replaceAll(legacyAssets);
  const migrated = store.toDocument();

  assert.deepEqual(
    migrated.map(({ key }) => key),
    legacyAssets.map(({ key }) => key),
  );
  assert.ok(migrated.every(({ version }) => version === config.contracts.assetVersion));

  const restored = new ProceduralAssetStore();
  restored.replaceAll(migrated);
  assert.equal(stableJson(migrated), stableJson(restored.toDocument()));
});

test('compatibility fixtures preserve authored component, opening and assembly ids', () => {
  const transformed = normalizeProceduralRecipe(fixture('transformed-components').recipe);
  assert.deepEqual(Object.keys(transformed.componentTransforms), ['structure-left']);

  const openings = normalizeProceduralRecipe(fixture('opening-assembly').recipe);
  assert.deepEqual(Object.keys(openings.openingAttachments), ['copy-window-1-1']);
  assert.deepEqual(Object.keys(openings.openingAssemblies), ['assembly-window-1']);
  assert.deepEqual(
    openings.openingAssemblies['assembly-window-1'].memberIds,
    ['window-1', 'copy-window-1-1'],
  );
});

test('composition fixture freezes semantic RPG ids and primitive ordering', () => {
  const recipe = normalizeProceduralRecipe(fixture('composition-l-roof').recipe);
  const plan = planWorkshopComposition(recipe);

  assert.deepEqual(plan.primitives.map(({ id }) => id), ['hall', 'tower', 'wing']);
  assert.deepEqual(
    plan.rpg.walkableFloors.map(({ id }) => id),
    ['hall:level-1', 'tower:level-1', 'tower:level-2', 'wing:level-1'],
  );
  assert.deepEqual(
    plan.rpg.roomBoundaries.map(({ id }) => id),
    [
      'hall:level-1:room',
      'tower:level-1:room',
      'tower:level-2:room',
      'wing:level-1:room',
    ],
  );
  assert.deepEqual(plan.rpg.portals, []);
  assert.deepEqual(plan.rpg.stairSockets, []);
});
