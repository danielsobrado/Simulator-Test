import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { normalizeProceduralRecipe } from '../src/editor/workshop/ProceduralAssetStore.js';
import {
  createWorkshopDocumentFromRecipe,
  resolveWorkshopModel,
  resolveWorkshopRecipe,
} from '../src/editor/workshop/kernel/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('semantic recipe bridge preserves every Phase 0 compatibility recipe', async () => {
  const config = yaml.load(await readFile(
    path.join(root, 'config', 'workshop-compatibility.yaml'),
    'utf8',
  ));

  for (const fixture of config.fixtures) {
    const expected = normalizeProceduralRecipe(fixture.recipe);
    const document = createWorkshopDocumentFromRecipe(fixture.recipe);
    const resolved = resolveWorkshopRecipe(document);
    assert.deepEqual(resolved, expected, `${fixture.id} semantic round-trip drifted`);

    const model = resolveWorkshopModel(document);
    assert.deepEqual(model.recipe, expected, `${fixture.id} resolved model drifted`);
    assert.equal(model.entityOrder.length, document.size);
  }
});

test('semantic bridge gives structured recipe records stable entity ownership', () => {
  const document = createWorkshopDocumentFromRecipe({
    archetype: 'manor',
    composition: {
      version: 1,
      primitives: [{
        id: 'hall',
        kind: 'rectangle',
        position: [0, 0],
        dimensions: [8, 6],
        height: 5,
        levels: 1,
        roofFamily: 'hip',
      }],
    },
    componentTransforms: {
      'structure-main': { position: [0.2, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    },
  });

  assert.equal(document.getEntity('recipe').type, 'workshop-recipe');
  assert.equal(document.getEntity('composition:hall').type, 'composition-rectangle');
  assert.equal(document.getEntity('component-transform:structure-main').type, 'component-transform');
});
