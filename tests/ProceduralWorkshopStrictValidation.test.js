import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProceduralAssetRecord,
  normalizeProceduralRecipe,
  ProceduralAssetStore,
} from '../src/editor/workshop/ProceduralAssetStore.js';
import { normalizeComponentTransform } from '../src/editor/workshop/ProceduralWorkshopComponentTransforms.js';

const PNG_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function recipe(overrides = {}) {
  return {
    archetype: 'wall',
    style: 'granite',
    topStyle: 'battlements',
    finish: 'masonry',
    shape: 'classic',
    towerSide: 'none',
    width: 8,
    depth: 2,
    height: 5,
    roofScale: 1,
    roofOverhang: 0.35,
    seed: 1848,
    detail: 2,
    weathering: 0.35,
    windows: true,
    ivy: false,
    remesh: true,
    albedo: true,
    surfaceTextures: { sources: {}, slots: {} },
    componentTransforms: {},
    ...overrides,
  };
}

function texturedRecipe(slotOverrides = {}, sourceOverrides = {}) {
  return recipe({
    surfaceTextures: {
      sources: {
        'albedo-test': {
          name: 'stone.png',
          dataUrl: PNG_DATA_URL,
          ...sourceOverrides,
        },
      },
      slots: {
        walls: {
          sourceId: 'albedo-test',
          mapping: 'repeat',
          repeat: 2,
          rotation: 0,
          tint: '#ffffff',
          ...slotOverrides,
        },
      },
    },
  });
}

test('workshop recipes reject numeric and boolean string coercion', () => {
  assert.throws(
    () => normalizeProceduralRecipe(recipe({ width: '8' })),
    /Width must be between/,
  );
  assert.throws(
    () => normalizeProceduralRecipe(recipe({ windows: 'false' })),
    /Doors and windows must be true or false/,
  );
  assert.throws(
    () => normalizeProceduralRecipe(recipe({ detail: 2.5 })),
    /Detail must be an integer/,
  );
  assert.throws(
    () => normalizeProceduralRecipe(recipe({ archetype: 1 })),
    /Workshop archetype must be a string/,
  );
});

test('explicit null recipe values are rejected instead of becoming defaults', () => {
  assert.throws(
    () => normalizeProceduralRecipe(recipe({ width: null })),
    /Width must be between/,
  );
  assert.throws(
    () => normalizeProceduralRecipe(recipe({ windows: null })),
    /Doors and windows must be true or false/,
  );
  assert.throws(
    () => normalizeProceduralRecipe(recipe({ surfaceTextures: null })),
    /Workshop surface textures must be an object/,
  );
  assert.throws(
    () => normalizeProceduralRecipe(recipe({ componentTransforms: null })),
    /Workshop component transforms must be an object/,
  );
  assert.throws(
    () => normalizeProceduralRecipe(recipe({ openingAttachments: null })),
    /Opening attachments must be an object/,
  );
});

test('component vectors reject coerced values and canonicalize equivalent half turns', () => {
  assert.throws(
    () => normalizeComponentTransform({ position: ['1', 0, 0] }),
    /Component position values must be between/,
  );
  assert.throws(
    () => normalizeComponentTransform({ scale: [null, 1, 1] }),
    /Component scale values must be between/,
  );
  assert.throws(
    () => normalizeComponentTransform(null),
    /Component transform must be an object/,
  );

  const positive = normalizeComponentTransform({ rotation: [0, Math.PI, 0] });
  const negative = normalizeComponentTransform({ rotation: [0, -Math.PI, 0] });
  assert.deepEqual(negative.rotation, positive.rotation);
  assert.equal(positive.rotation[1], Math.PI);
});

test('semantic texture recipes reject numeric, string, and null coercion', () => {
  assert.throws(
    () => normalizeProceduralRecipe(texturedRecipe({ repeat: '2' })),
    /Albedo repeat must be between/,
  );
  assert.throws(
    () => normalizeProceduralRecipe(texturedRecipe({ rotation: '90' })),
    /Albedo rotation must be/,
  );
  assert.throws(
    () => normalizeProceduralRecipe(texturedRecipe({ tint: null })),
    /tint must be a string/,
  );
  assert.throws(
    () => normalizeProceduralRecipe(texturedRecipe({}, { dataUrl: 123 })),
    /data URL must be a string/,
  );
});

test('malformed saved records fail with controlled validation errors', () => {
  const store = new ProceduralAssetStore();
  assert.throws(
    () => store.replaceAll([null]),
    /Procedural game-object record must be an object/,
  );
  assert.throws(
    () => store.replaceAll({}),
    /payload must be an array/,
  );
  assert.throws(
    () => store.replaceAll([{ version: 3, key: 'workshop-missing-recipe', label: 'Missing' }]),
    /Procedural game-object recipe must be an object/,
  );
  assert.throws(
    () => createProceduralAssetRecord({ label: 123, recipe: recipe() }),
    /Game-object name must be a string/,
  );
});
